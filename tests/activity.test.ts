import { describe, expect, it } from 'vitest';
import { activityPerDay } from '@/domain/progress';
import { makeExperiment, makeTask } from './factory';

const TODAY = '2026-10-25'; // 周日
const ts = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('52 周热力图分桶', () => {
  it('对齐到周一，共 weeks*7 格，当前周未来日子为空', () => {
    const days = activityPerDay([], [], 52, TODAY);
    expect(days).toHaveLength(52 * 7);
    // 2026-10-25 是周日：最后一格就是当天
    expect(days.at(-1)).toMatchObject({ date: '2026-10-25', tasks: 0, experiments: 0 });
    // 52 周前的起点是周一
    expect(days[0].date).toBe('2025-10-27');
  });

  it('任务按完成日、实验按更新日计数，同一天合并', () => {
    const tasks = [makeTask({ status: 'done', completedAt: ts(2026, 10, 24) }), makeTask({ status: 'done', completedAt: ts(2026, 10, 24, 18) })];
    const experiments = [makeExperiment({ updatedAt: ts(2026, 10, 24, 20) })];
    const days = activityPerDay(tasks, experiments, 52, TODAY);
    const day = days.find((d) => d.date === '2026-10-24')!;
    expect(day).toMatchObject({ tasks: 2, experiments: 1 });
  });

  it('取消与未完成的任务不进热力图', () => {
    const tasks = [makeTask({ status: 'cancelled', completedAt: ts(2026, 10, 24) }), makeTask({ status: 'todo' })];
    const days = activityPerDay(tasks, [], 52, TODAY);
    expect(days.find((d) => d.date === '2026-10-24')).toMatchObject({ tasks: 0, experiments: 0 });
  });
});
