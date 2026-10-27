import type { TableName } from './db.ts';

/** 业务表清单。同步层按这份名单做镜像覆盖，服务端按同名表校验。 */
export const TABLE_NAMES: TableName[] = [
  'projects',
  'milestones',
  'tasks',
  'subtasks',
  'experiments',
  'references',
  'tags',
  'entityTags',
  'projectReferences',
];
