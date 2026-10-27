/**
 * HTTP 层。除 /api/health 与两个认证入口外，所有接口都先过会话校验；
 * 数据读写一律带上会话里的 userId，不接受请求体自报身份。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import { config } from './config.ts';
import { parseAvatarDataUrl } from './avatar.ts';
import { FileError, handleResearchFiles } from './files.ts';
import {
  CLEAR_COOKIE,
  buildCookie,
  changePassword,
  checkLoginAllowed,
  clearLoginAttempts,
  countUsers,
  createUser,
  destroySession,
  listSessions,
  noteFailedLogin,
  normalizeEmail,
  readCookie,
  revokeSessions,
  sessionUser,
  setNickname,
  startSession,
  validNickname,
  verifyPassword,
  type User,
} from './auth.ts';
import { applyOps, isEntityTable, readSnapshot, validateRecord, type Op } from './store.ts';
import { LATEST_SCHEMA_VERSION, RECORD_SCHEMA_VERSION, quoteTable, TABLE_COLUMNS, type EntityTable } from './schema.ts';
import type { DatabaseSync } from 'node:sqlite';
import {
  createManagedUser,
  overview,
  platformAiConfig,
  platformChat,
  PlatformError,
  requireManager,
  signupAllowed,
  updateManagedUser,
  updatePlatform,
} from './platform.ts';

const now = () => Date.now();

export interface Ctx {
  db: DatabaseSync;
  user: User;
  /** 当前会话的行 id：改密、踢设备都要区分「这台设备」。 */
  sessionId: string;
}

interface Request {
  signal: AbortSignal;
  method: string;
  path: string;
  ip: string;
  header: (name: string) => string | undefined;
  json: <T>() => Promise<T>;
}

type Handler = (req: Request, ctx: Ctx) => Promise<unknown> | unknown;

class HttpError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const BAD_REQUEST = (message: string) => new HttpError(400, message);
const UNAUTHORIZED = () => new HttpError(401, '需要登录');
async function objectBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json<unknown>();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw BAD_REQUEST('请求体必须是对象');
  return body as Record<string, unknown>;
}

function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (first) return first.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

async function readJson(req: IncomingMessage, maxBytes = config.maxBodyBytes): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, `请求体超过 ${Math.round(maxBytes / 1024)} KB 上限`);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw BAD_REQUEST(`请求体不是合法 JSON：${(error as Error).message}`);
  }
}

/** 写操作要求带自定义头：跨站表单和自动提交的请求带不上它，配合 SameSite=Strict 双保险。 */
function requireCsrf(req: IncomingMessage, method: string): void {
  if (method === 'GET' || method === 'HEAD') return;
  if (req.headers['x-rw-client'] !== 'rw') throw new HttpError(403, '缺少必要的请求头，已拒绝这次写操作');
}

// ---------------------------------------------------------------- 路由表

