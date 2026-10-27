import Dexie, { type Table } from 'dexie';
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
} from '@/domain/types';

/**
 * 本地数据库。schemaVersion 与备份文件里的 schemaVersion 是同一个数字。
 * 修改表结构时：新增 version(n+1).stores({...})，并在 .upgrade() 里把旧记录搬到新字段，
 * 同时把 SCHEMA_VERSION 与 lib/backup.ts 的可接受版本一起提升。
 */
export const SCHEMA_VERSION = 3;

export class ResearchDatabase extends Dexie {
  projects!: Table<Project, string>;
  milestones!: Table<Milestone, string>;
  tasks!: Table<Task, string>;
  subtasks!: Table<Subtask, string>;
  experiments!: Table<Experiment, string>;
  references!: Table<Reference, string>;
  tags!: Table<Tag, string>;
  entityTags!: Table<EntityTag, string>;
  projectReferences!: Table<ProjectReference, string>;

  constructor(name = 'research-workspace') {
    super(name);
    this.version(1).stores({
      projects: 'id, name, status, favorite, updatedAt, deletedAt',
      milestones: 'id, projectId, sortOrder, updatedAt',
      tasks: 'id, projectId, status, dueDate, sourceExperimentId, updatedAt, deletedAt',
      subtasks: 'id, taskId, sortOrder',
      experiments: 'id, projectId, status, title, updatedAt, deletedAt, sourceExperimentId',
      references: 'id, doi, title, readingStatus, favorite, updatedAt, deletedAt',
      projectReferences: 'id, projectId, referenceId',
      tags: 'id, name',
      entityTags: 'id, tagId, [entityType+entityId]',
    });
    // v2：任务加 recurrence。字段不进索引，Dexie 不需要重声明 stores，只需补一次回填。
    this.version(2).upgrade((tx) =>
      tx.table('tasks').toCollection().modify((task) => {
        if (task.recurrence === undefined) task.recurrence = 'none';
      })
    );
    // v3：任务可关联文献（referenceId），旧记录补 null
    this.version(3).upgrade((tx) =>
      tx.table('tasks').toCollection().modify((task) => {
        if (task.referenceId === undefined) task.referenceId = null;
      })
    );
  }
}

export const db = new ResearchDatabase();

export type TableName =
  | 'projects'
  | 'milestones'
  | 'tasks'
  | 'subtasks'
  | 'experiments'
  | 'references'
  | 'tags'
  | 'entityTags'
  | 'projectReferences';

export const ENTITY_TABLE: Record<EntityType, TableName> = {
  project: 'projects',
  task: 'tasks',
  experiment: 'experiments',
  reference: 'references',
};
