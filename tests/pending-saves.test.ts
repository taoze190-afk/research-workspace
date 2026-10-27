import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSaves, registerPendingSave } from '@/lib/pendingSaves';

const unregisters: Array<() => void> = [];
afterEach(() => {
  unregisters.splice(0).forEach((unregister) => unregister());
});

describe('退出前草稿保存协调', () => {
  it('空注册表立即成功，同时等待全部编辑器提交完成', async () => {
    expect(await flushPendingSaves()).toBe(true);
    let finish!: (ok: boolean) => void;
    const first = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const second = vi.fn(async () => true);
    unregisters.push(registerPendingSave(first), registerPendingSave(second));
    const pending = flushPendingSaves();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    finish(true);
    expect(await pending).toBe(true);
  });

  it('任意失败或异常都返回 false，其他编辑器仍完成提交', async () => {
    const success = vi.fn(async () => true);
    unregisters.push(
      registerPendingSave(success),
      registerPendingSave(async () => false),
      registerPendingSave(() => {
        throw new Error('模拟写入失败');
      }),
    );
    expect(await flushPendingSaves()).toBe(false);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('注销后不再调用编辑器，包括同轮提交时已卸载的回调', async () => {
    const stale = vi.fn(async () => true);
    let unregisterStale = () => {};
    unregisters.push(
      registerPendingSave(async () => {
        unregisterStale();
        return true;
      }),
    );
    unregisterStale = registerPendingSave(stale);
    unregisters.push(unregisterStale);
    expect(await flushPendingSaves()).toBe(true);
    expect(stale).not.toHaveBeenCalled();
    unregisterStale();
    expect(await flushPendingSaves()).toBe(true);
    expect(stale).not.toHaveBeenCalled();
  });
});
