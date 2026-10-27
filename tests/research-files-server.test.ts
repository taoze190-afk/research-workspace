// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase, migrate } from '../server/src/schema';
import { createUser } from '../server/src/auth';
import { createRequestHandler } from '../server/src/http';
import { applyOps } from '../server/src/store';
import { config } from '../server/src/config';
import { cleanAiMessages, validateAiImage, MAX_AI_IMAGE_BYTES } from '../server/src/ai-input';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-files-server-'));
const databasePath = path.join(temporary, 'files.db');
let db = openDatabase(databasePath);
migrate(db);
const first = createUser(db, 'file-a@example.test', 'research2026!');
const second = createUser(db, 'file-b@example.test', 'research2026!');
const third = createUser(db, 'file-quota@example.test', 'research2026!');
if (!first.ok || !second.ok || !third.ok) throw new Error('不能创建文件测试账号');
const a = first,
  b = second,
  quotaUser = third;
const server = createServer((req, res) => void createRequestHandler(db)(req, res));
let base = '';
const userProject = 'files-project-a';
const otherProject = 'files-project-b';
const project = (id: string) => ({
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
applyOps(db, a.user.id, [{ type: 'put', table: 'projects', record: project(userProject) }]);
applyOps(db, b.user.id, [{ type: 'put', table: 'projects', record: project(otherProject) }]);
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let modelCalls = 0;
let modelBody: Record<string, unknown> = {};
const model = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  modelCalls++;
  modelBody = JSON.parse(Buffer.concat(chunks).toString());
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '已读取图片与文字' } }] }));
});
const oldBase = process.env.AI_BASE_URL,
  oldKey = process.env.AI_API_KEY;
const listen = (s: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)));
beforeAll(async () => {
  base = 'http://127.0.0.1:' + (await listen(server));
  process.env.AI_BASE_URL = 'http://127.0.0.1:' + (await listen(model)) + '/v1';
  process.env.AI_API_KEY = 'test-file-model-key';
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(
    'platform.ai',
    JSON.stringify({ provider: 'custom', model: 'file-test-model', enabled: true }),
  );
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => model.close(() => resolve())),
  ]);
  db.close();
  if (oldBase === undefined) delete process.env.AI_BASE_URL;
  else process.env.AI_BASE_URL = oldBase;
  if (oldKey === undefined) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = oldKey;
  const target = path.resolve(temporary),
    root = path.resolve(os.tmpdir());
  if (!target.startsWith(root + path.sep) || !path.basename(target).startsWith('rw-files-server-'))
    throw new Error('拒绝清理非测试目录');
  fs.rmSync(target, { recursive: true, force: true });
});
type RequestOptions = {
  method?: string;
  token?: string;
  csrf?: boolean;
  headers?: Record<string, string>;
  body?: BodyInit;
  json?: unknown;
};
async function call(route: string, options: RequestOptions = {}) {
  const response = await fetch(base + route, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { cookie: 'rw_session=' + options.token } : {}),
      ...(options.csrf === false ? {} : { 'x-rw-client': 'rw' }),
      ...(options.json === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.json === undefined ? options.body : JSON.stringify(options.json),
  });
  const raw = Buffer.from(await response.arrayBuffer());
  let value: Record<string, unknown> = {};
  if (response.headers.get('content-type')?.includes('application/json')) value = JSON.parse(raw.toString());
  return { status: response.status, headers: response.headers, raw, value };
}
const upload = (name: string, data: Uint8Array, options: RequestOptions = {}) =>
  call('/api/files', {
    ...options,
    method: 'POST',
    token: options.token ?? a.token,
    body: Buffer.from(data),
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'x-file-type': 'application/octet-stream',
      ...options.headers,
    },
  });

