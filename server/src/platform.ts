import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';
import { AiInputError, cleanAiMessages } from './ai-input.ts';
import { createUser, destroySession, type User } from './auth.ts';
import {
  canManagePlatform,
  MODEL_PROVIDERS,
  type PlatformAiConfig,
  type PlatformOverview,
  type ManagedUser,
  type AuditEvent,
} from '../../src/domain/platform.ts';

export class PlatformError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new PlatformError(status, message);
};
export function requireManager(user: User) {
  if (!canManagePlatform(user.role)) fail(403, '只有管理员可以访问管理控制台');
}
function readSetting<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`platform.${key}`) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
function writeSetting(db: DatabaseSync, key: string, value: unknown) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    `platform.${key}`,
    JSON.stringify(value),
  );
}
function audit(db: DatabaseSync, actor: User, action: string, target: string) {
  db.prepare('INSERT INTO platformAudit(id,actorId,action,target,createdAt) VALUES(?,?,?,?,?)').run(
    crypto.randomUUID(),
    actor.id,
    action,
    target,
    Date.now(),
  );
}
export const signupAllowed = (db: DatabaseSync) => readSetting(db, 'allowSignup', config.allowSignup);

export function platformAiConfig(db: DatabaseSync, user: User): PlatformAiConfig {
  const saved = readSetting(db, 'ai', { provider: 'deepseek', model: '', enabled: false });
  const provider = MODEL_PROVIDERS.find((p) => p.id === saved.provider) ?? MODEL_PROVIDERS[0];
  const baseUrl = provider.id === 'custom' ? (process.env.AI_BASE_URL ?? '') : provider.baseUrl;
  return {
    provider: provider.id,
    model: saved.model,
    enabled: saved.enabled,
    baseUrl,
    keyVariable: provider.keyVariable,
    configured: Boolean(baseUrl && process.env[provider.keyVariable] && saved.model),
    aiAllowed: user.aiEnabled !== false,
  };
}

export function overview(db: DatabaseSync, user: User): PlatformOverview {
  requireManager(user);
  const users = db
    .prepare(
      `SELECT u.id,u.email,u.nickname,u.role,u.status,u.aiEnabled,u.createdAt,
    (SELECT MAX(lastSeenAt) FROM sessions WHERE userId=u.id) AS lastSeenAt FROM users u ORDER BY u.createdAt,u.id`,
    )
    .all() as unknown as (Omit<ManagedUser, 'aiEnabled'> & { aiEnabled: number })[];
  const events = db
    .prepare(
      `SELECT a.id,u.email AS actorEmail,a.action,a.target,a.createdAt FROM platformAudit a JOIN users u ON u.id=a.actorId ORDER BY a.createdAt DESC LIMIT 40`,
    )
    .all() as unknown as AuditEvent[];
  return {
    users: users.map((u) => ({ ...u, aiEnabled: Boolean(u.aiEnabled) })),
    audit: events,
    allowSignup: signupAllowed(db),
    ai: platformAiConfig(db, user),
  };
}

