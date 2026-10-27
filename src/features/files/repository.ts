import Dexie, { type Table } from 'dexie';
import { createId } from '@/lib/id';
import { rememberedAccount } from '@/data/sync';

export type FileStorageMode = 'local' | 'server';
export interface FileStorageContext {
  owner: string;
  mode: FileStorageMode;
  projectId?: string | null;
}
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
export interface ResearchFileList {
  files: ResearchFileMetadata[];
  usedBytes: number;
  quotaBytes: number;
  maxFileBytes: number;
}
interface StoredFile extends ResearchFileMetadata {
  owner: string;
  bytes: ArrayBuffer;
}
export const MAX_RESEARCH_FILE_BYTES = 25 * 1024 * 1024;
export const RESEARCH_FILE_QUOTA_BYTES = 500 * 1024 * 1024;

class ResearchFileDatabase extends Dexie {
  files!: Table<StoredFile, [string, string]>;
  constructor() {
    super('research-file-vault');
    this.version(1).stores({ files: '[owner+id], owner, [owner+projectId], updatedAt' });
  }
}
export const fileVault = new ResearchFileDatabase();
export class FileStorageError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'FileStorageError';
  }
}
const metadata = ({ owner: _owner, bytes: _bytes, ...row }: StoredFile): ResearchFileMetadata => row;
const safeName = (value: string) => {
  const name = value.trim();
  if (!name || name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(name))
    throw new FileStorageError('文件名需为 1–240 个字符，不能包含路径或控制字符。');
  return name;
};
const safeType = (type: string) =>
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type) ? type.toLowerCase() : 'application/octet-stream';
const validContext = (context: FileStorageContext) => {
  if (!context.owner) throw new FileStorageError('当前账号不可用，请重新登录。', 401);
  const actor = rememberedAccount();
  if (context.mode === 'server' && actor && actor !== context.owner)
    throw new FileStorageError('账号已切换，请重新选择文件。', 409);
};
export async function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new FileStorageError('文件读取失败，请重新选择。'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}
async function digest(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function storageError(error: unknown): Error {
  if (error instanceof FileStorageError) return error;
  const name = (error as Error)?.name;
  return new FileStorageError(
    name === 'QuotaExceededError'
      ? '浏览器存储空间不足，请删除不需要的文件后重试。'
      : name === 'NotAllowedError'
        ? '浏览器未允许保存文件，请检查存储权限。'
        : (error as Error)?.message || '文件保存失败，请重试。',
  );
}
async function remote(path: string, context: FileStorageContext, init: RequestInit = {}): Promise<Response> {
  validContext(context);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'x-rw-client': 'rw', 'x-file-owner': context.owner, ...init.headers },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new FileStorageError('连接不到文件服务，请稍后重试。');
  }
  validContext(context);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FileStorageError(body.error || '文件操作失败（' + response.status + '）', response.status);
  }
  return response;
}
export async function listResearchFiles(owner: string, mode: FileStorageMode): Promise<ResearchFileList> {
  const context = { owner, mode };
  validContext(context);
  if (mode === 'server') return (await remote('/api/files', context)).json();
  try {
    const rows = await fileVault.files.where('owner').equals(owner).toArray();
    return {
      files: rows.map(metadata).sort((a, b) => b.updatedAt - a.updatedAt),
      usedBytes: rows.reduce((n, r) => n + r.size, 0),
      quotaBytes: RESEARCH_FILE_QUOTA_BYTES,
      maxFileBytes: MAX_RESEARCH_FILE_BYTES,
    };
  } catch (error) {
    throw storageError(error);
  }
}
export async function saveResearchFile(file: File, context: FileStorageContext): Promise<ResearchFileMetadata> {
  validContext(context);
  const name = safeName(file.name),
    mimeType = safeType(file.type);
  if (file.size > MAX_RESEARCH_FILE_BYTES) throw new FileStorageError('单个文件不能超过 25 MB。', 413);
  if (context.mode === 'server') {
    const bytes = await blobArrayBuffer(file);
    validContext(context);
    return (
      await remote('/api/files', context, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(name),
          'x-file-type': mimeType,
          ...(context.projectId ? { 'x-project-id': context.projectId } : {}),
        },
        body: bytes,
      })
    ).json();
  }
  try {
    const bytes = await blobArrayBuffer(file);
    const now = Date.now();
    const row: StoredFile = {
      id: createId(),
      owner: context.owner,
      name,
      mimeType,
      size: bytes.byteLength,
      sha256: await digest(bytes),
      projectId: context.projectId ?? null,
      createdAt: now,
      updatedAt: now,
      bytes,
    };
    await fileVault.transaction('rw', fileVault.files, async () => {
      const rows = await fileVault.files.where('owner').equals(context.owner).toArray();
      if (rows.reduce((n, r) => n + r.size, 0) + row.size > RESEARCH_FILE_QUOTA_BYTES)
        throw new FileStorageError('文件空间已满，请删除不需要的文件后重试。', 413);
      await fileVault.files.add(row);
    });
    return metadata(row);
  } catch (error) {
    throw storageError(error);
  }
}
export async function readResearchFile(id: string, context: FileStorageContext, signal?: AbortSignal): Promise<Blob> {
  validContext(context);
  if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError');
  if (context.mode === 'server')
    return (
      await remote('/api/files/' + encodeURIComponent(id) + '/content', context, signal ? { signal } : {})
    ).blob();
  const row = await fileVault.files.get([context.owner, id]);
  if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError');
  if (!row) throw new FileStorageError('文件不存在或不属于当前账号。', 404);
  return new Blob([row.bytes], { type: row.mimeType });
}
export async function updateResearchFile(
  id: string,
  changes: { name?: string; projectId?: string | null },
  context: FileStorageContext,
): Promise<ResearchFileMetadata> {
  validContext(context);
  const patch = { ...changes, ...(changes.name !== undefined ? { name: safeName(changes.name) } : {}) };
  if (context.mode === 'server')
    return (
      await remote('/api/files/' + encodeURIComponent(id), context, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
    ).json();
  try {
    return await fileVault.transaction('rw', fileVault.files, async () => {
      const row = await fileVault.files.get([context.owner, id]);
      if (!row) throw new FileStorageError('文件不存在或不属于当前账号。', 404);
      const next = { ...row, ...patch, updatedAt: Date.now() };
      await fileVault.files.put(next);
      return metadata(next);
    });
  } catch (error) {
    throw storageError(error);
  }
}
export async function deleteResearchFile(id: string, context: FileStorageContext): Promise<void> {
  validContext(context);
  if (context.mode === 'server') {
    await remote('/api/files/' + encodeURIComponent(id), context, { method: 'DELETE' });
    return;
  }
  try {
    await fileVault.transaction('rw', fileVault.files, async () => {
      if (!(await fileVault.files.get([context.owner, id])))
        throw new FileStorageError('文件不存在或不属于当前账号。', 404);
      await fileVault.files.delete([context.owner, id]);
    });
  } catch (error) {
    throw storageError(error);
  }
}
export async function downloadResearchFile(file: ResearchFileMetadata, context: FileStorageContext): Promise<void> {
  const blob = await readResearchFile(file.id, context);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
}
/** SVG/HTML 永远不作为内联预览；安全栅格还需匹配文件头。 */
export async function rasterPreviewUrl(blob: Blob): Promise<string | null> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 10 * 1024 * 1024) return null;
  const head = new Uint8Array(await blobArrayBuffer(blob.slice(0, 16)));
  const png =
    head[0] === 137 &&
    head[1] === 80 &&
    head[2] === 78 &&
    head[3] === 71 &&
    head[4] === 13 &&
    head[5] === 10 &&
    head[6] === 26 &&
    head[7] === 10;
  const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  const webp =
    String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  return (blob.type === 'image/png' && png) ||
    (blob.type === 'image/jpeg' && jpeg) ||
    (blob.type === 'image/webp' && webp)
    ? URL.createObjectURL(blob)
    : null;
}
