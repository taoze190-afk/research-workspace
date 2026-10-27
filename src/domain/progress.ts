import type { Dataset, Experiment, Milestone, Reference, Task } from './types';
import { addDays, diffDays, localToday, mondayOf, pad2 } from './date';

export type ProgressState = { kind: 'none' } | { kind: 'value'; ratio: number; done: number; total: number };

/** 项目进度 = 已完成任务 / 未取消任务总数；已取消任务不参与计算，分母为 0 时不伪造进度。 */
export function projectProgress(tasks: Task[], projectId: string): ProgressState {
  const scoped = tasks.filter((t) => t.projectId === projectId && t.deletedAt === null);
  const counted = scoped.filter((t) => t.status !== 'cancelled');
  if (scoped.length === 0) return { kind: 'none' };
  if (counted.length === 0) return { kind: 'none' };
  const done = counted.filter((t) => t.status === 'done').length;
  return { kind: 'value', ratio: done / counted.length, done, total: counted.length };
}

export function progressLabel(state: ProgressState): string {
  if (state.kind === 'none') return '尚无任务';
  return `${Math.round(state.ratio * 100)}%`;
}

/** 截止日期为空不算逾期；已完成或已取消不算逾期。 */
export function isOverdue(task: Task, today = localToday()): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return diffDays(today, task.dueDate) < 0;
}

export function isDueToday(task: Task, today = localToday()): boolean {
  return task.dueDate === today;
}

export function isOpenTask(task: Task): boolean {
  return task.status === 'todo' || task.status === 'doing';
}

export interface DashboardSummary {
  activeProjects: number;
  todayOpen: number;
  overdue: number;
  unreadReferences: number;
}

export function dashboardSummary(data: Dataset, today = localToday()): DashboardSummary {
  const live = <T extends { deletedAt: number | null }>(rows: T[]) => rows.filter((r) => r.deletedAt === null);
  return {
    activeProjects: live(data.projects).filter((p) => p.status === 'active').length,
    todayOpen: live(data.tasks).filter((t) => isOpenTask(t) && isDueToday(t, today)).length,
    overdue: live(data.tasks).filter((t) => isOverdue(t, today)).length,
    unreadReferences: live(data.references).filter((r) => r.readingStatus !== 'read').length,
  };
}

/** 今天起 N 天内到期、且尚未逾期、仍未完成的任务。 */
export function tasksDueWithin(data: Dataset, days: number, today = localToday()): Task[] {
  return data.tasks
    .filter((t) => t.deletedAt === null && isOpenTask(t) && t.dueDate && !isOverdue(t, today))
    .filter((t) => t.dueDate! >= today && diffDays(today, t.dueDate!) <= days)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
}

export function byUpdated<T extends { updatedAt: number }>(rows: T[], limit = 5): T[] {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function projectTasks(data: Dataset, projectId: string): Task[] {
  return data.tasks.filter((t) => t.deletedAt === null && t.projectId === projectId);
}

export function projectExperiments(data: Dataset, projectId: string): Experiment[] {
  return data.experiments.filter((e) => e.deletedAt === null && e.projectId === projectId);
}

export function projectReferences(data: Dataset, projectId: string): Reference[] {
  const ids = new Set(
    data.projectReferences.filter((link) => link.deletedAt === null && link.projectId === projectId).map((link) => link.referenceId),
  );
  return data.references.filter((r) => r.deletedAt === null && ids.has(r.id));
}

export function projectMilestones(data: Dataset, projectId: string): Milestone[] {
  return data.milestones
    .filter((m) => m.deletedAt === null && m.projectId === projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function entityTags(data: Dataset, entityType: 'project' | 'task' | 'experiment' | 'reference', entityId: string): string[] {
  const tagIds = data.entityTags
    .filter((et) => et.deletedAt === null && et.entityType === entityType && et.entityId === entityId)
    .map((et) => et.tagId);
  const byId = new Map(data.tags.map((t) => [t.id, t.name]));
  return tagIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

export interface WeekBucket {
  label: string;
  from: string;
  to: string;
  value: number;
}

/**
 * 按本地周（周一开头）分桶统计真实完成量。
 * 只数 completedAt 落在这一周里的任务，不做任何外推；最后一桶始终是「本周」。
 */
export function completedPerWeek(tasks: Task[], weeks = 12, today = localToday()): WeekBucket[] {
  const dayOfWeek = (() => {
    const [y, m, d] = today.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  })();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = addDays(today, mondayOffset);
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(thisMonday, -7 * i);
    const to = addDays(from, 6);
    buckets.push({ label: from, from, to, value: 0 });
  }
  for (const t of tasks) {
    if (t.deletedAt !== null || t.status !== 'done' || !t.completedAt) continue;
    const d = new Date(t.completedAt);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const bucket = buckets.find((b) => key >= b.from && key <= b.to);
    if (bucket) bucket.value += 1;
  }
  return buckets;
}

/** 任务状态分布，用于堆叠条。已取消单列一段，不混进「完成」里。 */
export function taskStatusSegments(tasks: Task[]): { key: string; label: string; value: number; color: string }[] {
  const live = tasks.filter((t) => t.deletedAt === null);
  const count = (status: Task['status']) => live.filter((t) => t.status === status).length;
  return [
    { key: 'doing', label: '进行中', value: count('doing'), color: 'var(--info)' },
    { key: 'todo', label: '待办', value: count('todo'), color: 'var(--border-strong)' },
    { key: 'done', label: '已完成', value: count('done'), color: 'var(--brand)' },
    { key: 'cancelled', label: '已取消', value: count('cancelled'), color: 'var(--danger)' },
  ];
}

export interface ActivityDay {
  date: string;
  tasks: number;
  experiments: number;
}

const dayKeyOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * 最近 N 周（对齐到周一）的逐日活动：任务按 completedAt，实验按 updatedAt。
 * 只数真实时间戳，没有外推；当前周里今天之后的日子是空的。
 */
export function activityPerDay(tasks: Task[], experiments: Experiment[], weeks: number, today = localToday()): ActivityDay[] {
  const start = addDays(mondayOf(today), -(weeks - 1) * 7);
  const end = addDays(start, weeks * 7 - 1);
  const byDay = new Map<string, ActivityDay>();
  for (let date = start; date <= end; date = addDays(date, 1)) {
    byDay.set(date, { date, tasks: 0, experiments: 0 });
  }
  for (const t of tasks) {
    if (t.deletedAt !== null || t.status !== 'done' || !t.completedAt) continue;
    const key = dayKeyOf(t.completedAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.tasks += 1;
  }
  for (const e of experiments) {
    if (e.deletedAt !== null) continue;
    const bucket = byDay.get(dayKeyOf(e.updatedAt));
    if (bucket) bucket.experiments += 1;
  }
  return [...byDay.values()];
}
