import { describe, expect, it } from 'vitest';
import { dashboardSummary, isOverdue, projectProgress, progressLabel, tasksDueWithin, isOpenTask } from '@/domain/progress';
import { dataset, makeProject, makeReference, makeTask, makeExperiment } from './factory';

const TODAY = '2026-10-23';

describe('项目进度', () => {
  it('已完成 / 未取消的任务总数', () => {
    const tasks = [
      makeTask({ status: 'done' }),
      makeTask({ status: 'done' }),
      makeTask({ status: 'todo' }),
      makeTask({ status: 'doing' }),
      makeTask({ status: 'cancelled' }),
    ];
    const projectId = 'p-1';
    tasks.forEach((t) => (t.projectId = projectId));
    const progress = projectProgress(tasks, projectId);
    expect(progress).toEqual({ kind: 'value', ratio: 0.5, done: 2, total: 4 });
    expect(progressLabel(progress)).toBe('50%');
  });

  it('全是已取消任务时不伪造进度', () => {
    const tasks = [makeTask({ status: 'cancelled', projectId: 'p-2' }), makeTask({ status: 'cancelled', projectId: 'p-2' })];
    const progress = projectProgress(tasks, 'p-2');
    expect(progress.kind).toBe('none');
    expect(progressLabel(progress)).toBe('尚无任务');
  });

  it('没有任务时既不 NaN 也不 0%', () => {
    const progress = projectProgress([makeTask({ projectId: 'other' })], 'p-3');
    expect(progress.kind).toBe('none');
    expect(progressLabel(progress)).toBe('尚无任务');
  });

  it('软删除的任务不参与统计', () => {
    const tasks = [makeTask({ projectId: 'p-4', status: 'done' }), makeTask({ projectId: 'p-4', status: 'todo', deletedAt: 1 })];
    expect(projectProgress(tasks, 'p-4')).toEqual({ kind: 'value', ratio: 1, done: 1, total: 1 });
  });
});

describe('逾期与日期边界', () => {
  it('截止日为空不算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: null }), TODAY)).toBe(false);
  });

  it('到期日就是今天不算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: TODAY }), TODAY)).toBe(false);
  });

  it('昨天到期且未完成算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: '2026-10-22', status: 'todo' }), TODAY)).toBe(true);
    expect(isOverdue(makeTask({ dueDate: '2026-10-22', status: 'doing' }), TODAY)).toBe(true);
  });

  it('已完成或已取消永远不算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: '2020-01-01', status: 'done' }), TODAY)).toBe(false);
    expect(isOverdue(makeTask({ dueDate: '2020-01-01', status: 'cancelled' }), TODAY)).toBe(false);
  });

  it('未来七天含第七天，不含第八天', () => {
    const rows = dataset({
      tasks: [
        makeTask({ dueDate: TODAY }),
        makeTask({ dueDate: '2026-10-30' }),
        makeTask({ dueDate: '2026-10-31' }),
        makeTask({ dueDate: '2026-10-20' }),
        makeTask({ dueDate: null }),
        makeTask({ dueDate: '2026-10-25', status: 'done' }),
      ],
    });
    const due = tasksDueWithin(rows, 7, TODAY);
    expect(due.map((t) => t.dueDate)).toEqual(['2026-10-23', '2026-10-30']);
  });

  it('未完成任务的判定与看板列一致', () => {
    expect(isOpenTask(makeTask({ status: 'todo' }))).toBe(true);
    expect(isOpenTask(makeTask({ status: 'doing' }))).toBe(true);
    expect(isOpenTask(makeTask({ status: 'done' }))).toBe(false);
    expect(isOpenTask(makeTask({ status: 'cancelled' }))).toBe(false);
  });
});

describe('工作台摘要来自真实数据', () => {
  it('四个数字各算各的，且不包含软删除记录', () => {
    const rows = dataset({
      projects: [makeProject({ status: 'active' }), makeProject({ status: 'planned' }), makeProject({ status: 'active', deletedAt: 5 })],
      tasks: [makeTask({ dueDate: TODAY }), makeTask({ dueDate: '2026-10-20' }), makeTask({ dueDate: TODAY, deletedAt: 3 }), makeTask({ dueDate: TODAY, status: 'done' })],
      references: [makeReference({ readingStatus: 'unread' }), makeReference({ readingStatus: 'read' })],
      experiments: [makeExperiment()],
    });
    // 两个 active 项目里有一个已软删除，只计一个
    expect(dashboardSummary(rows, TODAY)).toEqual({ activeProjects: 1, todayOpen: 1, overdue: 1, unreadReferences: 1 });
  });
});
