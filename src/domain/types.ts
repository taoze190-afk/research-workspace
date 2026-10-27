export type ID = string;

export const PROJECT_STATUSES = ['planned', 'active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'doing', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RECURRENCES = ['none', 'weekly', 'biweekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EXPERIMENT_STATUSES = ['draft', 'active', 'done', 'failed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const READING_STATUSES = ['unread', 'reading', 'read'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const ENTITY_TYPES = ['project', 'task', 'experiment', 'reference'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planned: '计划中',
  active: '进行中',
  paused: '暂停',
  completed: '已完成',
  archived: '已归档',
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

export const recurrenceLabels: Record<Recurrence, string> = {
  none: '不重复',
  weekly: '每周',
  biweekly: '每两周',
  monthly: '每月',
};

export const priorityLabels: Record<Priority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

export const experimentStatusLabels: Record<ExperimentStatus, string> = {
  draft: '草稿',
  active: '进行中',
  done: '已完成',
  failed: '失败',
};

export const readingStatusLabels: Record<ReadingStatus, string> = {
  unread: '待读',
  reading: '阅读中',
  read: '已读',
};

export interface BaseRecord {
  id: ID;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  isDemo: boolean;
}

export interface Project extends BaseRecord {
  name: string;
  question: string;
  goal: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  favorite: boolean;
}

export interface Milestone extends BaseRecord {
  projectId: ID;
  title: string;
  dueDate: string | null;
  done: boolean;
  sortOrder: number;
}

export interface Task extends BaseRecord {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  projectId: ID | null;
  sourceExperimentId: ID | null;
  referenceId: ID | null;
  completedAt: number | null;
  recurrence: Recurrence;
}

export interface Subtask extends BaseRecord {
  taskId: ID;
  title: string;
  done: boolean;
  sortOrder: number;
}

export interface Experiment extends BaseRecord {
  title: string;
  experimentDate: string;
  projectId: ID | null;
  status: ExperimentStatus;
  purpose: string;
  hypothesis: string;
  dataSources: DataSource[];
  method: string;
  results: string;
  observations: string;
  conclusion: string;
  nextStep: string;
  repoUrl: string;
  commit: string;
  sourceExperimentId: ID | null;
}

export interface DataSource {
  id: ID;
  kind: 'path' | 'version' | 'link' | 'model' | 'param' | 'metric' | 'other';
  label: string;
}

export interface Reference extends BaseRecord {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  readingStatus: ReadingStatus;
  favorite: boolean;
  noteQuestion: string;
  noteMethod: string;
  noteFindings: string;
  noteLimits: string;
  noteRelevance: string;
}

export interface Tag extends BaseRecord {
  name: string;
}

export interface EntityTag extends BaseRecord {
  tagId: ID;
  entityType: EntityType;
  entityId: ID;
}

export interface ProjectReference extends BaseRecord {
  projectId: ID;
  referenceId: ID;
}

export interface Dataset {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  subtasks: Subtask[];
  experiments: Experiment[];
  references: Reference[];
  tags: Tag[];
  entityTags: EntityTag[];
  projectReferences: ProjectReference[];
}

export const emptyDataset = (): Dataset => ({
  projects: [],
  milestones: [],
  tasks: [],
  subtasks: [],
  experiments: [],
  references: [],
  tags: [],
  entityTags: [],
  projectReferences: [],
});

export type TaskFilter = 'today' | 'week' | 'overdue' | 'all' | 'none';
