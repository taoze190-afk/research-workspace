import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedSave } from '@/lib/useDebouncedSave';
import { flushPendingSaves } from '@/lib/pendingSaves';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('编辑器自动保存', () => {
  it('退出前协调立即提交最后一次输入，卸载注销后不会再次触发旧账号保存', async () => {
    const save = vi.fn(async () => true);
    const view = renderHook(({ value }) => useDebouncedSave(value, save, { delay: 800 }), {
      initialProps: { value: '初始' },
    });
    view.rerender({ value: '退出前最后输入' });
    await act(async () => {
      expect(await flushPendingSaves()).toBe(true);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('退出前最后输入');
    await act(async () => view.unmount());
    expect(await flushPendingSaves()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('退出前提交失败时保留待保存内容，重试成功才返回 true', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const view = renderHook(({ value }) => useDebouncedSave(value, save), { initialProps: { value: '初始' } });
    view.rerender({ value: '不能丢失的退出草稿' });
    await act(async () => {
      expect(await flushPendingSaves()).toBe(false);
    });
    expect(view.result.current.state).toBe('failed');
    await act(async () => {
      expect(await flushPendingSaves()).toBe(true);
    });
    expect(save.mock.calls).toEqual([['不能丢失的退出草稿'], ['不能丢失的退出草稿']]);
    expect(view.result.current.state).toBe('saved');
  });

  it('退出前协调尊重最新的自动保存开关，不提交手动模式草稿', async () => {
    const save = vi.fn(async () => true);
    const view = renderHook(({ value, enabled }) => useDebouncedSave(value, save, { enabled }), {
      initialProps: { value: '初始', enabled: true },
    });
    view.rerender({ value: '保留手动模式语义', enabled: false });
    await act(async () => {
      expect(await flushPendingSaves()).toBe(true);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(await flushPendingSaves()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('停止输入后保存完整最新草稿，卸载时提交尚未到时的编辑', async () => {
    const save = vi.fn(async () => true);
    const view = renderHook(({ value }) => useDebouncedSave(value, save, { delay: 600 }), {
      initialProps: { value: { title: '原标题', description: '' } },
    });
    view.rerender({ value: { title: '新标题', description: '新说明' } });
    await act(() => vi.advanceTimersByTimeAsync(599));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledExactlyOnceWith({ title: '新标题', description: '新说明' });
    view.rerender({ value: { title: '离开前标题', description: '离开前说明' } });
    await act(async () => view.unmount());
    expect(save).toHaveBeenLastCalledWith({ title: '离开前标题', description: '离开前说明' });
  });

  it('保存期间的新输入按顺序写入，旧请求完成不提前显示已保存', async () => {
    const resolvers: Array<(value: boolean) => void> = [];
    const save = vi.fn((_value: string) => new Promise<boolean>((resolve) => resolvers.push(resolve)));
    const view = renderHook(({ value }) => useDebouncedSave(value, save, { delay: 10 }), {
      initialProps: { value: '初始' },
    });
    view.rerender({ value: '第一版' });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(save.mock.calls.map(([value]) => value)).toEqual(['第一版']);
    view.rerender({ value: '第二版' });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolvers.shift()!(true));
    expect(save.mock.calls.map(([value]) => value)).toEqual(['第一版', '第二版']);
    expect(view.result.current.state).toBe('saving');
    await act(async () => resolvers.shift()!(true));
    expect(view.result.current.state).toBe('saved');
    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
    });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('保存失败或异常时保留草稿，显式重试继续保存原内容', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('测试写入失败')).mockResolvedValue(true);
    const view = renderHook(({ value }) => useDebouncedSave(value, save), { initialProps: { value: '初始' } });
    view.rerender({ value: '不能丢失的草稿' });
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(view.result.current.state).toBe('failed');
    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
    });
    expect(save.mock.calls).toEqual([['不能丢失的草稿'], ['不能丢失的草稿']]);
    expect(view.result.current.state).toBe('saved');
  });

  it('关闭自动保存后只标记待保存，手动保存可用且卸载不会偷偷写入', async () => {
    const save = vi.fn(async () => true);
    const view = renderHook(({ value }) => useDebouncedSave(value, save, { enabled: false }), {
      initialProps: { value: '初始' },
    });
    view.rerender({ value: '手动保存内容' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(view.result.current.state).toBe('dirty');
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('手动保存内容');
    view.rerender({ value: '未手动保存' });
    await act(async () => view.unmount());
    expect(save).toHaveBeenCalledTimes(1);
  });
});
