import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FilePreview } from '@/features/files/FilePreview';
import { AttachmentStrip } from '@/features/ai/AttachmentStrip';

const mocks = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), download: vi.fn() }));
vi.mock('@/features/files/repository', async (original) => ({
  ...(await original<typeof import('@/features/files/repository')>()),
  readResearchFile: mocks.read,
  listResearchFiles: mocks.list,
  downloadResearchFile: mocks.download,
}));
const file = { id: 'note', name: '实验笔记.txt', mimeType: 'text/plain', size: 10 };
const context = { owner: 'user-a', mode: 'server' as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(new Blob(['保存的科研正文']));
});
afterEach(cleanup);
describe('共享原文件预览', () => {
  it('读取失败可重试，成功后显示真实内容', async () => {
    mocks.read.mockRejectedValueOnce(new Error('暂时无法连接'));
    render(<FilePreview file={file} context={context} />);
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法连接');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    expect(await screen.findByText('保存的科研正文')).toBeTruthy();
    expect(mocks.read).toHaveBeenLastCalledWith('note', context, expect.any(AbortSignal));
  });
  it('正确解码 UTF-16 文本，正文中的标签始终作为文字显示', async () => {
    const value = '<script>实验数据</script>';
    const bytes = new Uint8Array(2 + value.length * 2);
    bytes.set([255, 254]);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(2 + i * 2, value.charCodeAt(i), true);
    mocks.read.mockResolvedValue(new Blob([bytes]));
    const { container } = render(<FilePreview file={file} context={context} />);
    expect(await screen.findByText(value)).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });
  it('切换账号或文件后，旧的异步读取不能覆盖新预览', async () => {
    let resolveOld!: (value: Blob) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(<FilePreview file={file} context={context} />);
    rerender(<FilePreview file={{ ...file, id: 'other' }} context={{ owner: 'user-b', mode: 'server' }} />);
    expect(await screen.findByText('保存的科研正文')).toBeTruthy();
    resolveOld(new Blob(['旧账号不可展示']));
    await waitFor(() => expect(screen.queryByText('旧账号不可展示')).toBeNull());
    expect(mocks.read).toHaveBeenLastCalledWith('other', { owner: 'user-b', mode: 'server' }, expect.any(AbortSignal));
  });
  it('刷新后的文字附件按引用读取原件，并按最新文件名下载', async () => {
    const original = { ...file, name: '重命名的笔记.txt', sha256: 'hash', projectId: null, createdAt: 1, updatedAt: 2 };
    mocks.list.mockResolvedValue({ files: [original] });
    mocks.download.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <AttachmentStrip attachments={[{ ...file, kind: 'text' }]} context={context} />
      </MemoryRouter>,
    );
    expect(mocks.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /实验笔记/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('保存的科研正文')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '下载原文件' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(original, context));
  });
});
