import { afterEach, describe, expect, it } from 'vitest';
import {
  describeAction,
  executeAiAction,
  executeAiActions,
  MAX_AI_BATCH_ITEMS,
  parseActionReply,
  parseActionsReply,
  previewAiAction,
  type AiAction,
} from '@/features/ai/actions';
import { createExperiment, createProject, createReference, createTask, loadDataset, updateTask } from '@/data/repo';
import { db } from '@/data/db';
import { countPending, installWriteCapture, setMode, setQueueOwner } from '@/data/sync';

const workspace = { kind: 'workspace', id: null };
afterEach(() => {
  setMode('local');
  setQueueOwner(null);
  localStorage.removeItem('rw.queue.v1');
});

describe('AI 动作块解析', () => {
  it('提取动作并从展示文本中移除', () => {
    const reply = '建议先补一次消融。\n```action\n{"action":"create_task","title":"补消融实验"}\n```';
    const { text, action } = parseActionReply(reply);
    expect(action).toMatchObject({ action: 'create_task', title: '补消融实验' });
    expect(text).not.toContain('action');
    expect(text).toContain('消融');
  });

  it('无动作块返回原文与 null', () => {
    const r = parseActionReply('普通回答');
    expect(r.action).toBeNull();
    expect(r.text).toBe('普通回答');
  });

  it('坏 JSON 不炸、不误报', () => {
    const r = parseActionReply('回答\n```action\n{broken\n```');
    expect(r.action).toBeNull();
    expect(r.issues).toHaveLength(1);
  });

  it('缺 action 字段视为无效', () => {
    const r = parseActionReply('```action\n{"title":"x"}\n```');
    expect(r.action).toBeNull();
    expect(r.issues).toHaveLength(1);
  });

  it('未知或没有闭合的动作会提示问题，不显示无法执行的卡片', () => {
    const parsed = parseActionsReply(
      '建议。\n```action\n{"action":"delete_everything"}\n```\n```action\n{"action":"create_task"',
    );
    expect(parsed.actions).toEqual([]);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.text).toBe('建议。');
  });
});

describe('多动作块解析', () => {
  it('一次回复里的多个动作全部按序提取，坏块跳过', () => {
    const reply = [
      '规划如下。',
      '```action\n{"action":"create_task","title":"A"}\n```',
      '中间说明',
      '```action\n{broken}\n```',
      '```action\n{"action":"create_tasks","items":[{"title":"B"},{"title":"C"}]}\n```',
    ].join('\n');
    const { text, actions } = parseActionsReply(reply);
    expect(actions.map((a) => a.action)).toEqual(['create_task', 'create_tasks']);
    expect(text).not.toContain('action');
    expect(text).toContain('中间说明');
  });

  it('摘要覆盖批量动作', () => {
    expect(describeAction({ action: 'create_tasks', items: [{ title: 'a' }, { title: 'b' }] })).toBe(
      '批量新建 2 条任务',
    );
    expect(describeAction({ action: 'create_milestones', items: [{ title: 'm' }] })).toBe('新建 1 条里程碑');
  });
});

