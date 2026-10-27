import { describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import {
  addMilestone,
  addSubtask,
  clearDemoData,
  createExperiment,
  createProject,
  createReference,
  createTask,
  deleteProject,
  deleteReference,
  duplicateExperiment,
  linkReferenceProject,
  loadDataset,
  restore,
  purge,
  setEntityTags,
  setTaskStatus,
  unlinkReferenceProject,
  updateExperiment,
  updateTask,
} from '@/data/repo';
import { loadDemoData } from '@/data/demo';
import { projectProgress, projectReferences, progressLabel, projectTasks } from '@/domain/progress';
import { localToday, addDays } from '@/domain/date';
import { getPrefs, setPrefs } from '@/lib/prefs';

/** 一条完整的科研工作流：立项 → 排任务 → 推进 → 记实验 → 挂文献 → 删除恢复，全部落在真实 IndexedDB 上。 */
describe('完整科研工作流', () => {
  it('每个环节都能写进库并读回来', async () => {
    const today = localToday();

    const project = await createProject({ name: '腕臂式肌电采集', question: '八通道能否分六类', goal: '识别率 90%', status: 'active' });
    expect(project.status).toBe('active');

    const task = await createTask({ title: '标定静息阈值', projectId: project.id, priority: 'high', dueDate: today });
    await addSubtask(task.id, '列出六类握姿定义');
    await setTaskStatus(task.id, 'done');

    const experiment = await createExperiment({ title: '台架基线', projectId: project.id, status: 'active', purpose: '拿 MVC' });
    await updateExperiment(experiment.id, { results: '10 人完成' });

    const reference = await createReference({ title: '通道选择方法', authors: '张三', year: 2024, doi: '10.9/x' });
    await linkReferenceProject(reference.id, project.id);
    await setEntityTags('experiment', experiment.id, ['采集', '基线']);
    await addMilestone({ projectId: project.id, title: '采满十人' });

    const snapshot = await loadDataset();
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.tasks[0].completedAt).not.toBeNull();
    expect(snapshot.subtasks[0].taskId).toBe(task.id);
    expect(snapshot.experiments[0].results).toBe('10 人完成');
    expect(projectProgress(snapshot.tasks, project.id)).toMatchObject({ kind: 'value', ratio: 1, done: 1, total: 1 });
    expect(projectReferences(snapshot, project.id).map((r) => r.id)).toEqual([reference.id]);
    expect((await db.entityTags.toArray()).map((e) => e.tagId)).toHaveLength(2);

    // 「刷新后仍然存在」：再读一次库，数据完全一致
    const reread = await loadDataset();
    expect(reread).toEqual(snapshot);
  });

  it('取消的任务不进进度分母，看板与项目进度同源', async () => {
    const project = await createProject({ name: '挥拍前轨迹', status: 'active' });
    const a = await createTask({ title: '对齐时间戳', projectId: project.id });
    const b = await createTask({ title: '买第二块板', projectId: project.id });
    const c = await createTask({ title: '写脚本', projectId: project.id });
    await setTaskStatus(a.id, 'done');
    await setTaskStatus(b.id, 'cancelled');

    const data = await loadDataset();
    const progress = projectProgress(data.tasks, project.id);
    expect(progress).toMatchObject({ done: 1, total: 2, ratio: 0.5 });
    expect(progressLabel(progress)).toBe('50%');
    expect(projectTasks(data, project.id)).toHaveLength(3);
    expect(c.status).toBe('todo');
  });

  it('同一条文献服务多个项目；解除关联不会删条目', async () => {
    const p1 = await createProject({ name: '项目甲' });
    const p2 = await createProject({ name: '项目乙' });
    const ref = await createReference({ title: '共享的一篇' });

    await linkReferenceProject(ref.id, p1.id);
    await linkReferenceProject(ref.id, p2.id);
    let data = await loadDataset();
    expect(projectReferences(data, p1.id)).toHaveLength(1);
    expect(projectReferences(data, p2.id)).toHaveLength(1);

    await unlinkReferenceProject(ref.id, p1.id);
    data = await loadDataset();
    expect(projectReferences(data, p1.id)).toHaveLength(0);
    expect(projectReferences(data, p2.id)).toHaveLength(1);
    expect(await db.references.get(ref.id)).toBeDefined();

    // 重复关联应当幂等
    await linkReferenceProject(ref.id, p2.id);
    expect((await db.projectReferences.toArray()).filter((l) => l.projectId === p2.id)).toHaveLength(1);
  });

  it('删除项目不会抹掉实验和文献，恢复后关系原样回来', async () => {
    const project = await createProject({ name: '边缘部署预研' });
    const task = await createTask({ title: '估算内存', projectId: project.id });
    const experiment = await createExperiment({ title: '量化试算', projectId: project.id });
    const reference = await createReference({ title: '定点量化预算' });
    await linkReferenceProject(reference.id, project.id);
    await addMilestone({ projectId: project.id, title: '出评估表' });

    const impact = await deleteProject(project.id);
    expect(impact.tasks).toBe(1);
    expect(impact.experiments).toBe(1);
    expect(impact.referenceLinks).toBe(1);

    const data = await loadDataset();
    expect(data.projects.find((p) => p.id === project.id)?.deletedAt).not.toBeNull();
    expect((await db.experiments.get(experiment.id))?.deletedAt).toBeNull();
    expect((await db.references.get(reference.id))?.deletedAt).toBeNull();
    expect((await db.milestones.toArray())[0].deletedAt).not.toBeNull();

    await restore('project', project.id);
    const restored = await loadDataset();
    expect(projectReferences(restored, project.id).map((r) => r.id)).toEqual([reference.id]);
    expect(projectTasks(restored, project.id).map((t) => t.id)).toEqual([task.id]);
    expect((await db.milestones.toArray())[0].deletedAt).toBeNull();
  });

  it('彻底删除项目才把任务与实验退回未关联，文献条目仍然保留', async () => {
    const project = await createProject({ name: '要真删的项目' });
    const task = await createTask({ title: '留在库里的任务', projectId: project.id });
    const experiment = await createExperiment({ title: '留在库里的实验', projectId: project.id });
    const reference = await createReference({ title: '留在库里的文献' });
    await linkReferenceProject(reference.id, project.id);

    await deleteProject(project.id);
    await purge('project', project.id);

    const data = await loadDataset();
    expect(data.projects).toHaveLength(0);
    expect((await db.tasks.get(task.id))?.projectId).toBeNull();
    expect((await db.experiments.get(experiment.id))?.projectId).toBeNull();
    expect(await db.references.get(reference.id)).toBeDefined();
    expect(await db.projectReferences.toArray()).toHaveLength(0);
    expect(await db.milestones.toArray()).toHaveLength(0);
  });

  it('删除文献条目只进回收站，恢复后关联还在', async () => {
    const project = await createProject({ name: '文献宿主' });
    const ref = await createReference({ title: '会被删的条目' });
    await linkReferenceProject(ref.id, project.id);

    await deleteReference(ref.id);
    let data = await loadDataset();
    expect(projectReferences(data, project.id)).toHaveLength(0);

    await restore('reference', ref.id);
    data = await loadDataset();
    expect(projectReferences(data, project.id).map((r) => r.title)).toEqual(['会被删的条目']);
  });

  it('复制实验用新 ID 并保留来源关系', async () => {
    const original = await createExperiment({ title: '原始记录', purpose: '看清楚' });
    await setEntityTags('experiment', original.id, ['待复现']);
    const copy = await duplicateExperiment(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.sourceExperimentId).toBe(original.id);
    expect(copy.title).toBe('原始记录 副本');
    expect(copy.status).toBe('draft');

    const data = await loadDataset();
    const link = (await db.entityTags.where('[entityType+entityId]').equals(['experiment', copy.id]).toArray())[0];
    expect(link).toBeDefined();
    expect(data.experiments.filter((e) => e.sourceExperimentId === original.id)).toHaveLength(1);
  });

  it('任务改日期与状态会刷新 updatedAt，供「最近编辑」使用', async () => {
    const task = await createTask({ title: '排序检查', dueDate: localToday() });
    const first = (await db.tasks.get(task.id))!;
    await new Promise((r) => setTimeout(r, 5));
    await updateTask(task.id, { dueDate: addDays(localToday(), 3), status: 'doing' });
    const second = (await db.tasks.get(task.id))!;
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.completedAt).toBeNull();
  });
});

