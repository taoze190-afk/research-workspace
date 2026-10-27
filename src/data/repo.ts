import { db, ENTITY_TABLE, type TableName } from './db';
import { newBase } from '@/lib/id';
import { localToday } from '@/domain/date';
import { nextDueFor } from '@/domain/recurring';
import type {
  EntityTag,
  EntityType,
  Experiment,
  Milestone,
  Project,
  ProjectReference,
  Reference,
  Subtask,
  Tag,
  Task,
  Dataset,
} from '@/domain/types';

export async function loadDataset(): Promise<Dataset> {
  const [projects, milestones, tasks, subtasks, experiments, references, tags, entityTags, projectReferences] = await Promise.all([
    db.projects.toArray(),
    db.milestones.toArray(),
    db.tasks.toArray(),
    db.subtasks.toArray(),
    db.experiments.toArray(),
    db.references.toArray(),
    db.tags.toArray(),
    db.entityTags.toArray(),
    db.projectReferences.toArray(),
  ]);
  return { projects, milestones, tasks, subtasks, experiments, references, tags, entityTags, projectReferences };
}

const stamp = () => Date.now();

/** 唯一的补丁入口：始终刷新 updatedAt，避免各处 store 自己维护副本时间戳。 */
async function patch<T extends { id: string; updatedAt: number }>(table: TableName, id: string, changes: Partial<T>): Promise<void> {
  await db.transaction('rw', db.table(table), async () => {
    await db.table(table).update(id, { ...changes, updatedAt: stamp() });
  });
}

async function linksOf(column: 'projectId' | 'referenceId', id: string) {
  return db.projectReferences.where(column).equals(id).toArray();
}

// ---------------------------------------------------------------- 项目

export async function createProject(input: Partial<Project> & { name: string }): Promise<Project> {
  const record: Project = {
    ...newBase(input.isDemo),
    name: input.name.trim(),
    question: input.question ?? '',
    goal: input.goal ?? '',
    status: input.status ?? 'planned',
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    favorite: input.favorite ?? false,
  };
  await db.projects.add(record);
  return record;
}

export const updateProject = (id: string, changes: Partial<Project>) => patch<Project>('projects', id, changes);

export async function addMilestone(input: Pick<Milestone, 'projectId' | 'title'> & { dueDate?: string | null; isDemo?: boolean }): Promise<Milestone> {
  const count = await db.milestones.where('projectId').equals(input.projectId).count();
  const record: Milestone = {
    ...newBase(input.isDemo),
    projectId: input.projectId,
    title: input.title.trim(),
    dueDate: input.dueDate ?? null,
    done: false,
    sortOrder: count,
  };
  await db.milestones.add(record);
  return record;
}

export const updateMilestone = (id: string, changes: Partial<Milestone>) => patch<Milestone>('milestones', id, changes);
export const deleteMilestone = (id: string) => db.milestones.delete(id);

// ---------------------------------------------------------------- 任务

export interface NewTask {
  title: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  dueDate?: string | null;
  projectId?: string | null;
  sourceExperimentId?: string | null;
  referenceId?: string | null;
  recurrence?: Task['recurrence'];
  isDemo?: boolean;
}

export async function createTask(input: NewTask): Promise<Task> {
  const record: Task = {
    ...newBase(input.isDemo),
    title: input.title.trim(),
    description: input.description ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    dueDate: input.dueDate ?? null,
    projectId: input.projectId ?? null,
    sourceExperimentId: input.sourceExperimentId ?? null,
    referenceId: input.referenceId ?? null,
    completedAt: input.status === 'done' ? stamp() : null,
    recurrence: input.recurrence ?? 'none',
  };
  await db.tasks.add(record);
  return record;
}

/** 完成重复任务时生成下一期：同标题同属性，截止日按周期规则推后，状态回到待办。 */
export async function spawnNextTask(task: Task): Promise<Task | null> {
  if (task.recurrence === 'none') return null;
  return createTask({
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: nextDueFor(task),
    projectId: task.projectId,
    sourceExperimentId: task.sourceExperimentId,
    referenceId: task.referenceId,
    recurrence: task.recurrence,
  });
}

export const updateTask = (id: string, changes: Partial<Task>) => patch<Task>('tasks', id, changes);

