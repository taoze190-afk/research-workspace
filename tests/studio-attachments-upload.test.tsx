import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStudioAttachments } from '@/features/ai/useStudioAttachments';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), list: vi.fn() }));
vi.mock('@/features/files/repository', async (original) => ({
  ...(await original<typeof import('@/features/files/repository')>()),
  saveResearchFile: mocks.save,
  readResearchFile: mocks.read,
  listResearchFiles: mocks.list,
}));
const context = { owner: 'local', mode: 'local' as const };
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
describe('工作室上传恢复', () => {
  it('失败后保留原File，直接重试不重复保存成功文件', async () => {
    mocks.save
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(new Error('服务暂时不可用'))
      .mockResolvedValueOnce({ id: 'second' });
    const first = new File(['first'], 'first.txt', { type: 'text/plain' });
    const second = new File(['second'], 'second.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useStudioAttachments({ context, sessionId: 'conversation', canUpload: true }));
    await act(async () => {
      await result.current.addFiles([first, second]);
    });
    expect(result.current.attachments.map((a) => a.id)).toEqual(['first']);
    expect(result.current.failedUploads).toEqual([second]);
    expect(result.current.error).toContain('服务暂时不可用');
    await act(async () => {
      await result.current.retryUploads();
    });
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[2][0]).toBe(second);
    expect(result.current.attachments.map((a) => a.id)).toEqual(['first', 'second']);
    expect(result.current.failedUploads).toHaveLength(0);
    expect(result.current.error).toBe('');
  });
  it('切换会话会取消旧读取，不把旧错误写入新草稿', async () => {
    let rejectUpload!: (err: Error) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );
    const { result, rerender } = renderHook(
      ({ sessionId }) => useStudioAttachments({ context, sessionId, canUpload: true }),
      { initialProps: { sessionId: 'old' } },
    );
    let upload!: Promise<void>;
    act(() => {
      upload = result.current.addFiles([new File(['x'], 'old.txt')]);
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => result.current.reset());
    rerender({ sessionId: 'new' });
    await act(async () => {
      rejectUpload(new Error('旧会话的错误'));
      await upload;
    });
    expect(result.current.error).toBe('');
    expect(result.current.attachments).toHaveLength(0);
    expect(result.current.failedUploads).toHaveLength(0);
    expect(result.current.busy).toBe(false);
  });
  it('多文件入口全部读取成功才附带，缺失原件时不会发送半套对比资料', async () => {
    const first = { id: 'first', name: '第一份.txt', mimeType: 'text/plain', size: 3 };
    const second = { id: 'second', name: '第二份.txt', mimeType: 'text/plain', size: 3 };
    mocks.list.mockResolvedValue({ files: [first, second] });
    mocks.read.mockResolvedValueOnce(new Blob(['abc'])).mockRejectedValueOnce(new Error('原件已删除'));
    const { result } = renderHook(() => useStudioAttachments({ context, sessionId: 'compare', canUpload: true }));
    await act(async () => {
      await result.current.addExisting(['first', 'second']);
    });
    expect(result.current.attachments).toHaveLength(0);
    expect(result.current.error).toContain('原件已删除');
    mocks.read.mockResolvedValue(new Blob(['abc']));
    await act(async () => {
      await result.current.addExisting(['first', 'second']);
    });
    expect(result.current.attachments.map((a) => a.id)).toEqual(['first', 'second']);
    expect(result.current.attachments.every((a) => a.text === 'abc')).toBe(true);
  });
});
