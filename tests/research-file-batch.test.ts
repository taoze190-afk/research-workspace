import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { buildResearchArchive, MAX_ARCHIVE_BYTES } from '@/features/files/archive';
import { blobArrayBuffer, type ResearchFileMetadata } from '@/features/files/repository';
import { filesAiHref, incomingFileIds } from '@/features/files/presentation';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/features/files/repository', async (original) => ({
  ...(await original<typeof import('@/features/files/repository')>()),
  readResearchFile: mocks.read,
}));
const context = { owner: 'user-a', mode: 'server' as const };
const file = (id: string, name: string, size = 3, projectId: string | null = 'p'): ResearchFileMetadata => ({
  id,
  name,
  size,
  mimeType: 'application/octet-stream',
  sha256: 'h',
  projectId,
  createdAt: Date.UTC(2026, 9, 26),
  updatedAt: 1,
});
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
describe('科研原件批量导出', () => {
  it('同名与大小写冲突文件不会覆盖，解压后每份原字节均保留', async () => {
    const content = [new Uint8Array([0, 255, 12]), new Uint8Array([1, 2, 3]), new Uint8Array([8, 9, 10])];
    mocks.read.mockImplementation((id: string) => Promise.resolve(new Blob([content[Number(id)]])));
    const archive = await buildResearchArchive(
      [file('0', 'Result.csv'), file('1', 'result.csv'), file('2', 'Result (2).csv')],
      context,
    );
    const zip = await JSZip.loadAsync(await blobArrayBuffer(archive));
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    expect(entries).toHaveLength(3);
    const unpacked = await Promise.all(entries.map((entry) => entry.async('uint8array')));
    expect(unpacked.map((bytes) => [...bytes])).toEqual(content.map((bytes) => [...bytes]));
    expect(mocks.read).toHaveBeenNthCalledWith(1, '0', context, undefined);
  });
  it('压缩包文件名不能包含目录逃逸或 Windows 设备名', async () => {
    mocks.read.mockResolvedValue(new Blob(['abc']));
    const archive = await buildResearchArchive(
      [file('a', '../数据.csv'), file('b', 'CON.txt'), file('c', 'a\\b.txt')],
      context,
    );
    const zip = await JSZip.loadAsync(await blobArrayBuffer(archive));
    expect(Object.keys(zip.files)).toEqual(['_数据.csv', '_CON.txt', 'a_b.txt']);
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);
  });
  it('缺失或不完整文件拒绝整包，不返回只有部分内容的压缩包', async () => {
    mocks.read.mockResolvedValueOnce(new Blob(['abc'])).mockRejectedValueOnce(new Error('文件已删除'));
    await expect(buildResearchArchive([file('a', 'a.txt'), file('b', 'b.txt')], context)).rejects.toThrow('文件已删除');
    mocks.read.mockResolvedValueOnce(new Blob(['x']));
    await expect(buildResearchArchive([file('a', 'a.txt')], context)).rejects.toThrow('内容不完整');
  });
  it('超额或已取消的打包在读取原文件前结束', async () => {
    await expect(buildResearchArchive([file('a', 'a.bin', MAX_ARCHIVE_BYTES + 1)], context)).rejects.toThrow('100 MB');
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildResearchArchive([file('a', 'a.txt')], context, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
describe('多文件 AI 入口', () => {
  it('同项目文件保留项目范围和完整文件 ID，重复文件只附带一次', () => {
    const first = file('a&b', 'a.txt');
    const params = new URL(filesAiHref([first, file('second', 'b.txt'), first]), 'http://local').searchParams;
    expect(params.get('scope')).toBe('project:p');
    expect(incomingFileIds(params)).toEqual(['a&b', 'second']);
  });
  it('跨项目范围退到工作台，超过六个文件明确拒绝而非丢弃', () => {
    expect(
      new URL(filesAiHref([file('a', 'a.txt'), file('b', 'b.txt', 3, 'other')]), 'http://local').searchParams.get(
        'scope',
      ),
    ).toBe('workspace');
    expect(() => filesAiHref(Array.from({ length: 7 }, (_, n) => file(String(n), n + '.txt')))).toThrow('1–6');
    expect(() => filesAiHref([])).toThrow('1–6');
  });
});