describe('演示数据与用户数据隔离', () => {
  it('载入一次，刷新不会重复插入', async () => {
    setPrefs({ demoLoadedAt: null });
    const userProject = await createProject({ name: '我自己的课题' });

    const first = await loadDemoData();
    expect(first.loaded).toBe(true);
    const afterFirst = await loadDataset();

    const second = await loadDemoData();
    expect(second.loaded).toBe(false);
    const afterSecond = await loadDataset();
    expect(afterSecond).toEqual(afterFirst);
    expect(getPrefs().demoLoadedAt).not.toBeNull();

    // 演示内容该有的都有，而且日期相对今天生成
    const today = localToday();
    const demoTasks = afterSecond.tasks.filter((t) => t.isDemo);
    expect(demoTasks.some((t) => t.dueDate === today)).toBe(true);
    expect(demoTasks.some((t) => (t.dueDate ?? '9999') < today)).toBe(true);
    expect(afterSecond.projects.filter((p) => p.isDemo)).toHaveLength(3);
    expect(afterSecond.experiments.filter((e) => e.isDemo)).toHaveLength(4);
    expect(afterSecond.references.filter((r) => r.isDemo)).toHaveLength(6);
    expect(afterSecond.references.filter((r) => r.isDemo && r.doi !== '')).toHaveLength(0);

    const removed = await clearDemoData();
    const cleaned = await loadDataset();
    expect(removed).toBeGreaterThan(0);
    expect(cleaned.projects.map((p) => p.id)).toEqual([userProject.id]);
    expect(Object.values(cleaned).flat().some((row) => row.isDemo)).toBe(false);
  });

  it('清除演示数据不动用户记录', async () => {
    setPrefs({ demoLoadedAt: null });
    await loadDemoData();
    const mine = await createProject({ name: '用户的项目' });
    const myTask = await createTask({ title: '用户的任务', projectId: mine.id });
    await clearDemoData();

    const data = await loadDataset();
    expect(data.projects.map((p) => p.id)).toEqual([mine.id]);
    expect(data.tasks.map((t) => t.id)).toEqual([myTask.id]);
    expect(data.entityTags).toHaveLength(0);
    expect(data.references).toHaveLength(0);
  });
});
