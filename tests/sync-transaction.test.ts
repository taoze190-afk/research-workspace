import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { createTask } from '@/data/repo';
import { countPending, installWriteCapture, setMode, setQueueOwner } from '@/data/sync';

beforeAll(() => installWriteCapture(['tasks']));
beforeEach(() => {
  localStorage.removeItem('rw.queue.v1');
  setMode('server');
  setQueueOwner('transaction-test-account');
});
afterAll(() => { setMode('local'); setQueueOwner(null); localStorage.removeItem('rw.queue.v1'); });

describe('本地事务与待同步队列一致', () => {
  it('事务回滚不会把已触发钩子的任务留进上传队列', async () => {
    await expect(db.transaction('rw', db.tasks, async () => {
      await createTask({ title: '不应上传的任务' });
      throw new Error('模拟第二步失败');
    })).rejects.toThrow('模拟第二步失败');
    expect(await db.tasks.count()).toBe(0);
    expect(countPending()).toBe(0);
  });
  it('多条任务全部提交后才进入同一账号队列', async () => {
    await db.transaction('rw', db.tasks, async () => {
      await createTask({ title: '第一项' });
      expect(countPending()).toBe(0);
      await createTask({ title: '第二项' });
    });
    expect(await db.tasks.count()).toBe(2);
    expect(countPending()).toBe(2);
    expect(JSON.parse(localStorage.getItem('rw.queue.v1')!).owner).toBe('transaction-test-account');
  });
});