interface Route {
  method: string;
  prefix: string;
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [
  {
    method: 'GET',
    prefix: '/api/auth/options',
    auth: false,
    handler: (_req, ctx) => ({
      allowSignup: countUsers(ctx.db) === 0 || signupAllowed(ctx.db),
      bootstrap: countUsers(ctx.db) === 0,
    }),
  },
  { method: 'GET', prefix: '/api/admin/overview', auth: true, handler: (_req, ctx) => overview(ctx.db, ctx.user) },
  {
    method: 'POST',
    prefix: '/api/admin/users',
    auth: true,
    handler: async (req, ctx) => createManagedUser(ctx.db, ctx.user, await objectBody(req)),
  },
  {
    method: 'PATCH',
    prefix: '/api/admin/users',
    auth: true,
    handler: async (req, ctx) => updateManagedUser(ctx.db, ctx.user, await objectBody(req)),
  },
  {
    method: 'PATCH',
    prefix: '/api/admin/settings',
    auth: true,
    handler: async (req, ctx) => updatePlatform(ctx.db, ctx.user, await objectBody(req)),
  },
  { method: 'GET', prefix: '/api/ai/config', auth: true, handler: (_req, ctx) => platformAiConfig(ctx.db, ctx.user) },
  {
    method: 'POST',
    prefix: '/api/ai/chat',
    auth: true,
    handler: async (req, ctx) => platformChat(ctx.db, ctx.user, await objectBody(req), req.signal),
  },
  {
    method: 'POST',
    prefix: '/api/admin/ai/test',
    auth: true,
    handler: async (req, ctx) => {
      requireManager(ctx.user);
      return platformChat(
        ctx.db,
        ctx.user,
        { messages: [{ role: 'user', content: '请只回复：连接正常' }] },
        req.signal,
      );
    },
  },
  {
    method: 'POST',
    prefix: '/api/auth/signup',
    auth: false,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { email?: string; password?: string };
      const isFirst = countUsers(ctx.db) === 0;
      if (!isFirst && !signupAllowed(ctx.db)) {
        throw new HttpError(403, '平台暂未开放注册，请联系管理员创建账号。');
      }
      const result = createUser(ctx.db, String(body.email ?? ''), String(body.password ?? ''));
      if (!result.ok) throw new HttpError(result.status, result.error);
      return { user: result.user, cookie: buildCookie(result.token) };
    },
  },
  {
    method: 'POST',
    prefix: '/api/auth/login',
    auth: false,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { email?: string; password?: string };
      const email = normalizeEmail(String(body.email ?? ''));
      const key = `${email}|${req.ip}`;
      const lock = checkLoginAllowed(ctx.db, key);
      if (!lock.allowed) {
        throw new HttpError(429, `失败次数太多，已临时锁定。请 ${lock.retryAfterSeconds ?? 900} 秒后再试。`);
      }
      const user = verifyPassword(ctx.db, email, String(body.password ?? ''));
      if (!user) {
        noteFailedLogin(ctx.db, key);
        throw new HttpError(401, '邮箱或密码不对');
      }
      clearLoginAttempts(ctx.db, key);
      const token = startSession(ctx.db, user.id, String(req.header('user-agent') ?? ''));
      return { user, cookie: buildCookie(token) };
    },
  },
  {
    method: 'POST',
    prefix: '/api/auth/logout',
    auth: false,
    handler: async (req, ctx) => {
      const token = readCookie(req.header('cookie'), config.sessionCookieName);
      if (token) destroySession(ctx.db, token);
      return { cookie: CLEAR_COOKIE };
    },
  },
  {
    method: 'GET',
    prefix: '/api/me',
    auth: true,
    handler: (_req, ctx) => ({
      id: ctx.user.id,
      email: ctx.user.email,
      role: ctx.user.role,
      nickname: ctx.user.nickname,
      aiEnabled: ctx.user.aiEnabled,
      avatarDataUrl: ctx.user.avatarDataUrl ?? null,
      schemaVersion: RECORD_SCHEMA_VERSION,
    }),
  },
  {
    method: 'PATCH',
    prefix: '/api/auth/avatar',
    auth: true,
    handler: async (req, ctx) => {
      const body = await objectBody(req);
      let avatarDataUrl: string | null;
      try {
        avatarDataUrl = parseAvatarDataUrl(body.avatarDataUrl);
      } catch (error) {
        throw BAD_REQUEST((error as Error).message);
      }
      ctx.db.prepare('UPDATE users SET avatarDataUrl = ? WHERE id = ?').run(avatarDataUrl, ctx.user.id);
      return {
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          role: ctx.user.role,
          nickname: ctx.user.nickname,
          aiEnabled: ctx.user.aiEnabled,
          avatarDataUrl,
        },
      };
    },
  },
  {
    method: 'PATCH',
    prefix: '/api/auth/profile',
    auth: true,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { nickname?: unknown };
      const nickname = validNickname(body.nickname);
      if (nickname === null) throw BAD_REQUEST('昵称最多 24 个字');
      setNickname(ctx.db, ctx.user.id, nickname);
      return {
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          role: ctx.user.role,
          nickname: nickname === '' ? null : nickname,
          aiEnabled: ctx.user.aiEnabled,
          avatarDataUrl: ctx.user.avatarDataUrl ?? null,
        },
      };
    },
  },
  {
    method: 'POST',
    prefix: '/api/auth/change-password',
    auth: true,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { currentPassword?: unknown; newPassword?: unknown };
      const result = changePassword(
        ctx.db,
        ctx.user.id,
        ctx.sessionId,
        String(body.currentPassword ?? ''),
        String(body.newPassword ?? ''),
      );
      if (!result.ok) throw new HttpError(result.status, result.error);
      return { revoked: result.revoked };
    },
  },
  {
    method: 'GET',
    prefix: '/api/auth/sessions',
    auth: true,
    handler: (_req, ctx) => ({ sessions: listSessions(ctx.db, ctx.user.id, ctx.sessionId) }),
  },
  {
    method: 'POST',
    prefix: '/api/auth/sessions/revoke',
    auth: true,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { id?: unknown; others?: unknown };
      if (body.others === true) {
        const revoked = revokeSessions(ctx.db, ctx.user.id, ctx.sessionId, undefined, true);
        return { revoked };
      }
      const id = String(body.id ?? '');
      if (id === ctx.sessionId) throw BAD_REQUEST('这台是当前设备，要退出请用账号菜单里的退出登录');
      const revoked = revokeSessions(ctx.db, ctx.user.id, ctx.sessionId, id);
      if (revoked === 0) throw BAD_REQUEST('这条登录记录不存在或已经下线');
      return { revoked };
    },
  },
  {
    method: 'GET',
    prefix: '/api/snapshot',
    auth: true,
    handler: (_req, ctx) => ({
      schemaVersion: RECORD_SCHEMA_VERSION,
      serverTime: now(),
      data: readSnapshot(ctx.db, ctx.user.id),
    }),
  },
  {
    method: 'POST',
    prefix: '/api/tx',
    auth: true,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { ops?: Op[] };
      if (!Array.isArray(body.ops)) throw BAD_REQUEST('ops 必须是数组');
      if (body.ops.length > 2000) throw BAD_REQUEST('一次提交最多 2000 个操作');
      const result = applyOps(ctx.db, ctx.user.id, body.ops);
      if (result.rejected.length)
        throw new HttpError(422, `这次写入被拒绝，数据未改动：${result.rejected.join('；')}`, result.rejected);
      return result;
    },
  },
  {
    method: 'GET',
    prefix: '/api/backup',
    auth: true,
    handler: (_req, ctx) => ({
      app: 'research-workspace',
      schemaVersion: RECORD_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      note: '服务端备份：包含该账号的全部项目、任务、实验、文献、标签与关系，不含附件。',
      data: readSnapshot(ctx.db, ctx.user.id),
    }),
  },
  {
    method: 'POST',
    prefix: '/api/backup/import',
    auth: true,
    handler: async (req, ctx) => {
      const body = (await req.json()) as { mode?: string; data?: Record<string, unknown[]> };
      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      const data = body.data;
      if (!data || typeof data !== 'object') throw BAD_REQUEST('缺少 data');
      for (const key of Object.keys(data)) {
        if (!isEntityTable(key)) throw BAD_REQUEST(`未知表 ${key}`);
      }
      const problems: string[] = [];
      for (const table of Object.keys(TABLE_COLUMNS) as EntityTable[]) {
        const rows = (data[table] ?? []) as Record<string, unknown>[];
        for (const row of rows) {
          const errors = validateRecord(table, row);
          if (errors.length) problems.push(`${table}#${String(row.id ?? '?')}：${errors.join('；')}`);
        }
        if (problems.length > 8) break;
      }
      if (problems.length)
        throw new HttpError(422, `导入文件有问题，未做任何改动：${problems.slice(0, 8).join('；')}`, problems);

      const ops: Op[] = [];
      ctx.db.exec('BEGIN IMMEDIATE');
      try {
        if (mode === 'replace') {
          for (const table of Object.keys(TABLE_COLUMNS) as EntityTable[]) {
            ctx.db.prepare(`DELETE FROM ${quoteTable(table)} WHERE userId = ?`).run(ctx.user.id);
          }
        }
        for (const table of Object.keys(TABLE_COLUMNS) as EntityTable[]) {
          for (const row of (data[table] ?? []) as Record<string, unknown>[])
            ops.push({ type: 'put', table, record: row });
        }
        const result = applyOps(ctx.db, ctx.user.id, ops);
        if (result.rejected.length) throw new HttpError(422, `导入被拒绝，数据未改动：${result.rejected.join('；')}`);
        if (result.skipped.length) throw new HttpError(422, '导入存在记录冲突，数据未改动，请检查备份文件');
        ctx.db.exec('COMMIT');
        return { mode, written: result.applied, skipped: result.skipped.length };
      } catch (error) {
        ctx.db.exec('ROLLBACK');
        if (error instanceof HttpError) throw error;
        throw new HttpError(500, `导入失败，已回滚：${(error as Error).message}`);
      }
    },
  },
  {
    method: 'POST',
    prefix: '/api/account/clear-demo',
    auth: true,
    handler: (_req, ctx) => {
      let removed = 0;
      ctx.db.exec('BEGIN IMMEDIATE');
      try {
        for (const table of Object.keys(TABLE_COLUMNS) as EntityTable[]) {
          const res = ctx.db
            .prepare(`DELETE FROM ${quoteTable(table)} WHERE userId = ? AND isDemo = 1`)
            .run(ctx.user.id);
          removed += Number(res.changes);
        }
        ctx.db.exec('COMMIT');
      } catch (error) {
        ctx.db.exec('ROLLBACK');
        throw new HttpError(500, `清除演示数据失败，已回滚：${(error as Error).message}`);
      }
      return { removed };
    },
  },
];

