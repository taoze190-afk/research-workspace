import { describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import {
  createProject,
  createExperiment,
  createReference,
  createTask,
  loadDataset,
  linkReferenceProject,
} from '@/data/repo';
import { executeAiAction, executeAiActions, previewAiAction } from '@/features/ai/actions';
const workspace = { kind: 'workspace', id: null };
describe('科研流程状态与关联动作', () => {
  it('文献与实验状态更新经过真实存储，原笔记和实验正文保留', async () => {
    const reference = await createReference({ title: '原文献', noteFindings: '已有人类笔记' });
    const experiment = await createExperiment({ title: '原实验', results: '真实测量结果' });
    const actions = [
      { action: 'set_reading_status', referenceId: reference.id, readingStatus: 'read' },
      { action: 'set_experiment_status', experimentId: experiment.id, status: 'done' },
    ];
    const preview = previewAiAction(actions[0], await loadDataset(), workspace);
    expect(preview.changes[0]).toMatchObject({ label: '阅读状态', before: '待读', after: '已读' });
    expect((await executeAiActions(actions, await loadDataset(), workspace)).ok).toBe(true);
    expect(await db.references.get(reference.id)).toMatchObject({
      readingStatus: 'read',
      noteFindings: '已有人类笔记',
    });
    expect(await db.experiments.get(experiment.id)).toMatchObject({ status: 'done', results: '真实测量结果' });
  });
  it('关联复用已有文献，重复提议和重新关联只保留一份文献及关联', async () => {
    const project = await createProject({ name: '目标项目' });
    const reference = await createReference({ title: '已有文献' });
    const context = { kind: 'project', id: project.id };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await executeAiAction(
            { action: 'link_reference_project', referenceId: reference.id },
            await loadDataset(),
            context,
          )
        ).ok,
      ).toBe(true);
    expect(await db.references.count()).toBe(1);
    expect(await db.projectReferences.count()).toBe(1);
  });
  it('显式projectId或null不能绕过项目任务范围，单条记录也不能指向另一条', async () => {
    const a = await createProject({ name: '甲' }),
      b = await createProject({ name: '乙' });
    const task = await createTask({ title: '乙任务', projectId: b.id });
    for (const projectId of [b.id, null])
      expect(
        (
          await executeAiAction(
            { action: 'update_task', projectId, taskId: task.id, changes: { status: 'done' } },
            await loadDataset(),
            { kind: 'project', id: a.id },
          )
        ).ok,
      ).toBe(false);
    const first = await createExperiment({ title: '第一实验' }),
      second = await createExperiment({ title: '第二实验' });
    expect(
      (
        await executeAiAction(
          { action: 'set_experiment_status', experimentId: second.id, status: 'done' },
          await loadDataset(),
          { kind: 'experiment', id: first.id },
        )
      ).ok,
    ).toBe(false);
    expect((await db.tasks.get(task.id))?.status).toBe('todo');
  });
  it('新状态动作受项目关联约束，批次中任一动作不合法时整体回滚', async () => {
    const project = await createProject({ name: '项目' });
    const reference = await createReference({ title: '尚未关联的文献' });
    expect(
      (
        await executeAiAction(
          { action: 'set_reading_status', referenceId: reference.id, readingStatus: 'read' },
          await loadDataset(),
          { kind: 'project', id: project.id },
        )
      ).ok,
    ).toBe(false);
    await linkReferenceProject(reference.id, project.id);
    const result = await executeAiActions(
      [
        { action: 'set_reading_status', referenceId: reference.id, readingStatus: 'read' },
        { action: 'set_experiment_status', experimentId: 'missing', status: 'done' },
      ],
      await loadDataset(),
      { kind: 'project', id: project.id },
    );
    expect(result.ok).toBe(false);
    expect((await db.references.get(reference.id))?.readingStatus).toBe('unread');
    expect(
      (
        await executeAiAction(
          { action: 'set_reading_status', referenceId: reference.id, readingStatus: 'read', userId: 'other' },
          await loadDataset(),
          workspace,
        )
      ).ok,
    ).toBe(false);
  });
});
