import { describe, expect, it } from 'vitest';
import { buildWeeklyReport, weekRangeOf } from '@/domain/weekly';
import { dataset, makeExperiment, makeProject, makeReference, makeTask } from './factory';

const TODAY = '2026-10-24'; // 周六，本周是 10-19 ~ 10-25

const ts = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

describe('周区间', () => {
  it('周一开头，跨月也对', () => {
    expect(weekRangeOf('2026-10-24')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekRangeOf('2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(weekRangeOf('2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });
});

describe('组会周报', () => {
  const project = makeProject({ name: '腕臂式肌电信号采集装置' });
  const data = dataset({
    projects: [project],
    tasks: [
      makeTask({ title: '补录电极阻抗', projectId: project.id, status: 'done', completedAt: ts(2026, 10, 21) }),
      makeTask({ title: '上周的活', projectId: project.id, status: 'done', completedAt: ts(2026, 10, 12) }),
      makeTask({ title: '准备组会预演', projectId: null, status: 'todo', dueDate: '2026-10-28' }),
      makeTask({ title: '本周就该交', projectId: null, status: 'todo', dueDate: '2026-10-25' }),
    ],
    experiments: [
      makeExperiment({ title: '握力基线第 3 批', projectId: project.id, status: 'active', updatedAt: ts(2026, 10, 22, 18) }),
      makeExperiment({ title: '上个月的实验', projectId: null, status: 'done', updatedAt: ts(2026, 9, 30) }),
    ],
    references: [
      makeReference({ title: 'sEMG 数据集可复现性评估', authors: '周衡', venue: '示例生物医学工程', createdAt: ts(2026, 10, 20) }),
      makeReference({ title: '更早的条目', createdAt: ts(2026, 9, 1) }),
    ],
  });

  const report = buildWeeklyReport(data, TODAY);

  it('标题带本周区间', () => {
    expect(report).toContain('# 周报（2026-10-19 ~ 2026-10-25）');
  });

  it('只收本周完成的任务，带项目名', () => {
    expect(report).toContain('- 补录电极阻抗（腕臂式肌电信号采集装置）');
    expect(report).toContain('10/21 完成');
    expect(report).not.toContain('上周的活');
  });

  it('实验进展只列本周更新过的', () => {
    expect(report).toContain('- 握力基线第 3 批（腕臂式肌电信号采集装置） · 进行中');
    expect(report).not.toContain('上个月的实验');
  });

  it('新增文献只列本周录入的', () => {
    expect(report).toContain('- sEMG 数据集可复现性评估（周衡 · 示例生物医学工程）');
    expect(report).not.toContain('更早的条目');
  });

  it('下周截止不含本周内到期的', () => {
    expect(report).toContain('- 准备组会预演（10/28 截止）');
    expect(report).not.toContain('本周就该交');
  });

  it('空周不说谎', () => {
    const empty = buildWeeklyReport(dataset(), TODAY);
    expect(empty).toContain('本周没有完成的任务。');
    expect(empty).toContain('本周没有更新的实验。');
    expect(empty).toContain('本周没有新增文献。');
    expect(empty).toContain('下周没有到期任务。');
  });
});
