import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

export interface ResearchFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
}
export class FileError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new FileError(status, message);
};
const columns = 'id,name,mimeType,size,sha256,projectId,createdAt,updatedAt';
const nameOf = (value: unknown) => {
  if (typeof value !== 'string') return fail(400, '文件名无效');
  const name = value.trim();
  if (!name || name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(name) || name === '.' || name === '..')
    fail(400, '文件名须为 1–240 个字符，不能包含路径或控制字符');
  return name;
};
const mimeOf = (value: string | undefined) => {
  const mime = (value || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) || mime.length > 120) fail(400, '文件类型无效');
  return mime;
};
const header = (req: IncomingMessage, key: string) => {
  const value = req.headers[key];
  if (Array.isArray(value)) fail(400, '文件请求头重复');
  return value as string | undefined;
};
const projectOf = (db: DatabaseSync, userId: string, value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) return fail(400, '项目 ID 无效');
  if (!db.prepare('SELECT id FROM projects WHERE userId=? AND id=? AND deletedAt IS NULL').get(userId, value))
    fail(404, '关联项目不存在或不属于当前账号');
  return value as string;
};
async function bytesOf(req: IncomingMessage): Promise<Buffer> {
  const declared = header(req, 'content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > config.maxFileBytes))
    fail(413, '文件超过单文件容量限制');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.maxFileBytes) fail(413, '文件超过单文件容量限制');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks, size);
}
function used(db: DatabaseSync, userId: string) {
  return Number(
    (db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM researchFiles WHERE userId=?').get(userId) as { n: number }).n,
  );
}
function find(db: DatabaseSync, userId: string, id: string) {
  return db.prepare('SELECT ' + columns + ' FROM researchFiles WHERE userId=? AND id=?').get(userId, id) as
    | ResearchFileMetadata
    | undefined;
}
const downloadName = (name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  );
  return 'attachment; filename="' + ascii + "\"; filename*=UTF-8''" + encoded;
};

/** Called only after the normal session/CSRF checks. Identity is never accepted from request bodies. */
export async function handleResearchFiles(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  userId: string,
  pathname: string,
  json: () => Promise<unknown>,
) {
  const expectedOwner = header(req, 'x-file-owner');
  if (expectedOwner && expectedOwner !== userId) fail(409, '账号已切换，请在当前账号重新操作文件');
  const method = req.method || 'GET';
  const match = /^\/api\/files\/([^/]+)(\/content)?$/.exec(pathname);
  const reply = (body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  };
  if (pathname === '/api/files' && method === 'GET') {
    const files = db
      .prepare('SELECT ' + columns + ' FROM researchFiles WHERE userId=? ORDER BY updatedAt DESC,id')
      .all(userId);
    reply({ files, usedBytes: used(db, userId), quotaBytes: config.fileQuotaBytes, maxFileBytes: config.maxFileBytes });
    return;
  }
  if (pathname === '/api/files' && method === 'POST') {
    if ((header(req, 'content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/octet-stream')
      fail(415, '请使用二进制文件上传');
    let decoded = '';
    try {
      decoded = decodeURIComponent(header(req, 'x-file-name') || '');
    } catch {
      fail(400, '文件名编码无效');
    }
    const name = nameOf(decoded),
      mimeType = mimeOf(header(req, 'x-file-type'));
    const projectId = projectOf(db, userId, header(req, 'x-project-id'));
    const data = await bytesOf(req);
    const at = Date.now(),
      id = crypto.randomUUID();
    const metadata: ResearchFileMetadata = {
      id,
      name,
      mimeType,
      size: data.byteLength,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      projectId,
      createdAt: at,
      updatedAt: at,
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck after upload: concurrent requests may have consumed the account's remaining quota.
      if (used(db, userId) + metadata.size > config.fileQuotaBytes) fail(413, '账号文件容量不足，请删除不再需要的文件');
      if (projectId) projectOf(db, userId, projectId);
      db.prepare(
        'INSERT INTO researchFiles(id,userId,name,mimeType,size,sha256,projectId,createdAt,updatedAt,data) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ).run(id, userId, name, mimeType, metadata.size, metadata.sha256, projectId, at, at, data);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    reply(metadata);
    return;
  }
  if (!match) return fail(405, '不支持这个文件操作');
  const id = match[1];
  if (!/^[a-f0-9-]{36}$/i.test(id)) return fail(404, '文件不存在');
  const file = find(db, userId, id);
  if (!file) return fail(404, '文件不存在');
  if (method === 'GET' && match[2]) {
    const row = db.prepare('SELECT data FROM researchFiles WHERE userId=? AND id=?').get(userId, id) as {
      data: Uint8Array;
    };
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': file.size,
      'Content-Disposition': downloadName(file.name),
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Download-Options': 'noopen',
    });
    res.end(Buffer.from(row.data));
    return;
  }
  if (match[2]) return fail(405, '不支持这个文件操作');
  if (method === 'DELETE') {
    db.prepare('DELETE FROM researchFiles WHERE userId=? AND id=?').run(userId, id);
    reply({ ok: true });
    return;
  }
  if (method === 'PATCH') {
    const body = await json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, '文件修改必须是对象');
    const value = body as Record<string, unknown>;
    if (!Object.keys(value).length || Object.keys(value).some((key) => !['name', 'projectId'].includes(key)))
      fail(400, '仅支持修改文件名与关联项目');
    // 请求体读取期间其他标签页可能已改名、关联或删除文件；局部修改必须基于最新元数据。
    const current = find(db, userId, id);
    if (!current) return fail(404, '文件不存在');
    const name = Object.prototype.hasOwnProperty.call(value, 'name') ? nameOf(value.name) : current.name;
    const projectId = Object.prototype.hasOwnProperty.call(value, 'projectId')
      ? projectOf(db, userId, value.projectId)
      : current.projectId;
    const at = Date.now();
    db.prepare('UPDATE researchFiles SET name=?,projectId=?,updatedAt=? WHERE userId=? AND id=?').run(
      name,
      projectId,
      at,
      userId,
      id,
    );
    reply({ ...current, name, projectId, updatedAt: at });
    return;
  }
  fail(405, '不支持这个文件操作');
}
