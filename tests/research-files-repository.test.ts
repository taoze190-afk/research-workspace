import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blobArrayBuffer,
  deleteResearchFile,
  fileVault,
  listResearchFiles,
  MAX_RESEARCH_FILE_BYTES,
  rasterPreviewUrl,
  readResearchFile,
  RESEARCH_FILE_QUOTA_BYTES,
  saveResearchFile,
  updateResearchFile,
} from '@/features/files/repository';
import { setQueueOwner } from '@/data/sync';

const a = { owner: 'file-owner-a', mode: 'local' as const },
  b = { owner: 'file-owner-b', mode: 'local' as const };
beforeEach(async () => {
  await fileVault.files.clear();
  setQueueOwner(null);
  localStorage.removeItem('rw.account.v1');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setQueueOwner(null);
  localStorage.removeItem('rw.account.v1');
});
const textOf = async (blob: Blob) => new TextDecoder().decode(await blobArrayBuffer(blob));
describe('科研文件本机仓库', () => {
  it('保存二进制、关闭重开数据库后保留原内容和项目关联', async () => {
    const content = new Uint8Array([0, 255, 14, 32, 128, 10]);
    const saved = await saveResearchFile(
      new File([content], '实验原始数据.bin', { type: 'application/octet-stream' }),
      { ...a, projectId: 'project-a' },
    );
    expect(saved).toMatchObject({ name: '实验原始数据.bin', size: 6, projectId: 'project-a' });
    fileVault.close();
    await fileVault.open();
    const read = await readResearchFile(saved.id, a);
    expect([...new Uint8Array(await blobArrayBuffer(read))]).toEqual([...content]);
    expect((await listResearchFiles(a.owner, a.mode)).usedBytes).toBe(6);
  });
  it('账号不能读取、重命名或删除另一个账号的文件', async () => {
    const saved = await saveResearchFile(new File(['data'], '数据.txt', { type: 'text/plain' }), a);
    expect((await listResearchFiles(b.owner, b.mode)).files).toEqual([]);
    await expect(readResearchFile(saved.id, b)).rejects.toMatchObject({ status: 404 });
    await expect(updateResearchFile(saved.id, { name: '抢改.txt' }, b)).rejects.toMatchObject({ status: 404 });
    await expect(deleteResearchFile(saved.id, b)).rejects.toMatchObject({ status: 404 });
    expect(await textOf(await readResearchFile(saved.id, a))).toBe('data');
  });
  it('重命名和关联项目不改变原始字节，删除后不可读取', async () => {
    const saved = await saveResearchFile(new File(['测试内容'], '笔记.md', { type: 'text/markdown' }), a);
    const next = await updateResearchFile(saved.id, { name: '研究笔记.md', projectId: 'p' }, a);
    expect(next).toMatchObject({ name: '研究笔记.md', projectId: 'p', size: saved.size });
    expect(await textOf(await readResearchFile(saved.id, a))).toBe('测试内容');
    await updateResearchFile(saved.id, { projectId: null }, a);
    expect((await listResearchFiles(a.owner, a.mode)).files[0].projectId).toBeNull();
    await deleteResearchFile(saved.id, a);
    await expect(readResearchFile(saved.id, a)).rejects.toMatchObject({ status: 404 });
  });
  it('拒绝超大文件和路径文件名，失败后不留下空记录', async () => {
    const large = new File(['x'], '超大.bin');
    Object.defineProperty(large, 'size', { value: MAX_RESEARCH_FILE_BYTES + 1 });
    await expect(saveResearchFile(large, a)).rejects.toMatchObject({ status: 413 });
    await expect(saveResearchFile(new File(['x'], '../wrong.txt'), a)).rejects.toThrow('文件名');
    expect((await listResearchFiles(a.owner, a.mode)).files).toHaveLength(0);
  });
  it('空间不足的整次上传不保存任何元数据或内容', async () => {
    const saved = await saveResearchFile(new File(['x'], '已有数据.txt'), a);
    const stored = await fileVault.files.get([a.owner, saved.id]);
    await fileVault.files.put({ ...stored!, size: RESEARCH_FILE_QUOTA_BYTES });
    await expect(saveResearchFile(new File(['new'], '新文件.txt'), a)).rejects.toMatchObject({ status: 413 });
    expect((await listResearchFiles(a.owner, a.mode)).files).toHaveLength(1);
    expect(await textOf(await readResearchFile(saved.id, a))).toBe('x');
  });
  it('SVG与伪装图片不能进入内联预览', async () => {
    const create = vi.fn(() => 'blob:test');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
      },
    );
    expect(await rasterPreviewUrl(new Blob(['<svg onload="bad">'], { type: 'image/svg+xml' }))).toBeNull();
    expect(await rasterPreviewUrl(new Blob(['<html>'], { type: 'image/png' }))).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(
      await rasterPreviewUrl(
        new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' }),
      ),
    ).toBe('blob:test');
  });
});
describe('科研文件服务器请求', () => {
  it('上传原始二进制并带会话预期owner，不在JSON里塞文件内容', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 's',
            name: '科研 表.csv',
            size: 3,
            mimeType: 'text/csv',
            sha256: 'hash',
            projectId: 'p',
            createdAt: 1,
            updatedAt: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await saveResearchFile(new File(['a,b'], '科研 表.csv', { type: 'text/csv' }), {
      owner: 'account-a',
      mode: 'server',
      projectId: 'p',
    });
    expect(result.id).toBe('s');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/files');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'x-rw-client': 'rw',
        'x-file-owner': 'account-a',
        'x-file-name': encodeURIComponent('科研 表.csv'),
        'x-project-id': 'p',
      },
    });
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('a,b');
  });
  it('账号切换时不发送旧上下文的上传请求', async () => {
    setQueueOwner('new-account');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      saveResearchFile(new File(['x'], 'old.txt'), { owner: 'old-account', mode: 'server' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('服务器拒绝与连接失败会原样返回可重试错误', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"文件空间已满"}', { status: 413 }))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    await expect(saveResearchFile(new File(['x'], 'a.txt'), { owner: 'a', mode: 'server' })).rejects.toThrow(
      '文件空间已满',
    );
    await expect(listResearchFiles('a', 'server')).rejects.toThrow('连接不到文件服务');
  });
  it('取消原文件读取会中止网络请求，而不是误报连接失败', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const reading = readResearchFile('file-a', { owner: 'a', mode: 'server' }, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