describe('科研文件存储与权限', () => {
  it('匿名不能列举、上传、下载，写操作要求CSRF', async () => {
    expect((await call('/api/files')).status).toBe(401);
    expect((await call('/api/files/00000000-0000-0000-0000-000000000000/content')).status).toBe(401);
    expect((await call('/api/files', { method: 'POST', body: 'x' })).status).toBe(401);
    expect((await upload('no-csrf.bin', new Uint8Array([1]), { csrf: false })).status).toBe(403);
  });
  it('原始二进制完整保存、下载和重新打开数据库后仍存在', async () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 0, 1, 2]);
    const result = await upload('科研样本 ①.bin', bytes, {
      headers: { 'x-project-id': userProject, 'x-file-owner': a.user.id },
    });
    expect(result.status).toBe(200);
    expect(result.value).toMatchObject({
      name: '科研样本 ①.bin',
      size: bytes.length,
      projectId: userProject,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(result.value).not.toHaveProperty('data');
    expect(result.value).not.toHaveProperty('userId');
    const id = String(result.value.id);
    db.close();
    db = openDatabase(databasePath);
    migrate(db);
    const downloaded = await call('/api/files/' + id + '/content', { token: a.token });
    expect(downloaded.status).toBe(200);
    expect(downloaded.raw).toEqual(Buffer.from(bytes));
    expect(downloaded.headers.get('content-type')).toBe('application/octet-stream');
    expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
    expect(downloaded.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''" + encodeURIComponent('科研样本 ①.bin'),
    );
    const listing = await call('/api/files', { token: a.token });
    expect(listing.value.files).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    expect(listing.value.usedBytes).toBeGreaterThanOrEqual(bytes.length);
    expect(listing.value.maxFileBytes).toBe(25 * 1024 * 1024);
  });
  it('跨账号不能读取、修改或删除，伪造expected-owner不会变更归属', async () => {
    const created = await upload('private.txt', new TextEncoder().encode('仅属于A'));
    const id = String(created.value.id);
    expect((await call('/api/files/' + id + '/content', { token: b.token })).status).toBe(404);
    expect((await call('/api/files/' + id, { method: 'DELETE', token: b.token })).status).toBe(404);
    expect(
      (await call('/api/files/' + id, { method: 'PATCH', token: b.token, json: { name: 'stolen.txt' } })).status,
    ).toBe(404);
    const listing = await call('/api/files', { token: b.token });
    expect(listing.value.files).toEqual([]);
    expect(
      (await upload('wrong-owner.txt', new Uint8Array([1]), { headers: { 'x-file-owner': b.user.id } })).status,
    ).toBe(409);
    expect(
      (await call('/api/files/' + id + '/content', { token: a.token, headers: { 'x-file-owner': b.user.id } })).status,
    ).toBe(409);
    expect((await call('/api/files/' + id + '/content', { token: a.token })).status).toBe(200);
  });
  it('只关联当前账号未删除项目，安全重命名且可解除关联', async () => {
    expect(
      (await upload('foreign.bin', new Uint8Array([1]), { headers: { 'x-project-id': otherProject } })).status,
    ).toBe(404);
    const file = await upload('rename.txt', new Uint8Array([1]));
    const id = String(file.value.id);
    const changed = await call('/api/files/' + id, {
      method: 'PATCH',
      token: a.token,
      json: { name: '新名字.txt', projectId: userProject },
    });
    expect(changed.value).toMatchObject({ name: '新名字.txt', projectId: userProject });
    expect(
      (await call('/api/files/' + id, { method: 'PATCH', token: a.token, json: { projectId: otherProject } })).status,
    ).toBe(404);
    expect(
      (await call('/api/files/' + id, { method: 'PATCH', token: a.token, json: { userId: b.user.id } })).status,
    ).toBe(400);
    expect(
      (await call('/api/files/' + id, { method: 'PATCH', token: a.token, json: { projectId: null } })).value.projectId,
    ).toBeNull();
    expect((await call('/api/files/' + id, { method: 'DELETE', token: a.token, csrf: false })).status).toBe(403);
    expect((await call('/api/files/' + id, { method: 'DELETE', token: a.token })).status).toBe(200);
    expect((await call('/api/files/' + id + '/content', { token: a.token })).status).toBe(404);
  });
  it('慢速改名请求不会覆盖其他标签页刚更新的项目关联', async () => {
    const file = await upload('并发修改.txt', new Uint8Array([1]));
    const id = String(file.value.id);
    const body = Buffer.from(JSON.stringify({ name: '保留新关联.txt' }));
    const received = new Promise<void>((resolve) => server.once('request', () => resolve()));
    let finish!: () => void;
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const pending = request(
        base + '/api/files/' + id,
        {
          method: 'PATCH',
          headers: {
            cookie: 'rw_session=' + a.token,
            'x-rw-client': 'rw',
            'content-type': 'application/json',
            'content-length': body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
          res.on('error', reject);
        },
      );
      pending.on('error', reject);
      pending.write(body.subarray(0, 5));
      finish = () => pending.end(body.subarray(5));
    });
    await received;
    try {
      expect(
        (await call('/api/files/' + id, { method: 'PATCH', token: a.token, json: { projectId: userProject } })).status,
      ).toBe(200);
    } finally {
      finish();
    }
    expect(await response).toMatchObject({ name: '保留新关联.txt', projectId: userProject });
  });
  it('拒绝路径、控制字符与非法类型，空文件也可完整保存', async () => {
    for (const name of ['../payload.html', 'a\\x', 'line\r\nheader', '', '..'])
      expect((await upload(name, new Uint8Array([1]))).status).toBe(400);
    expect((await upload('bad.bin', new Uint8Array([1]), { headers: { 'x-file-type': 'notmime' } })).status).toBe(400);
    const zero = await upload('empty.txt', new Uint8Array());
    expect(zero.status).toBe(200);
    expect((await call('/api/files/' + zero.value.id + '/content', { token: a.token })).raw.length).toBe(0);
  });
  it('HTML等可执行内容只能作为下载附件返回', async () => {
    const bytes = Buffer.from('<script>globalThis.fileShouldNotExecute=true</script>');
    const uploaded = await upload('科研页面.html', bytes, { headers: { 'x-file-type': 'text/html' } });
    const response = await call('/api/files/' + uploaded.value.id + '/content', { token: a.token });
    expect(response.raw).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('单文件和账号配额均是硬限制，失败不会残留部分文件', async () => {
    const max = config.maxFileBytes,
      quota = config.fileQuotaBytes;
    try {
      config.maxFileBytes = 8;
      config.fileQuotaBytes = 10;
      expect((await upload('large.bin', new Uint8Array(9), { token: quotaUser.token })).status).toBe(413);
      expect((await upload('first.bin', new Uint8Array(8), { token: quotaUser.token })).status).toBe(200);
      expect((await upload('over-quota.bin', new Uint8Array(3), { token: quotaUser.token })).status).toBe(413);
      const files = await call('/api/files', { token: quotaUser.token });
      expect(files.value.usedBytes).toBe(8);
      expect(files.value.files).toHaveLength(1);
    } finally {
      config.maxFileBytes = max;
      config.fileQuotaBytes = quota;
    }
  });
});

