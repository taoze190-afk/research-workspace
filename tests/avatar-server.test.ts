// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/src/schema';
import { createRequestHandler } from '../server/src/http';
import { createUser } from '../server/src/auth';
import { parseAvatarDataUrl, MAX_AVATAR_BYTES } from '../server/src/avatar';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
migrate(db);
const first = createUser(db, 'avatar-a@example.test', 'research2026!');
const second = createUser(db, 'avatar-b@example.test', 'research2026!');
if (!first.ok || !second.ok) throw new Error('无法创建头像测试账号');
const server = createServer((req, res) => void createRequestHandler(db)(req, res));
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('测试服务不可用');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});
async function call(path: string, token?: string, body?: unknown, csrf = true) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      ...(token ? { cookie: `rw_session=${token}` } : {}),
      ...(csrf ? { 'x-rw-client': 'rw' } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe('头像内容约束', () => {
  it('接受有效的小型PNG与移除请求', () => {
    expect(parseAvatarDataUrl(png)).toBe(png);
    expect(parseAvatarDataUrl(null)).toBeNull();
  });
  it('拒绝SVG、远程地址、损坏图片、伪造类型与超限图片', () => {
    for (const invalid of [
      undefined,
      '',
      'https://example.test/avatar.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      png.replace('image/png', 'image/jpeg'),
      'data:image/png;base64,aGVsbG8=',
      `data:image/png;base64,${Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64')}`,
    ])
      expect(() => parseAvatarDataUrl(invalid)).toThrow();
  });
  it('拒绝超大像素尺寸，不能仅靠小文件通过验证', () => {
    const image = Buffer.from(png.split(',')[1], 'base64');
    image.writeUInt32BE(20000, 16);
    expect(() => parseAvatarDataUrl(`data:image/png;base64,${image.toString('base64')}`)).toThrow(/尺寸/);
  });
});

describe('头像账号归属与持久读取', () => {
  it('匿名和缺少CSRF头不能上传', async () => {
    expect((await call('/api/auth/avatar', undefined, { avatarDataUrl: png })).status).toBe(401);
    expect((await call('/api/auth/avatar', first.token, { avatarDataUrl: png }, false)).status).toBe(403);
  });
  it('保存到当前账号，忽略请求中的其他userId，me及重新登录均读取头像', async () => {
    expect((await call('/api/auth/avatar', first.token, { avatarDataUrl: png, userId: second.user.id })).status).toBe(
      200,
    );
    expect((await call('/api/me', first.token)).body.avatarDataUrl).toBe(png);
    expect((await call('/api/me', second.token)).body.avatarDataUrl).toBeNull();
    expect(db.prepare('SELECT avatarDataUrl FROM users WHERE id=?').get(first.user.id)).toEqual({ avatarDataUrl: png });
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
      body: JSON.stringify({ email: first.user.email, password: 'research2026!' }),
    });
    expect((await response.json()).user.avatarDataUrl).toBe(png);
    const renamed = await call('/api/auth/profile', first.token, { nickname: '新的昵称' });
    expect(renamed.body.user.avatarDataUrl).toBe(png);
    expect((await call('/api/me', first.token)).body.avatarDataUrl).toBe(png);
  });
  it('坏文件不会覆盖原头像；移除后回到空头像', async () => {
    expect(
      (await call('/api/auth/avatar', first.token, { avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).status,
    ).toBe(400);
    expect((await call('/api/me', first.token)).body.avatarDataUrl).toBe(png);
    expect((await call('/api/auth/avatar', first.token, { avatarDataUrl: null })).status).toBe(200);
    expect((await call('/api/me', first.token)).body.avatarDataUrl).toBeNull();
  });
});