describe('动作执行（fake-indexeddb 真库）', () => {
  it('create_tasks 批量落库并挂到当前项目', async () => {
    const project = await createProject({ name: '批量测试项目' });
    const { executeAiAction } = await import('@/features/ai/actions');
    const result = await executeAiAction(
      { action: 'create_tasks', items: [{ title: '任务一' }, { title: '任务二', priority: 'high' }] },
      await loadDataset(),
      { kind: 'project', id: project.id },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain('2');
    const data = await loadDataset();
    const inProject = data.tasks.filter((t) => t.projectId === project.id);
    expect(new Set(inProject.map((t) => t.title))).toEqual(new Set(['任务一', '任务二']));
    expect(inProject.find((t) => t.title === '任务二')?.priority).toBe('high');
  });

  it('create_milestones 只在项目上下文可用', async () => {
    const project = await createProject({ name: '里程碑项目' });
    const { executeAiAction } = await import('@/features/ai/actions');
    const noCtx = await executeAiAction({ action: 'create_milestones', items: [{ title: 'm' }] }, await loadDataset(), {
      kind: 'workspace',
      id: null,
    });
    expect(noCtx.ok).toBe(false);
    const ok = await executeAiAction(
      { action: 'create_milestones', items: [{ title: '开题', dueDate: '2026-11-30' }, { title: '投稿' }] },
      await loadDataset(),
      { kind: 'project', id: project.id },
    );
    expect(ok.ok).toBe(true);
    const data = await loadDataset();
    const stones = data.milestones.filter((m) => m.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(stones.map((m) => m.title)).toEqual(['开题', '投稿']);
    expect(stones[0].dueDate).toBe('2026-11-30');
  });

  it('add_subtasks 按标题前缀匹配也能命中', async () => {
    const project = await createProject({ name: '子任务项目' });
    await createTask({ title: '复现主表第 1 行', projectId: project.id });
    const { executeAiAction } = await import('@/features/ai/actions');
    const result = await executeAiAction(
      { action: 'add_subtasks', taskTitle: '复现主表', items: ['跑通', '对齐'] },
      await loadDataset(),
      { kind: 'project', id: project.id },
    );
    expect(result.ok).toBe(true);
    const data = await loadDataset();
    expect(data.subtasks.filter((s) => !s.deletedAt)).toHaveLength(2);
  });
});

describe('AI 操作实际保存与边界', () => {
  it('预览不写库，显示真实目标及修改前后值', async () => {
    const task = await createTask({ title: '复现实验', priority: 'low' });
    const preview = previewAiAction(
      { action: 'update_task', taskId: task.id, changes: { priority: 'high', dueDate: '2026-11-20' } },
      await loadDataset(),
      workspace,
    );
    expect(preview).toMatchObject({
      valid: true,
      target: '复现实验',
      changes: [
        { label: '优先级', before: '低', after: '高' },
        { label: '截止日期', before: '未填写', after: '2026-11-20' },
      ],
    });
    expect((await db.tasks.get(task.id))?.priority).toBe('low');
  });

  it('新建项目、实验、文献确实使用共享数据表与项目关联', async () => {
    const result = await executeAiAction(
      { action: 'create_project', name: '实用 AI 课题', goal: '完成复现', status: 'active' },
      await loadDataset(),
      workspace,
    );
    expect(result.ok).toBe(true);
    const project = (await loadDataset()).projects[0];
    expect(result.href).toBe(`/projects/${project.id}`);
    const batch = await executeAiActions(
      [
        { action: 'create_experiment', title: '对照实验', purpose: '比较两种方法', projectId: project.id },
        {
          action: 'create_reference',
          title: '已核对的论文',
          doi: '10.1234/verified-study',
          year: 2025,
          projectId: project.id,
        },
      ],
      await loadDataset(),
      workspace,
    );
    expect(batch.ok).toBe(true);
    const data = await loadDataset();
    expect(data.experiments[0]).toMatchObject({ title: '对照实验', purpose: '比较两种方法', projectId: project.id });
    expect(data.projectReferences[0]).toMatchObject({ projectId: project.id, referenceId: data.references[0].id });
  });

  it('选中任务可直接拆分，并把新增关联任务放到相同项目', async () => {
    const project = await createProject({ name: '任务课题' });
    const task = await createTask({ title: '完成复现', projectId: project.id });
    const context = { kind: 'task', id: task.id };
    const result = await executeAiActions(
      [
        { action: 'add_subtasks', items: ['准备环境', '运行基线'] },
        { action: 'create_task', title: '汇总复现差异' },
      ],
      await loadDataset(),
      context,
    );
    expect(result.ok).toBe(true);
    expect((await loadDataset()).subtasks.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.title)).toEqual([
      '准备环境',
      '运行基线',
    ]);
    expect((await db.tasks.filter((row) => row.title === '汇总复现差异').first())?.projectId).toBe(project.id);
  });

  it('任务状态与完成时间一起更新，支持清除日期及重新打开', async () => {
    const task = await createTask({ title: '待完成', dueDate: '2026-11-20' });
    const result = await executeAiAction(
      {
        action: 'update_task',
        taskId: task.id,
        changes: { status: 'done', priority: 'urgent', dueDate: null, title: '已复现' },
      },
      await loadDataset(),
      workspace,
    );
    expect(result.ok).toBe(true);
    expect(await db.tasks.get(task.id)).toMatchObject({
      title: '已复现',
      status: 'done',
      priority: 'urgent',
      dueDate: null,
      completedAt: expect.any(Number),
    });
    await executeAiAction(
      { action: 'update_task', taskId: task.id, changes: { status: 'todo' } },
      await loadDataset(),
      workspace,
    );
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'todo', completedAt: null });
  });

  it('重复任务遵循现有下一期规则，同一提议不能重复创建', async () => {
    const task = await createTask({ title: '每周复盘', dueDate: '2026-11-20', recurrence: 'weekly' });
    const action = { action: 'update_task', taskId: task.id, changes: { status: 'done' } };
    const stale = await loadDataset();
    expect((await executeAiAction(action, stale, workspace)).ok).toBe(true);
    expect((await executeAiAction(action, stale, workspace)).ok).toBe(true);
    expect(await db.tasks.count()).toBe(2);
    expect((await db.tasks.filter((row) => row.id !== task.id).first())?.dueDate).toBe('2026-11-27');
  });

  it('明确 ID 不得修改所选项目之外的任务，已删除记录也不可写', async () => {
    const a = await createProject({ name: '甲' }),
      b = await createProject({ name: '乙' });
    const other = await createTask({ title: '乙任务', projectId: b.id });
    const result = await executeAiAction(
      { action: 'update_task', taskId: other.id, changes: { priority: 'high' } },
      await loadDataset(),
      { kind: 'project', id: a.id },
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'conflict' });
    await updateTask(other.id, { deletedAt: Date.now() });
    expect(
      (
        await executeAiAction(
          { action: 'update_task', taskId: other.id, changes: { title: '不能改' } },
          await loadDataset(),
          workspace,
        )
      ).ok,
    ).toBe(false);
    expect((await db.tasks.get(other.id))?.title).toBe('乙任务');
  });

  it('同项目有重复或模糊标题时拒绝猜测；全工作区不得只凭标题写入', async () => {
    const project = await createProject({ name: '定位测试' });
    await createTask({ title: '复现方法 A', projectId: project.id });
    await createTask({ title: '复现方法 B', projectId: project.id });
    const action = { action: 'add_subtasks', taskTitle: '复现方法', items: ['运行一次'] };
    expect(await executeAiAction(action, await loadDataset(), { kind: 'project', id: project.id })).toMatchObject({
      ok: false,
      errorCode: 'ambiguous',
    });
    expect((await executeAiAction(action, await loadDataset(), workspace)).ok).toBe(false);
    expect(await db.subtasks.count()).toBe(0);
  });

  it('忽略旧界面快照，连续实验追加在最新内容上合并', async () => {
    const experiment = await createExperiment({ title: '连续追加', results: '原始观察' });
    const stale = await loadDataset();
    const context = { kind: 'experiment', id: experiment.id };
    await executeAiAction({ action: 'update_experiment', field: 'results', value: '第一段' }, stale, context);
    await executeAiAction({ action: 'update_experiment', field: 'results', value: '第二段' }, stale, context);
    expect((await db.experiments.get(experiment.id))?.results).toBe('原始观察\n第一段\n第二段');
    const batch = await executeAiActions(
      [
        { action: 'update_experiment', field: 'results', value: '第三段' },
        { action: 'update_experiment', field: 'results', value: '第四段' },
      ],
      stale,
      context,
    );
    expect(batch.ok).toBe(true);
    expect((await db.experiments.get(experiment.id))?.results).toBe('原始观察\n第一段\n第二段\n第三段\n第四段');
  });

  it('文献笔记拒绝覆盖已有内容，显式追加会保留原文', async () => {
    const reference = await createReference({ title: '笔记文献', noteFindings: '已经写下的结论' });
    const stale = await loadDataset();
    const context = { kind: 'reference', id: reference.id };
    expect(
      await executeAiAction(
        { action: 'write_reference_note', field: 'noteFindings', value: '替代结论' },
        stale,
        context,
      ),
    ).toMatchObject({ ok: false, errorCode: 'conflict' });
    const result = await executeAiActions(
      [
        { action: 'write_reference_note', field: 'noteFindings', value: '补充一', mode: 'append' },
        { action: 'write_reference_note', field: 'noteFindings', value: '补充二', mode: 'append' },
      ],
      stale,
      context,
    );
    expect(result.ok).toBe(true);
    expect((await db.references.get(reference.id))?.noteFindings).toBe('已经写下的结论\n补充一\n补充二');
  });

  it('批量中任意无效字段会整体拒绝，不偷偷跳过空白项', async () => {
    const result = await executeAiAction(
      { action: 'create_tasks', items: [{ title: '本不应保留' }, { title: '' }] },
      await loadDataset(),
      workspace,
    );
    expect(result.ok).toBe(false);
    expect(await db.tasks.count()).toBe(0);
  });

  it('跨动作事务遇到后续错误会撤回之前的真实写入', async () => {
    const result = await executeAiActions(
      [
        { action: 'create_project', name: '应当回滚' },
        { action: 'update_task', taskId: 'does-not-exist', changes: { status: 'done' } },
      ],
      await loadDataset(),
      workspace,
    );
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((row) => !row.ok)).toBe(true);
    expect(await db.projects.count()).toBe(0);
  });

  it('真实写入异常回滚整个批量与同步队列，解除故障后同一提议可重试', async () => {
    installWriteCapture(['tasks']);
    setMode('server');
    setQueueOwner('ai-test-owner');
    localStorage.removeItem('rw.queue.v1');
    const rejectSecond = (_key: unknown, row: unknown) => {
      if ((row as TaskRow).title === '第二项') throw new Error('模拟存储故障');
    };
    db.tasks.hook('creating', rejectSecond);
    const action: AiAction = { action: 'create_tasks', items: [{ title: '第一项' }, { title: '第二项' }] };
    try {
      expect(await executeAiAction(action, await loadDataset(), workspace)).toMatchObject({
        ok: false,
        errorCode: 'storage',
      });
      expect(await db.tasks.count()).toBe(0);
      expect(countPending()).toBe(0);
    } finally {
      db.tasks.hook('creating').unsubscribe(rejectSecond);
    }
    expect((await executeAiAction(action, await loadDataset(), workspace)).ok).toBe(true);
    expect(await db.tasks.count()).toBe(2);
    expect(countPending()).toBe(2);
  });

  it('重复点击同一新建提议，包括并发调用，不会保存两份记录', async () => {
    const action = { action: 'create_task', title: '只建一次' };
    const stale = await loadDataset();
    const results = await Promise.all([
      executeAiAction(action, stale, workspace),
      executeAiAction(action, stale, workspace),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await db.tasks.count()).toBe(1);
  });

  it('后续批次失败不会把此前已保存的提议显示成回滚', async () => {
    const existing = { action: 'create_task', title: '此前已保存' };
    const stale = await loadDataset();
    expect((await executeAiAction(existing, stale, workspace)).ok).toBe(true);
    const result = await executeAiActions([existing, { action: 'create_task', title: '' }], stale, workspace);
    expect(result.ok).toBe(false);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1].ok).toBe(false);
    expect(await db.tasks.count()).toBe(1);
  });

  it('相同 DOI 不能重复收录，关联写入失败则文献也回滚', async () => {
    await createReference({ title: '已有来源', doi: '10.1234/existing' });
    expect(
      (
        await executeAiAction(
          { action: 'create_reference', title: '重复来源', doi: 'https://doi.org/10.1234/existing' },
          await loadDataset(),
          workspace,
        )
      ).ok,
    ).toBe(false);
    const project = await createProject({ name: '关联失败' });
    const rejectLink = () => {
      throw new Error('模拟关联表故障');
    };
    db.projectReferences.hook('creating', rejectLink);
    try {
      const result = await executeAiAction(
        {
          action: 'create_reference',
          title: '不应留下的文献',
          url: 'https://example.org/source',
          projectId: project.id,
        },
        await loadDataset(),
        workspace,
      );
      expect(result.ok).toBe(false);
      expect(await db.references.count()).toBe(1);
      expect(await db.projectReferences.count()).toBe(0);
    } finally {
      db.projectReferences.hook('creating').unsubscribe(rejectLink);
    }
  });

  it.each([
    { action: 'create_task', title: '非法枚举', priority: 'highest' },
    { action: 'create_task', title: '非法日期', dueDate: '2026-02-31' },
    { action: 'create_task', title: 'x'.repeat(241) },
    { action: 'create_task', title: '不能指定归属', userId: 'someone-else' },
    { action: 'create_tasks', items: [null] },
    { action: 'create_tasks', items: Array.from({ length: MAX_AI_BATCH_ITEMS + 1 }, () => ({ title: '太多' })) },
    { action: 'create_reference', title: '不安全来源', url: 'javascript:alert(1)' },
    { action: 'create_reference', title: '坏 DOI', doi: 'not-a-doi' },
    { action: 'create_project', name: '日期反转', startDate: '2026-12-30', endDate: '2026-11-01' },
  ])('拒绝非法操作且不改变数据库：$action', async (action) => {
    const result = await executeAiAction(action as AiAction, await loadDataset(), workspace);
    expect(result.ok).toBe(false);
    const data = await loadDataset();
    expect(data.projects.length + data.tasks.length + data.references.length).toBe(0);
  });
});

type TaskRow = { title: string };