describe('AI 图片输入与平台转发', () => {
  it('接受安全图片与文字内容，并原样转交配置的模型', async () => {
    const response = await call('/api/ai/chat', {
      method: 'POST',
      token: a.token,
      json: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '解释截图' },
              { type: 'image_url', image_url: { url: png } },
            ],
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(response.value.content).toContain('图片');
    expect(modelBody.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '解释截图' },
          { type: 'image_url', image_url: { url: png } },
        ],
      },
    ]);
  });
  it('多图请求可超过普通8MiB JSON上限并保留所有图片', async () => {
    // 合法PNG附加一段大的tEXt元数据，使测试图片仍是1×1，避免生成或解压大像素。
    const original = Buffer.from(png.split(',')[1], 'base64');
    const textData = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(1_600_000, 97)]);
    const chunk = Buffer.alloc(12 + textData.length);
    chunk.writeUInt32BE(textData.length);
    chunk.write('tEXt', 4, 'ascii');
    textData.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    const large =
      'data:image/png;base64,' +
      Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]).toString('base64');
    const payload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '比较四张图片' },
            ...Array.from({ length: 4 }, () => ({ type: 'image_url', image_url: { url: large } })),
          ],
        },
      ],
    };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(8 * 1024 * 1024);
    const response = await call('/api/ai/chat', { method: 'POST', token: a.token, json: payload });
    expect(response.status).toBe(200);
    expect((modelBody.messages as { content: unknown[] }[])[0].content).toHaveLength(5);
  });
  it('拒绝外部URL、SVG、伪造图片、超限图片和非用户图片消息', async () => {
    const calls = modelCalls;
    for (const invalid of [
      'https://example.test/image.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      png.replace('image/png', 'image/jpeg'),
      'data:image/png;base64,aGVsbG8=',
    ]) {
      expect(
        (
          await call('/api/ai/chat', {
            method: 'POST',
            token: a.token,
            json: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: invalid } }] }] },
          })
        ).status,
      ).toBe(400);
    }
    expect(() =>
      validateAiImage('data:image/png;base64,' + Buffer.alloc(MAX_AI_IMAGE_BYTES + 1).toString('base64')),
    ).toThrow();
    expect(() =>
      cleanAiMessages([{ role: 'assistant', content: [{ type: 'image_url', image_url: { url: png } }] }]),
    ).toThrow();
    expect(() =>
      cleanAiMessages([
        { role: 'user', content: Array.from({ length: 7 }, () => ({ type: 'image_url', image_url: { url: png } })) },
      ]),
    ).toThrow(/6/);
    expect(modelCalls).toBe(calls);
  });
  it('文字预算仍保留60000，纯文字旧请求保持兼容', () => {
    expect(
      cleanAiMessages([
        { role: 'system', content: '要求' },
        { role: 'user', content: '普通问题' },
      ]),
    ).toEqual([
      { role: 'system', content: '要求' },
      { role: 'user', content: '普通问题' },
    ]);
    expect(() => cleanAiMessages([{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(60001) }] }])).toThrow(
      /过长/,
    );
    expect(config.maxAiBodyBytes).toBe(20 * 1024 * 1024);
  });
});