/** 状态和 completedAt 必须同一次写入里一起变，否则撤销与「最近完成」会错位。 */
export async function setTaskStatus(id: string, status: Task['status']): Promise<void> {
  await db.tasks.update(id, { status, completedAt: status === 'done' ? stamp() : null, updatedAt: stamp() });
}

export async function addSubtask(taskId: string, title: string, isDemo = false): Promise<Subtask> {
  const count = await db.subtasks.where('taskId').equals(taskId).count();
  const record: Subtask = { ...newBase(isDemo), taskId, title: title.trim(), done: false, sortOrder: count };
  await db.subtasks.add(record);
  await db.tasks.update(taskId, { updatedAt: stamp() });
  return record;
}

export async function updateSubtask(id: string, changes: Partial<Subtask>): Promise<void> {
  const row = await db.subtasks.get(id);
  await db.subtasks.update(id, { ...changes, updatedAt: stamp() });
  if (row) await db.tasks.update(row.taskId, { updatedAt: stamp() });
}

export async function deleteSubtask(id: string): Promise<void> {
  const row = await db.subtasks.get(id);
  await db.subtasks.delete(id);
  if (row) await db.tasks.update(row.taskId, { updatedAt: stamp() });
}

// ---------------------------------------------------------------- 实验

export function emptyExperiment(isDemo = false): Experiment {
  return {
    ...newBase(isDemo),
    title: '',
    experimentDate: localToday(),
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
  };
}

export async function createExperiment(input: Partial<Experiment> = {}): Promise<Experiment> {
  const record: Experiment = { ...emptyExperiment(input.isDemo), ...input };
  await db.experiments.add(record);
  return record;
}

export const updateExperiment = (id: string, changes: Partial<Experiment>) => patch<Experiment>('experiments', id, changes);

/** 复制为新实验：新 ID、状态回到草稿、保留来源关系、标签一起带走。 */
export async function duplicateExperiment(source: Experiment): Promise<Experiment> {
  const copy: Experiment = {
    ...source,
    ...newBase(false),
    title: source.title ? `${source.title} 副本` : '',
    status: 'draft',
    sourceExperimentId: source.id,
  };
  await db.transaction('rw', db.experiments, db.entityTags, async () => {
    await db.experiments.add(copy);
    const tags = await db.entityTags.where('[entityType+entityId]').equals(['experiment', source.id]).toArray();
    for (const tag of tags) {
      const row: EntityTag = { ...newBase(false), tagId: tag.tagId, entityType: 'experiment', entityId: copy.id };
      await db.entityTags.add(row);
    }
  });
  return copy;
}

// ---------------------------------------------------------------- 文献

export function emptyReference(isDemo = false): Reference {
  return {
    ...newBase(isDemo),
    title: '',
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
  };
}

export async function createReference(input: Partial<Reference> = {}): Promise<Reference> {
  const record: Reference = { ...emptyReference(input.isDemo), ...input };
  await db.references.add(record);
  return record;
}

export const updateReference = (id: string, changes: Partial<Reference>) => patch<Reference>('references', id, changes);

export async function linkReferenceProject(referenceId: string, projectId: string, isDemo = false): Promise<void> {
  const existing = await db.projectReferences
    .where('projectId')
    .equals(projectId)
    .and((r) => r.referenceId === referenceId)
    .first();
  if (existing) {
    if (existing.deletedAt !== null) await db.projectReferences.update(existing.id, { deletedAt: null, updatedAt: stamp() });
    return;
  }
  const record: ProjectReference = { ...newBase(isDemo), projectId, referenceId };
  await db.projectReferences.add(record);
}

export async function unlinkReferenceProject(referenceId: string, projectId: string): Promise<void> {
  const rows = await db.projectReferences.where('projectId').equals(projectId).and((r) => r.referenceId === referenceId).toArray();
  await db.projectReferences.bulkDelete(rows.map((r) => r.id));
}

// ---------------------------------------------------------------- 标签

