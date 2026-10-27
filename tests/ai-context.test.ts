import { describe, expect, it } from 'vitest';
import { aiWorkspaceHref, buildResearchContext, MAX_CONTEXT_CHARS } from '@/features/ai/context';
import { emptyDataset, type Project, type Task, type Experiment, type Reference } from '@/domain/types';

const base = (id: string) => ({ id, createdAt: 1, updatedAt: 1, deletedAt: null, isDemo: false });
const project = (id: string, patch: Partial<Project> = {}): Project => ({
  ...base(id),
  name: id,
  question: '',
  goal: '',
  status: 'active',
  startDate: null,
  endDate: null,
  favorite: false,
  ...patch,
});
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  ...base(id),
  title: id,
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  projectId: null,
  sourceExperimentId: null,
  referenceId: null,
  completedAt: null,
  recurrence: 'none',
  ...patch,
});
const experiment = (id: string, patch: Partial<Experiment> = {}): Experiment => ({
  ...base(id),
  title: id,
  experimentDate: '2026-10-25',
  projectId: null,
  status: 'draft',
  purpose: '',
  hypothesis: '',
  dataSources: [],
  method: '',
  results: '',
  observations: '',
  conclusion: '',
  nextStep: '',
  repoUrl: '',
  commit: '',
  sourceExperimentId: null,
  ...patch,
});
const reference = (id: string, patch: Partial<Reference> = {}): Reference => ({
  ...base(id),
  title: id,
  authors: '',
  year: null,
  venue: '',
  doi: '',
  url: '',
  readingStatus: 'unread',
  favorite: false,
  noteQuestion: '',
  noteMethod: '',
  noteFindings: '',
  noteLimits: '',
  noteRelevance: '',
  ...patch,
});