export function createManagedUser(db: DatabaseSync, actor: User, body: Record<string, unknown>) {
  requireManager(actor);
  const role = body.role ?? 'member';
  if (role !== 'member' && role !== 'admin') fail(400, '只能创建管理员或普通用户');
  if (role === 'admin' && actor.role !== 'owner') fail(403, '只有平台所有者可以创建管理员');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = createUser(db, String(body.email ?? ''), String(body.password ?? ''));
    if (!result.ok) fail(result.status, result.error);
    if (!result.ok) throw new Error('unreachable');
    destroySession(db, result.token);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(String(role), result.user.id);
    audit(db, actor, '创建账号', result.user.email);
    db.exec('COMMIT');
    return { id: result.user.id };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateManagedUser(db: DatabaseSync, actor: User, body: Record<string, unknown>) {
  requireManager(actor);
  const target = db
    .prepare('SELECT id,email,role,status,aiEnabled FROM users WHERE id=?')
    .get(String(body.id ?? '')) as
    | { id: string; email: string; role: string; status: string; aiEnabled: number }
    | undefined;
  if (!target) return fail(404, '找不到这个账号');
  if (target.id === actor.id || target.role === 'owner') fail(403, '不能在此修改自己或平台所有者的权限');
  if (actor.role !== 'owner' && target.role !== 'member') fail(403, '只有平台所有者可以管理管理员');
  if (body.role !== undefined && body.role !== 'member' && body.role !== 'admin') fail(400, '角色无效');
  if (body.role !== undefined && actor.role !== 'owner') fail(403, '只有平台所有者可以调整角色');
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') fail(400, '账号状态无效');
  if (body.aiEnabled !== undefined && typeof body.aiEnabled !== 'boolean') fail(400, 'AI 权限无效');
  const role = String(body.role ?? target.role);
  const status = String(body.status ?? target.status);
  const aiEnabled = body.aiEnabled === undefined ? target.aiEnabled : Number(body.aiEnabled);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET role=?,status=?,aiEnabled=? WHERE id=?').run(role, status, aiEnabled, target.id);
    if (status === 'disabled' || role !== target.role) db.prepare('DELETE FROM sessions WHERE userId=?').run(target.id);
    audit(db, actor, `更新账号 · ${role} / ${status} / AI ${aiEnabled ? '开启' : '关闭'}`, target.email);
    db.exec('COMMIT');
    return { ok: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updatePlatform(db: DatabaseSync, actor: User, body: Record<string, unknown>) {
  requireManager(actor);
  if (body.allowSignup !== undefined && typeof body.allowSignup !== 'boolean') fail(400, '注册设置无效');
  let ai: { provider: string; model: string; enabled: boolean } | undefined;
  if (body.ai !== undefined) {
    if (!body.ai || typeof body.ai !== 'object' || Array.isArray(body.ai)) fail(400, '模型设置无效');
    const value = body.ai as Record<string, unknown>;
    if (
      !MODEL_PROVIDERS.some((p) => p.id === value.provider) ||
      typeof value.model !== 'string' ||
      value.model.length > 120 ||
      /[\r\n]/.test(value.model) ||
      typeof value.enabled !== 'boolean'
    )
      fail(400, '请填写有效的服务商、模型标识和开关');
    const model = String(value.model).trim();
    if (value.enabled && !model) fail(400, '启用前先填写模型标识');
    ai = { provider: String(value.provider), model, enabled: Boolean(value.enabled) };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (body.allowSignup !== undefined) writeSetting(db, 'allowSignup', body.allowSignup);
    if (ai) writeSetting(db, 'ai', ai);
    audit(
      db,
      actor,
      ai ? '更新平台模型' : '更新注册设置',
      ai ? `${ai.provider} / ${ai.model}` : String(body.allowSignup),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true };
}

/** 网关只向预设服务商或运维配置的 AI_BASE_URL 发请求，不接受客户端自报 URL 或 Key。 */
export async function platformChat(db: DatabaseSync, user: User, body: Record<string, unknown>, signal?: AbortSignal) {
  const ai = platformAiConfig(db, user);
  if (!ai.aiAllowed) fail(403, '你的账号尚未开通平台 AI 权限');
  if (!ai.enabled || !ai.configured) fail(503, '平台模型尚未就绪，请联系管理员配置');
  let clean: ReturnType<typeof cleanAiMessages>;
  try {
    clean = cleanAiMessages(body.messages);
  } catch (error) {
    if (error instanceof AiInputError) return fail(400, error.message);
    throw error;
  }
  const count = (
    db
      .prepare('SELECT COUNT(*) AS n FROM aiRequests WHERE userId=? AND createdAt>?')
      .get(user.id, Date.now() - 60000) as { n: number }
  ).n;
  if (count >= 8) fail(429, '请求较频繁，请一分钟后再试');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO aiRequests(id,userId,model,status,createdAt) VALUES(?,?,?,?,?)').run(
    id,
    user.id,
    ai.model,
    'pending',
    Date.now(),
  );
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env[ai.keyVariable]}` },
      body: JSON.stringify({ model: ai.model, messages: clean, stream: false, max_tokens: 2048 }),
    });
    if (!response.ok) return fail(502, `模型服务暂时不可用（${response.status}），请联系管理员检查配置`);
    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) fail(502, '模型未返回有效内容，请重试');
    db.prepare('UPDATE aiRequests SET status=? WHERE id=?').run('success', id);
    return { content, model: ai.model };
  } catch (error) {
    db.prepare('UPDATE aiRequests SET status=? WHERE id=?').run('error', id);
    if (error instanceof PlatformError) throw error;
    return fail(502, controller.signal.aborted ? '模型响应超时，请重试' : '暂时连不上模型服务，请联系管理员');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