export async function ensureTag(name: string, isDemo = false): Promise<Tag> {
  const clean = name.trim().replace(/^#/, '');
  const existing = await db.tags.filter((t) => t.deletedAt === null && t.name.toLowerCase() === clean.toLowerCase()).first();
  if (existing) return existing;
  const record: Tag = { ...newBase(isDemo), name: clean };
  await db.tags.add(record);
  return record;
}

/** 整组替换：实体标签关系只有这一个写入入口。 */
export async function setEntityTags(entityType: EntityType, entityId: string, names: string[]): Promise<void> {
  const clean = [...new Set(names.map((n) => n.trim().replace(/^#/, '')).filter(Boolean))];
  await db.transaction('rw', db.tags, db.entityTags, db.table(ENTITY_TABLE[entityType]), async () => {
    await db.entityTags.where('[entityType+entityId]').equals([entityType, entityId]).delete();
    for (const name of clean) {
      const tag = await ensureTag(name);
      await db.entityTags.add({ ...newBase(), tagId: tag.id, entityType, entityId });
    }
    await db.table(ENTITY_TABLE[entityType]).update(entityId, { updatedAt: stamp() });
  });
}

export async function deleteTag(tagId: string): Promise<void> {
  await db.transaction('rw', db.tags, db.entityTags, async () => {
    await db.tags.delete(tagId);
    await db.entityTags.where('tagId').equals(tagId).delete();
  });
}

/**
 * 重命名标签；如果库里有同名（忽略大小写）的另一个标签，就合并过去：
 * 关系一条条改挂到目标上，会撞出重复「实体+标签」的先删掉，最后旧标签整体消失。
 */
export async function renameTag(tagId: string, rawName: string): Promise<{ mergedIntoId: string | null }> {
  const name = rawName.trim().replace(/^#/, '');
  const source = await db.tags.get(tagId);
  if (!source || !name) return { mergedIntoId: null };
  if (source.name.toLowerCase() === name.toLowerCase()) {
    if (source.name !== name) await db.tags.update(tagId, { name, updatedAt: stamp() });
    return { mergedIntoId: null };
  }
  const target = await db.tags.filter((t) => t.id !== tagId && t.deletedAt === null && t.name.toLowerCase() === name.toLowerCase()).first();
  await db.transaction('rw', db.tags, db.entityTags, async () => {
    if (!target) {
      await db.tags.update(tagId, { name, updatedAt: stamp() });
      return;
    }
    const links = await db.entityTags.where('tagId').equals(tagId).toArray();
    const targetKeys = new Set((await db.entityTags.where('tagId').equals(target.id).toArray()).map((l) => `${l.entityType}:${l.entityId}`));
    const dupes = links.filter((l) => targetKeys.has(`${l.entityType}:${l.entityId}`)).map((l) => l.id);
    if (dupes.length) await db.entityTags.bulkDelete(dupes);
    const moving = links.filter((l) => !dupes.includes(l.id));
    if (moving.length) await db.entityTags.bulkPut(moving.map((l) => ({ ...l, tagId: target.id, updatedAt: stamp() })));
    await db.tags.delete(tagId);
  });
  return { mergedIntoId: target?.id ?? null };
}

// ---------------------------------------------------------------- 删除与回收站

export interface DeleteImpact {
  tasks: number;
  experiments: number;
  referenceLinks: number;
  milestones: number;
}

/**
 * 删除项目只软删项目本身 + 它的里程碑。任务、实验、文献条目一条都不动，
 * 因此在回收站期间关系完整保留，恢复后一切照旧。
 */
export async function deleteProject(projectId: string): Promise<DeleteImpact> {
  return db.transaction('rw', db.tables, async () => {
    const now = stamp();
    const impact: DeleteImpact = {
      tasks: await db.tasks.where('projectId').equals(projectId).and((t) => t.deletedAt === null).count(),
      experiments: await db.experiments.where('projectId').equals(projectId).and((e) => e.deletedAt === null).count(),
      referenceLinks: (await linksOf('projectId', projectId)).filter((r) => r.deletedAt === null).length,
      milestones: 0,
    };
    await db.projects.update(projectId, { deletedAt: now, updatedAt: now, favorite: false });
    const milestones = await db.milestones.where('projectId').equals(projectId).and((m) => m.deletedAt === null).toArray();
    await db.milestones.bulkPut(milestones.map((m) => ({ ...m, deletedAt: now, updatedAt: now })));
    impact.milestones = milestones.length;
    return impact;
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  const now = stamp();
  await db.transaction('rw', db.tasks, db.subtasks, async () => {
    await db.tasks.update(taskId, { deletedAt: now, updatedAt: now });
    await db.subtasks.where('taskId').equals(taskId).modify({ deletedAt: now });
  });
}

export async function deleteExperiment(id: string): Promise<void> {
  const now = stamp();
  await db.experiments.update(id, { deletedAt: now, updatedAt: now });
}

/** 删除文献条目：条目本身进回收站，项目侧只断关联，文献不会因为某个项目被删而消失。 */
export async function deleteReference(id: string): Promise<void> {
  const now = stamp();
  await db.transaction('rw', db.references, db.projectReferences, async () => {
    await db.references.update(id, { deletedAt: now, updatedAt: now });
    const links = (await linksOf('referenceId', id)).filter((l) => l.deletedAt === null);
    await db.projectReferences.bulkPut(links.map((l) => ({ ...l, deletedAt: now })));
  });
}

export async function restore(entityType: EntityType, entityId: string): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  await db.transaction('rw', db.tables, async () => {
    await db.table(table).update(entityId, { deletedAt: null, updatedAt: stamp() });
    if (table === 'tasks') await db.subtasks.where('taskId').equals(entityId).modify({ deletedAt: null });
    if (table === 'projects') {
      const milestones = await db.milestones.where('projectId').equals(entityId).toArray();
      await db.milestones.bulkPut(milestones.map((m) => ({ ...m, deletedAt: null })));
    }
    if (table === 'references') {
      const links = await linksOf('referenceId', entityId);
      await db.projectReferences.bulkPut(links.map((l) => ({ ...l, deletedAt: null })));
    }
  });
}

/** 彻底删除才真的动手：子记录要么跟着消失，要么被显式解除关联。 */
export async function purge(entityType: EntityType, entityId: string): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  await db.transaction('rw', db.tables, async () => {
    await db.table(table).delete(entityId);
    await db.entityTags.where('[entityType+entityId]').equals([entityType, entityId]).delete();
    if (table === 'tasks') await db.subtasks.where('taskId').equals(entityId).delete();
    if (table === 'experiments') await db.tasks.where('sourceExperimentId').equals(entityId).modify({ sourceExperimentId: null });
    if (table === 'references') await db.projectReferences.where('referenceId').equals(entityId).delete();
    if (table === 'projects') {
      await db.milestones.where('projectId').equals(entityId).delete();
      await db.projectReferences.where('projectId').equals(entityId).delete();
      // 项目没了，任务与实验保留但退回「未关联项目」，绝不留悬空引用。
      await db.tasks.where('projectId').equals(entityId).modify({ projectId: null });
      await db.experiments.where('projectId').equals(entityId).modify({ projectId: null });
    }
  });
}

export async function emptyRecycleBin(): Promise<number> {
  let removed = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const table of Object.values(ENTITY_TABLE) as TableName[]) {
      const ids = (await db.table(table).filter((r) => (r as { deletedAt: number | null }).deletedAt !== null).primaryKeys()) as string[];
      if (ids.length === 0) continue;
      await db.table(table).bulkDelete(ids);
      removed += ids.length;
    }
    for (const table of ['subtasks', 'milestones', 'projectReferences'] as TableName[]) {
      const ids = (await db.table(table).filter((r) => (r as { deletedAt: number | null }).deletedAt !== null).primaryKeys()) as string[];
      if (ids.length) await db.table(table).bulkDelete(ids);
    }
    // 清掉指向已消失实体的标签关系，孤立标签名保留在回收站之外由用户自己决定。
    const alive = new Set<string>();
    for (const [entityType, table] of Object.entries(ENTITY_TABLE) as [EntityType, TableName][]) {
      for (const row of (await db.table(table).toArray()) as { id: string }[]) alive.add(`${entityType}:${row.id}`);
    }
    const staleTags = await db.entityTags.filter((et) => !alive.has(`${et.entityType}:${et.entityId}`)).toArray();
    if (staleTags.length) await db.entityTags.bulkDelete(staleTags.map((t) => t.id));
  });
  return removed;
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}

// ---------------------------------------------------------------- 演示数据

/** 演示记录都带 isDemo=true，清理时只按这个标记删，绝不碰用户记录。 */
export async function clearDemoData(): Promise<number> {
  let removed = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      const ids = await table.filter((row) => (row as { isDemo?: boolean }).isDemo === true).primaryKeys();
      if (ids.length) await table.bulkDelete(ids);
      removed += ids.length;
    }
  });
  return removed;
}
