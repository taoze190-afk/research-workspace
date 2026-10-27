// @vitest-environment node
/**
 * 服务端安全边界测试：登录、限速、CSRF，以及最要紧的一条 ——
 * 两个账号之间谁也读不到、改不动、删不掉对方的数据。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-server-'));
process.env.LOGIN_MAX_ATTEMPTS = '4';
process.env.LOGIN_WINDOW_MINUTES = '15';
process.env.TRUST_PROXY = '0';

const { openDatabase, migrate, LATEST_SCHEMA_VERSION } = await import('../server/src/schema.ts');
const { createRequestHandler } = await import('../server/src/http.ts');
const { config } = await import('../server/src/config.ts');

const db = openDatabase(path.join(process.env.DATA_DIR, 'test.db'));
const server = createServer((req, res) => void createRequestHandler(db)(req, res));
let base = '';

interface Reply {
  status: number;
  body: Record<string, unknown>;
  cookie?: string;
}

async function call(pathname: string, init: { method?: string; body?: unknown; cookie?: string; csrf?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.csrf !== false) headers['x-rw-client'] = 'rw';
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${pathname}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const cookieHeader = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? undefined;
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, cookie: cookieHeader?.split(';')[0] };
}

const record = (over: Record<string, unknown> = {}) => ({
  id: `p-${Math.random().toString(36).slice(2, 10)}`,
  name: '测试项目',
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
  ...over,
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  expect(migrate(db).to).toBe(LATEST_SCHEMA_VERSION);
});

afterAll(() => {
  server.close();
  db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
});

describe('登录与会话', () => {
  it('健康检查不需要登录，数据接口一律 401', async () => {
    expect((await call('/api/health')).body.ok).toBe(true);
    for (const url of ['/api/snapshot', '/api/backup', '/api/me']) {
      expect((await call(url)).status).toBe(401);
    }
    expect((await call('/api/tx', { body: { ops: [] } })).status).toBe(401);
  });

  it('第一个账号能注册，之后的注册默认关闭', async () => {
    const first = await call('/api/auth/signup', { body: { email: 'Owner@Example.com', password: 'research2026!' } });
    expect(first.status).toBe(200);
    expect((first.body.user as { email: string }).email).toBe('owner@example.com');
    expect(first.cookie).toContain(`${config.sessionCookieName}=`);

    const second = await call('/api/auth/signup', { body: { email: 'guest@example.com', password: 'research2026!' } });
    expect(second.status).toBe(403);
  });

  it('弱密码与非法邮箱被拒', async () => {
    // 第一个账号建好后注册已关闭，测校验得先临时打开
    config.allowSignup = true;
    expect((await call('/api/auth/signup', { body: { email: 'a@b.co', password: 'short' } })).status).toBe(400);
    expect((await call('/api/auth/signup', { body: { email: 'not-an-email', password: 'research2026!' } })).status).toBe(400);
    config.allowSignup = false;
  });

  it('错密码 401，连续错到位后 429 锁定', async () => {
    let last = 0;
    for (let i = 0; i < Number(process.env.LOGIN_MAX_ATTEMPTS); i++) {
      last = (await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'wrong-password-1' }, cookie: undefined })).status;
      expect(last).toBe(401);
    }
    const locked = await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'wrong-password-1' } });
    expect(locked.status).toBe(429);
    // 锁定期内连正确密码也进不来，限速才有意义
    const right = await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'research2026!' } });
    expect(right.status).toBe(429);
  });

  it('写操作缺 CSRF 头被拒，读不需要', async () => {
    const login = await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'research2026!' } });
    // 上面那条被锁定了，等不到就用注册出来的会话：先解锁
    db.prepare('DELETE FROM loginAttempts').run();
    const again = await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'research2026!' } });
    expect(again.status).toBe(200);
    const cookie = again.cookie ?? login.cookie;
    const noHeader = await fetch(`${base}/api/tx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie as string },
      body: JSON.stringify({ ops: [] }),
    });
    expect(noHeader.status).toBe(403);
    expect((await call('/api/snapshot', { cookie })).status).toBe(200);
  });
});

describe('账号之间的隔离', () => {
  let aCookie = '';
  let bCookie = '';

  beforeAll(async () => {
    db.prepare('DELETE FROM loginAttempts').run();
    // 放开注册再建第二个账号，测完关回去
    config.allowSignup = true;
    const a = await call('/api/auth/signup', { body: { email: 'a@example.com', password: 'research2026!' } });
    const b = await call('/api/auth/signup', { body: { email: 'b@example.com', password: 'research2026!' } });
    config.allowSignup = false;
    aCookie = a.cookie as string;
    bCookie = b.cookie as string;
    expect(aCookie).toBeTruthy();
    expect(bCookie).toBeTruthy();
    expect(aCookie).not.toBe(bCookie);
  });

  it('A 写的记录不出现在 B 的快照里', async () => {
    const project = record();
    const put = await call('/api/tx', { cookie: aCookie, body: { ops: [{ type: 'put', table: 'projects', record: project }] } });
    expect(put.status).toBe(200);
    expect((put.body as { applied: number }).applied).toBe(1);

    const aSnap = (await call('/api/snapshot', { cookie: aCookie })).body as { data: { projects: { id: string }[] } };
    const bSnap = (await call('/api/snapshot', { cookie: bCookie })).body as { data: { projects: { id: string; userId?: string }[] } };
    expect(aSnap.data.projects.map((p) => p.id)).toContain(project.id);
    expect(bSnap.data.projects.map((p) => p.id)).not.toContain(project.id);
    expect(bSnap.data.projects.some((p) => 'userId' in p)).toBe(false);
  });

  it('B 改不动、删不掉 A 的记录，A 的数据原样保留', async () => {
    const project = record({ name: 'A 的原始名字' });
    await call('/api/tx', { cookie: aCookie, body: { ops: [{ type: 'put', table: 'projects', record: project }] } });

    const tamper = await call('/api/tx', { cookie: bCookie, body: { ops: [{ type: 'patch', table: 'projects', id: project.id, changes: { name: '被 B 改掉了' } }] } });
    expect(tamper.status).toBe(200);
    expect((tamper.body as { applied: number }).applied).toBe(0);
    expect((tamper.body as { skipped: unknown[] }).skipped.length).toBe(1);

    const wipe = await call('/api/tx', { cookie: bCookie, body: { ops: [{ type: 'delete', table: 'projects', id: project.id }] } });
    expect((wipe.body as { applied: number }).applied).toBe(0);

    const aSnap = (await call('/api/snapshot', { cookie: aCookie })).body as { data: { projects: { id: string; name: string }[] } };
    const row = aSnap.data.projects.find((p) => p.id === project.id);
    expect(row?.name).toBe('A 的原始名字');
  });

  it('B 用同一个 id 覆盖写入也会被拒，不会顶掉 A 的记录', async () => {
    const project = record({ name: 'A 独占' });
    await call('/api/tx', { cookie: aCookie, body: { ops: [{ type: 'put', table: 'projects', record: project }] } });
    const clash = await call('/api/tx', {
      cookie: bCookie,
      body: { ops: [{ type: 'put', table: 'projects', record: { ...project, name: 'B 想顶掉它' } }] },
    });
    expect((clash.body as { applied: number }).applied).toBe(0);
    const aSnap = (await call('/api/snapshot', { cookie: aCookie })).body as { data: { projects: { id: string; name: string }[] } };
    expect(aSnap.data.projects.find((p) => p.id === project.id)?.name).toBe('A 独占');
  });

  it('请求体自报的 userId 一律被忽略，写入按会话归属', async () => {
    const project = record({ userId: 'someone-else', name: '带假 userId' });
    const put = await call('/api/tx', { cookie: bCookie, body: { ops: [{ type: 'put', table: 'projects', record: project }] } });
    expect((put.body as { applied: number }).applied).toBe(1);
    const raw = db.prepare('SELECT userId FROM projects WHERE id = ?').get(project.id) as { userId: string };
    const bMe = (await call('/api/me', { cookie: bCookie })).body as { id: string };
    expect(raw.userId).toBe(bMe.id);
    expect(raw.userId).not.toBe('someone-else');
  });

  it('登出后旧会话立即失效', async () => {
    const login = await call('/api/auth/login', { body: { email: 'b@example.com', password: 'research2026!' } });
    const cookie = login.cookie as string;
    expect((await call('/api/snapshot', { cookie })).status).toBe(200);
    await call('/api/auth/logout', { method: 'POST', cookie });
    expect((await call('/api/snapshot', { cookie })).status).toBe(401);
    db.prepare('DELETE FROM loginAttempts').run();
  });
});

describe('校验与备份', () => {
  let cookie = '';

  beforeAll(async () => {
    db.prepare('DELETE FROM loginAttempts').run();
    const login = await call('/api/auth/login', { body: { email: 'owner@example.com', password: 'research2026!' } });
    cookie = login.cookie as string;
    expect(login.status).toBe(200);
  });

  it('非法枚举值整笔拒绝，已有数据不动', async () => {
    const before = (await call('/api/snapshot', { cookie })).body as { data: { projects: unknown[] } };
    const good = record();
    const ok = await call('/api/tx', { cookie, body: { ops: [{ type: 'put', table: 'projects', record: good }] } });
    expect(ok.status).toBe(200);

    const bad = await call('/api/tx', {
      cookie,
      body: { ops: [{ type: 'put', table: 'projects', record: record() }, { type: 'put', table: 'projects', record: record({ status: '外星状态' }) }] },
    });
    expect(bad.status).toBe(422);
    const after = (await call('/api/snapshot', { cookie })).body as { data: { projects: { id: string }[] } };
    // 上一笔成功的那条在，这一笔的两条都不在
    expect(after.data.projects.map((p) => p.id)).toContain(good.id);
    expect(after.data.projects).toHaveLength(before.data.projects.length + 1);
  });

  it('未知表名被拒', async () => {
    const res = await call('/api/tx', { cookie, body: { ops: [{ type: 'delete', table: 'users', id: 'x' }] } });
    expect(res.status).toBe(422);
  });

  it('备份导出后能在替换模式下原样写回', async () => {
    const backup = await call('/api/backup', { cookie });
    expect(backup.status).toBe(200);
    const data = (backup.body as { data: { projects: unknown[] } }).data;
    expect(Array.isArray(data.projects)).toBe(true);

    const imported = await call('/api/backup/import', { cookie, body: { mode: 'replace', data } });
    expect(imported.status).toBe(200);
    const after = (await call('/api/snapshot', { cookie })).body as { data: { projects: unknown[] } };
    expect(after.data.projects).toEqual(data.projects);
  });

  it('导入带非法记录时不做任何改动', async () => {
    const bad = { projects: [record({ status: 'nope' })], tasks: [], subtasks: [], milestones: [], experiments: [], references: [], tags: [], entityTags: [], projectReferences: [] };
    const res = await call('/api/backup/import', { cookie, body: { mode: 'replace', data: bad } });
    expect(res.status).toBe(422);
    const after = (await call('/api/snapshot', { cookie })).body as { data: { projects: unknown[] } };
    expect(after.data.projects.length).toBeGreaterThan(0);
  });

  it('清除演示数据只删 isDemo 行', async () => {
    await call('/api/tx', { cookie, body: { ops: [{ type: 'put', table: 'projects', record: record({ name: '演示', isDemo: true }) }] } });
    const before = (await call('/api/snapshot', { cookie })).body as { data: { projects: unknown[] } };
    const res = await call('/api/account/clear-demo', { method: 'POST', cookie });
    expect((res.body as { removed: number }).removed).toBe(1);
    const after = (await call('/api/snapshot', { cookie })).body as { data: { projects: unknown[] } };
    expect(after.data.projects.length).toBe(before.data.projects.length - 1);
  });
});

describe('账号安全与会话', () => {
  let main = '';
  let second = '';

  beforeAll(async () => {
    config.allowSignup = true;
    const res = await call('/api/auth/signup', { body: { email: 'sec@example.com', password: 'research2026!' } });
    expect(res.status).toBe(200);
    main = res.cookie as string;
    // 同一账号再登一台，模拟第二个设备
    const another = await call('/api/auth/login', { body: { email: 'sec@example.com', password: 'research2026!' } });
    second = another.cookie as string;
    config.allowSignup = false;
  });

  it('昵称：能设置、能清空、超长被拒，/api/me 跟着变', async () => {
    const set = await call('/api/auth/profile', { method: 'PATCH', cookie: main, body: { nickname: '  小研  ' } });
    expect(set.status).toBe(200);
    let me = await call('/api/me', { cookie: main });
    expect((me.body as { nickname: string }).nickname).toBe('小研');
    const tooLong = await call('/api/auth/profile', { method: 'PATCH', cookie: main, body: { nickname: 'x'.repeat(25) } });
    expect(tooLong.status).toBe(400);
    const clear = await call('/api/auth/profile', { method: 'PATCH', cookie: main, body: { nickname: '' } });
    expect(clear.status).toBe(200);
    me = await call('/api/me', { cookie: main });
    expect((me.body as { nickname: null }).nickname).toBeNull();
  });

  it('改密：当前密码错、新密码弱都被拒', async () => {
    const wrong = await call('/api/auth/change-password', { cookie: main, body: { currentPassword: 'nope-wrong-1', newPassword: 'research2027!' } });
    expect(wrong.status).toBe(400);
    const weak = await call('/api/auth/change-password', { cookie: main, body: { currentPassword: 'research2026!', newPassword: 'short' } });
    expect(weak.status).toBe(400);
  });

  it('改密成功后其他会话全部吊销，旧密码立即失效', async () => {
    const list = await call('/api/auth/sessions', { cookie: main });
    const rows = list.body.sessions as { id: string; current: boolean }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((s) => s.current)).toHaveLength(1);

    const change = await call('/api/auth/change-password', { cookie: main, body: { currentPassword: 'research2026!', newPassword: 'research2027!' } });
    expect(change.status).toBe(200);
    expect((change.body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
    expect((await call('/api/me', { cookie: second })).status).toBe(401);
    expect((await call('/api/me', { cookie: main })).status).toBe(200);
    expect((await call('/api/auth/login', { body: { email: 'sec@example.com', password: 'research2026!' } })).status).toBe(401);
    const relogin = await call('/api/auth/login', { body: { email: 'sec@example.com', password: 'research2027!' } });
    expect(relogin.status).toBe(200);
    second = relogin.cookie as string;
  });

  it('会话管理：能踢指定设备，踢当前设备被拒，一键踢其他', async () => {
    const list1 = await call('/api/auth/sessions', { cookie: main });
    const rows = list1.body.sessions as { id: string; current: boolean }[];
    const kickCurrent = await call('/api/auth/sessions/revoke', { cookie: main, body: { id: rows.find((s) => s.current)!.id } });
    expect(kickCurrent.status).toBe(400);
    const other = rows.find((s) => !s.current)!.id;
    const kickOne = await call('/api/auth/sessions/revoke', { cookie: main, body: { id: other } });
    expect(kickOne.status).toBe(200);
    expect((await call('/api/me', { cookie: second })).status).toBe(401);

    const third = await call('/api/auth/login', { body: { email: 'sec@example.com', password: 'research2027!' } });
    expect(third.status).toBe(200);
    const others = await call('/api/auth/sessions/revoke', { cookie: main, body: { others: true } });
    expect((others.body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
    expect((await call('/api/me', { cookie: third.cookie })).status).toBe(401);
    expect((await call('/api/me', { cookie: main })).status).toBe(200);
  });
});

describe('迁移', () => {
  it('重复执行不报错也不重复建表', () => {
    expect(() => migrate(db)).not.toThrow();
    expect(migrate(db).applied).toEqual([]);
    expect(appliedCount()).toBeGreaterThan(0);
  });
});

function appliedCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
}