// ---------------------------------------------------------------- 入口

export function createRequestHandler(db: DatabaseSync) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://internal');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    const send = (status: number, payload: unknown, extraHeaders: Record<string, string> = {}) => {
      if (res.destroyed) return;
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      });
      res.end(body);
    };

    if (path === '/api/health') {
      send(200, {
        ok: true,
        schemaVersion: RECORD_SCHEMA_VERSION,
        migrations: LATEST_SCHEMA_VERSION,
        serverTime: now(),
      });
      return;
    }
    if (!path.startsWith('/api/')) {
      send(404, { error: '这个地址不在服务端接口里。前端是静态文件，由 Nginx 直接给。' });
      return;
    }

    const route = routes.find((r) => r.method === method && r.prefix === path);
    const fileRoute = path === '/api/files' || /^\/api\/files\/[^/]+(?:\/content)?$/.test(path);
    if (!route && !fileRoute) {
      send(405, { error: `${method} ${path} 不支持` });
      return;
    }

    try {
      const token = readCookie(req.headers.cookie, config.sessionCookieName);
      const user = sessionUser(db, token);
      if ((fileRoute || route?.auth) && !user) throw UNAUTHORIZED();

      requireCsrf(req, method);
      if (fileRoute) {
        await handleResearchFiles(req, res, db, user!.id, path, () => readJson(req));
        return;
      }

      const request: Request = {
        signal: (() => {
          const controller = new AbortController();
          res.once('close', () => {
            if (!res.writableEnded) controller.abort();
          });
          return controller.signal;
        })(),
        method,
        path,
        ip: clientIp(req),
        header: (name) =>
          Array.isArray(req.headers[name])
            ? (req.headers[name] as string[]).join(',')
            : (req.headers[name] as string | undefined),
        json: () =>
          readJson(req, path === '/api/ai/chat' ? config.maxAiBodyBytes : config.maxBodyBytes) as Promise<never>,
      };

      // auth:false 的路由（注册/登录/登出）不读 user；auth:true 上面已经拦过 null
      const result = (await route!.handler(request, { db, user: user as User, sessionId: user?.sessionId ?? '' })) as
        | Record<string, unknown>
        | undefined;
      const headers: Record<string, string> = {};
      if (result && typeof result.cookie === 'string') {
        headers['Set-Cookie'] = result.cookie;
        result.cookie = undefined;
      }
      send(200, result ?? { ok: true }, headers);
    } catch (error) {
      const known = error instanceof HttpError || error instanceof PlatformError || error instanceof FileError;
      const status = known ? error.status : 500;
      const message = known ? error.message : '服务器内部错误，请稍后重试';
      if (!known) console.error('[rw]', error);
      send(status, { error: message, detail: error instanceof HttpError ? error.detail : undefined });
    }
  };
}

export { LATEST_SCHEMA_VERSION };