describe('AI 真实研究上下文', () => {
  it('默认读取真实工作区索引，区分待办、逾期、未来与已完成任务', () => {
    const data = emptyDataset();
    data.projects = [project('项目 ID', { name: '真实项目' }), project('已删项目', { deletedAt: 2 })];
    data.tasks = [
      task('逾期任务', { dueDate: '2026-10-24' }),
      task('今日任务', { dueDate: '2026-10-25' }),
      task('未来任务', { dueDate: '2026-10-28' }),
      task('已完成', { dueDate: '2026-10-24', status: 'done' }),
      task('已删任务', { deletedAt: 2 }),
    ];
    const context = buildResearchContext(data, 'workspace', '2026-10-25');
    const parsed = JSON.parse(context.text);
    expect(context.kind).toBe('workspace');
    expect(parsed.projects).toEqual([expect.objectContaining({ id: '项目 ID', name: '真实项目' })]);
    expect(parsed.dueTasks.map((row: Task) => row.id)).toEqual(['逾期任务', '今日任务']);
    expect(parsed.upcomingTasks.map((row: Task) => row.id)).toEqual(['未来任务']);
    expect(parsed.tasks.some((row: Task) => row.id === '已删任务')).toBe(false);
    expect(parsed.counts.tasks).toBe(4);
    expect(data.tasks).toHaveLength(5);
  });

  it('项目包含目标、子任务、里程碑、实验与仍关联文献的笔记及准确 ID', () => {
    const data = emptyDataset();
    data.projects = [project('p', { question: '研究问题', goal: '研究目标' }), project('other')];
    data.tasks = [
      task('t', { projectId: 'p', status: 'doing', priority: 'high' }),
      task('other-t', { projectId: 'other' }),
      task('deleted-t', { projectId: 'p', deletedAt: 1 }),
    ];
    data.subtasks = [
      { ...base('s'), taskId: 't', title: '实际子步骤', done: true, sortOrder: 0 },
      { ...base('deleted-s'), taskId: 'deleted-t', title: '已删任务子项', done: false, sortOrder: 0 },
    ];
    data.milestones = [
      { ...base('m'), projectId: 'p', title: '里程碑', dueDate: '2026-11-01', done: false, sortOrder: 0 },
    ];
    data.experiments = [
      experiment('e', { projectId: 'p', results: '实际实验结果' }),
      experiment('other-e', { projectId: 'other' }),
    ];
    data.references = [reference('r', { noteFindings: '文献现有结论' }), reference('removed-r')];
    data.projectReferences = [
      { ...base('link'), projectId: 'p', referenceId: 'r' },
      { ...base('removed-link'), projectId: 'p', referenceId: 'removed-r', deletedAt: 1 },
    ];
    const context = buildResearchContext(data, 'project:p');
    const parsed = JSON.parse(context.text);
    expect(parsed.record).toMatchObject({ id: 'p', question: '研究问题', goal: '研究目标' });
    expect(parsed.tasks).toEqual([expect.objectContaining({ id: 't', status: 'doing', priority: 'high' })]);
    expect(parsed.subtasks).toEqual([expect.objectContaining({ id: 's', taskId: 't', done: true })]);
    expect(parsed.milestones[0]).toMatchObject({ id: 'm', dueDate: '2026-11-01' });
    expect(parsed.experiments).toEqual([expect.objectContaining({ id: 'e', results: '实际实验结果' })]);
    expect(parsed.references).toEqual([expect.objectContaining({ id: 'r', noteFindings: '文献现有结论' })]);
    expect(context.counts).toMatchObject({
      projects: 1,
      tasks: 1,
      experiments: 1,
      references: 1,
      milestones: 1,
      subtasks: 1,
    });
  });

  it('任务资料包含自身属性、子任务、所属项目和真实来源', () => {
    const data = emptyDataset();
    data.projects = [project('p')];
    data.tasks = [
      task('t', { projectId: 'p', referenceId: 'r', sourceExperimentId: 'e', description: '实际任务说明' }),
    ];
    data.experiments = [experiment('e', { results: '实验观察' })];
    data.references = [reference('r', { noteMethod: '来源方法' })];
    data.subtasks = [{ ...base('s'), taskId: 't', title: '已有步骤', done: false, sortOrder: 0 }];
    const parsed = JSON.parse(buildResearchContext(data, 'task:t').text);
    expect(parsed.record).toMatchObject({ id: 't', projectId: 'p', description: '实际任务说明' });
    expect(parsed.projects[0].id).toBe('p');
    expect(parsed.experiments[0].results).toBe('实验观察');
    expect(parsed.references[0].noteMethod).toBe('来源方法');
    expect(parsed.subtasks[0].taskId).toBe('t');
  });

  it('实验与文献上下文保留关联项目及由该资料产生的任务', () => {
    const data = emptyDataset();
    data.projects = [project('p'), project('deleted-p', { deletedAt: 1 })];
    data.tasks = [task('from-experiment', { sourceExperimentId: 'e' }), task('from-reference', { referenceId: 'r' })];
    data.experiments = [experiment('e', { projectId: 'p', method: '实验步骤', conclusion: '实际结论' })];
    data.references = [reference('r', { noteRelevance: '与研究的关联' })];
    data.projectReferences = [
      { ...base('l'), projectId: 'p', referenceId: 'r' },
      { ...base('deleted-parent-link'), projectId: 'deleted-p', referenceId: 'r' },
    ];
    const exp = JSON.parse(buildResearchContext(data, 'experiment:e').text);
    expect(exp.record).toMatchObject({ method: '实验步骤', conclusion: '实际结论' });
    expect(exp.tasks[0].id).toBe('from-experiment');
    const ref = JSON.parse(buildResearchContext(data, 'reference:r').text);
    expect(ref.record.noteRelevance).toBe('与研究的关联');
    expect(ref.projects.map((p: Project) => p.id)).toEqual(['p']);
    expect(ref.tasks[0].id).toBe('from-reference');
  });

  it('长资料按结构收短，JSON 保持完整且不修改输入资料', () => {
    const data = emptyDataset();
    data.projects = [project('p', { goal: '科研目标'.repeat(10_000) })];
    data.tasks = Array.from({ length: 150 }, (_, i) =>
      task(`t-${i}`, { projectId: 'p', description: '长任务说明'.repeat(1500) }),
    );
    data.experiments = Array.from({ length: 30 }, (_, i) =>
      experiment(`e-${i}`, { projectId: 'p', results: '实验长结果'.repeat(1500) }),
    );
    const originalGoal = data.projects[0].goal;
    const context = buildResearchContext(data, 'project:p');
    expect(context.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(context.truncated).toBe(true);
    const parsed = JSON.parse(context.text);
    expect(parsed.record.id).toBe('p');
    expect(parsed.truncated).toBe(true);
    expect(parsed.counts.tasks).toBe(150);
    expect(data.projects[0].goal).toBe(originalGoal);
    expect(data.tasks).toHaveLength(150);
  });

  it('明确不附带与无效/已删记录不会泄漏工作区资料', () => {
    const data = emptyDataset();
    data.projects = [project('private'), project('deleted', { deletedAt: 1 })];
    for (const scope of ['none', 'project:missing', 'project:deleted', 'unknown:private']) {
      const context = buildResearchContext(data, scope);
      expect(context.text).toBe('');
      expect(context.record).toBeNull();
      expect(context.kind).toBe('none');
    }
  });

  it('业务入口对资料 ID 和问题进行 URL 编码', () => {
    const url = new URL(aiWorkspaceHref('task:a/b & c', '拆解 + 保存？'), 'https://local.test');
    expect(url.pathname).toBe('/ai');
    expect(url.searchParams.get('scope')).toBe('task:a/b & c');
    expect(url.searchParams.get('prompt')).toBe('拆解 + 保存？');
  });
});
