// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate } from '../server/src/schema.ts';
import { createRequestHandler } from '../server/src/http.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-platform-test-'));
const db = openDatabase(path.join(dir, 'test.db'));
migrate(db);
const server = http.createServer(createRequestHandler(db));
let upstreamBody: Record<string, unknown> | null = null;
let upstreamAuthorization = '';
const upstream = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  upstreamBody = JSON.parse(Buffer.concat(chunks).toString());
  upstreamAuthorization = String(req.headers.authorization);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '测试模型：先完成对照实验。' } }] }));
});
let base = '';
let owner = '';
let admin = '';
let member = '';
let memberId = '';
let adminId = '';
let ownerId = '';
const secret = 'test-only-placeholder-key';
const listen = (s: http.Server) =>
  new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)));
async function call(route: string, cookie = '', method = 'GET', body?: unknown) {
  const response = await fetch(base + route, {
    method,
    headers: { cookie, 'x-rw-client': 'rw', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
beforeAll(async () => {
  base = `http://127.0.0.1:${await listen(server)}`;
  process.env.AI_BASE_URL = `http://127.0.0.1:${await listen(upstream)}/v1`;
  process.env.AI_API_KEY = secret;
  const first = await call('/api/auth/signup', '', 'POST', { email: 'owner@test.local', password: 'research2026!' });
  owner = first.cookie;
  ownerId = (first.body.user as { id: string }).id;
  adminId = (
    await call('/api/admin/users', owner, 'POST', {
      email: 'admin@test.local',
      password: 'research2026!',
      role: 'admin',
    })
  ).body.id as string;
  memberId = (
    await call('/api/admin/users', owner, 'POST', {
      email: 'member@test.local',
      password: 'research2026!',
      role: 'member',
    })
  ).body.id as string;
  admin = (await call('/api/auth/login', '', 'POST', { email: 'admin@test.local', password: 'research2026!' })).cookie;
  member = (await call('/api/auth/login', '', 'POST', { email: 'member@test.local', password: 'research2026!' }))
    .cookie;
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => upstream.close(() => resolve())),
  ]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
});

describe('平台角色与账号管理', () => {
  it('未登录和普通用户无法读取或修改管理接口', async () => {
    expect((await call('/api/admin/overview')).status).toBe(401);
    expect((await call('/api/admin/overview', member)).status).toBe(403);
    expect((await call('/api/admin/settings', member, 'PATCH', { allowSignup: true })).status).toBe(403);
    expect((await call('/api/admin/users', member, 'PATCH', { id: memberId, role: 'owner' })).status).toBe(403);
  });
  it('管理员不能提权或修改所有者，所有者和自己均受保护', async () => {
    expect(
      (
        await call('/api/admin/users', admin, 'POST', {
          email: 'bad@test.local',
          password: 'research2026!',
          role: 'admin',
        })
      ).status,
    ).toBe(403);
    expect((await call('/api/admin/users', admin, 'PATCH', { id: ownerId, status: 'disabled' })).status).toBe(403);
    expect((await call('/api/admin/users', owner, 'PATCH', { id: ownerId, status: 'disabled' })).status).toBe(403);
    expect((await call('/api/admin/users', admin, 'PATCH', { id: adminId, role: 'owner' })).status).toBe(403);
  });
  it('注册方式由后台持久设置控制，注册不能自报角色', async () => {
    await call('/api/admin/settings', owner, 'PATCH', { allowSignup: false });
    expect((await call('/api/auth/options')).body.allowSignup).toBe(false);
    expect(
      (await call('/api/auth/signup', '', 'POST', { email: 'closed@test.local', password: 'research2026!' })).status,
    ).toBe(403);
    await call('/api/admin/settings', owner, 'PATCH', { allowSignup: true });
    const result = await call('/api/auth/signup', '', 'POST', {
      email: 'signup@test.local',
      password: 'research2026!',
      role: 'owner',
    });
    expect((result.body.user as { role: string }).role).toBe('member');
    await call('/api/admin/settings', owner, 'PATCH', { allowSignup: false });
  });
  it('管理员可停用成员，原会话立即失效且无法再次登录，启用后恢复登录', async () => {
    expect((await call('/api/admin/users', admin, 'PATCH', { id: memberId, status: 'disabled' })).status).toBe(200);
    expect((await call('/api/me', member)).status).toBe(401);
    expect(
      (await call('/api/auth/login', '', 'POST', { email: 'member@test.local', password: 'research2026!' })).status,
    ).toBe(401);
    await call('/api/admin/users', admin, 'PATCH', { id: memberId, status: 'active' });
    member = (await call('/api/auth/login', '', 'POST', { email: 'member@test.local', password: 'research2026!' }))
      .cookie;
    expect(member).toContain('rw_session=');
  });
  it('管理响应不包含密码散列，关键操作留下审计记录', async () => {
    const response = await call('/api/admin/overview', owner);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('passHash');
    expect(text).not.toContain('passSalt');
    expect((response.body.audit as unknown[]).length).toBeGreaterThan(0);
  });
  it('替换备份遇到其他账号的同 ID 记录时，原始数据整体保留', async () => {
    const row = (id: string) => ({
      id,
      name: id,
      question: '',
      goal: '',
      status: 'active',
      startDate: null,
      endDate: null,
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      isDemo: false,
    });
    await call('/api/tx', owner, 'POST', { ops: [{ type: 'put', table: 'projects', record: row('owner-original') }] });
    await call('/api/tx', member, 'POST', { ops: [{ type: 'put', table: 'projects', record: row('member-owned') }] });
    expect(
      (await call('/api/backup/import', owner, 'POST', { mode: 'replace', data: { projects: [row('member-owned')] } }))
        .status,
    ).toBe(422);
    const snapshot = (await call('/api/snapshot', owner)).body.data as { projects: { id: string }[] };
    expect(snapshot.projects.map((p) => p.id)).toContain('owner-original');
    expect(snapshot.projects.map((p) => p.id)).not.toContain('member-owned');
  });
});

describe('平台 AI 网关', () => {
  it('未配置时明确拒绝，不返回伪造回答', async () => {
    expect((await call('/api/ai/chat', member, 'POST', { messages: [{ role: 'user', content: '你好' }] })).status).toBe(
      503,
    );
  });
  it('只向服务端配置的地址请求，密钥不返回客户端，模型和 URL 不能由用户覆盖', async () => {
    await call('/api/admin/settings', owner, 'PATCH', {
      ai: { provider: 'custom', model: 'mock-model', enabled: true },
    });
    const response = await call('/api/ai/chat', member, 'POST', {
      model: 'forged',
      baseUrl: 'https://attacker.invalid',
      messages: [{ role: 'user', content: '规划实验' }],
    });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain('测试模型');
    expect(upstreamBody).toMatchObject({ model: 'mock-model', stream: false });
    expect(upstreamAuthorization).toBe(`Bearer ${secret}`);
    expect(JSON.stringify((await call('/api/ai/config', member)).body)).not.toContain(secret);
    expect(JSON.stringify((await call('/api/admin/overview', owner)).body)).not.toContain(secret);
  });
  it('平台 AI 权限实时在后端校验，已有会话也不能绕过', async () => {
    await call('/api/admin/users', admin, 'PATCH', { id: memberId, aiEnabled: false });
    expect((await call('/api/ai/chat', member, 'POST', { messages: [{ role: 'user', content: '绕过' }] })).status).toBe(
      403,
    );
    await call('/api/admin/users', admin, 'PATCH', { id: memberId, aiEnabled: true });
  });
  it('拒绝非法消息和过长上下文，达到账号限额时返回 429', async () => {
    expect((await call('/api/ai/chat', member, 'POST', { messages: [{ role: 'tool', content: 'x' }] })).status).toBe(
      400,
    );
    expect(
      (await call('/api/ai/chat', member, 'POST', { messages: [{ role: 'user', content: 'x'.repeat(60001) }] })).status,
    ).toBe(400);
    for (let i = 0; i < 8; i++)
      db.prepare('INSERT INTO aiRequests(id,userId,model,status,createdAt) VALUES(?,?,?,?,?)').run(
        `limit-${i}`,
        memberId,
        'mock-model',
        'success',
        Date.now(),
      );
    expect((await call('/api/ai/chat', member, 'POST', { messages: [{ role: 'user', content: 'x' }] })).status).toBe(
      429,
    );
  });
});
