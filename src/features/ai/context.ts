import { localToday, addDays } from '@/domain/date';
import type { Dataset, Experiment, Project, Reference, Task } from '@/domain/types';
import type { WorkflowId } from './workflows';

export type ResearchContextKind = 'workspace' | 'project' | 'task' | 'experiment' | 'reference' | 'none';
export type ResearchRecord = Project | Task | Experiment | Reference;
export interface ResearchContext {
  text: string;
  label: string;
  kind: ResearchContextKind;
  id: string | null;
  record: ResearchRecord | null;
  counts: {
    projects: number;
    tasks: number;
    experiments: number;
    references: number;
    milestones: number;
    subtasks: number;
  };
  truncated: boolean;
}

export const MAX_CONTEXT_CHARS = 24_000;
const emptyCounts = () => ({ projects: 0, tasks: 0, experiments: 0, references: 0, milestones: 0, subtasks: 0 });
const live = <T extends { deletedAt: number | null }>(rows: T[]) => rows.filter((row) => row.deletedAt === null);
const recent = <T extends { updatedAt: number }>(rows: T[]) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
const open = (task: Task) => task.status === 'todo' || task.status === 'doing';

export function aiWorkspaceHref(scope = 'workspace', prompt?: string, workflow?: WorkflowId): string {
  const params = new URLSearchParams({ scope });
  if (prompt) params.set('prompt', prompt);
  if (workflow) params.set('workflow', workflow);
  return `/ai?${params}`;
}

/** 仅从当前账号的 Dataset 组装资料。明确列出字段，不读取账号、模型配置或任何全局数据库。 */
export function buildResearchContext(data: Dataset, scope = 'workspace', today = localToday()): ResearchContext {
  const [requestedKind, requestedId] = scope.split(':');
  const kind = (
    ['workspace', 'project', 'task', 'experiment', 'reference', 'none'].includes(requestedKind) ? requestedKind : 'none'
  ) as ResearchContextKind;
  const none = (label: string): ResearchContext => ({
    text: '',
    label,
    kind: 'none',
    id: null,
    record: null,
    counts: emptyCounts(),
    truncated: false,
  });
  if (kind === 'none') return none('不附带资料');
  const allProjects = live(data.projects);
  const allTasks = live(data.tasks);
  const allExperiments = live(data.experiments);
  const allReferences = live(data.references);
  const record =
    kind === 'project'
      ? allProjects.find((p) => p.id === requestedId)
      : kind === 'task'
        ? allTasks.find((t) => t.id === requestedId)
        : kind === 'experiment'
          ? allExperiments.find((e) => e.id === requestedId)
          : kind === 'reference'
            ? allReferences.find((r) => r.id === requestedId)
            : null;
  if (kind !== 'workspace' && !record) return none('资料已删除或不可用');

  let projects: Project[] = [],
    tasks: Task[] = [],
    experiments: Experiment[] = [],
    references: Reference[] = [];
  if (kind === 'workspace') {
    projects = recent(allProjects).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));
    tasks = [...allTasks].sort(
      (a, b) =>
        Number(open(b)) - Number(open(a)) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        b.updatedAt - a.updatedAt,
    );
    experiments = recent(allExperiments);
    references = recent(allReferences);
  } else if (kind === 'project') {
    projects = [record as Project];
    tasks = allTasks.filter((t) => t.projectId === requestedId);
    experiments = recent(allExperiments.filter((e) => e.projectId === requestedId));
    const linked = new Set(
      live(data.projectReferences)
        .filter((l) => l.projectId === requestedId)
        .map((l) => l.referenceId),
    );
    references = allReferences.filter((r) => linked.has(r.id));
  } else if (kind === 'task') {
    const task = record as Task;
    tasks = [task];
    projects = allProjects.filter((p) => p.id === task.projectId);
    experiments = allExperiments.filter((e) => e.id === task.sourceExperimentId);
    references = allReferences.filter((r) => r.id === task.referenceId);
  } else if (kind === 'experiment') {
    const experiment = record as Experiment;
    experiments = [experiment];
    projects = allProjects.filter((p) => p.id === experiment.projectId);
    tasks = allTasks.filter((t) => t.sourceExperimentId === experiment.id);
  } else if (kind === 'reference') {
    references = [record as Reference];
    const linked = new Set(
      live(data.projectReferences)
        .filter((l) => l.referenceId === requestedId)
        .map((l) => l.projectId),
    );
    projects = allProjects.filter((p) => linked.has(p.id));
    tasks = allTasks.filter((t) => t.referenceId === requestedId);
  }
  const projectIds = new Set(projects.map((p) => p.id));
  const taskIds = new Set(tasks.map((t) => t.id));
  const milestones = live(data.milestones)
    .filter((m) => projectIds.has(m.projectId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const subtasks = live(data.subtasks)
    .filter((s) => taskIds.has(s.taskId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const counts = {
    projects: projects.length,
    tasks: tasks.length,
    experiments: experiments.length,
    references: references.length,
    milestones: milestones.length,
    subtasks: subtasks.length,
  };
  let truncated = false;
  const text = (value: string, limit: number) => {
    if (value.length <= limit) return value;
    truncated = true;
    return value.slice(0, limit) + '…';
  };
  const take = <T>(rows: T[], limit: number) => {
    if (rows.length > limit) truncated = true;
    return rows.slice(0, limit);
  };
  const projectRow = (p: Project) => ({
    id: p.id,
    name: text(p.name, 300),
    status: p.status,
    question: text(p.question, kind === 'workspace' ? 300 : 2000),
    goal: text(p.goal, kind === 'workspace' ? 300 : 2000),
    startDate: p.startDate,
    endDate: p.endDate,
  });
  const taskRow = (t: Task) => ({
    id: t.id,
    title: text(t.title, 300),
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    projectId: t.projectId,
    sourceExperimentId: t.sourceExperimentId,
    referenceId: t.referenceId,
    description: text(t.description, kind === 'workspace' ? 300 : 1200),
    recurrence: t.recurrence,
  });
  const experimentRow = (e: Experiment) => ({
    id: e.id,
    title: text(e.title, 300),
    projectId: e.projectId,
    experimentDate: e.experimentDate,
    status: e.status,
    purpose: text(e.purpose, 1800),
    hypothesis: text(e.hypothesis, 1800),
    method: text(e.method, 2500),
    results: text(e.results, 2500),
    observations: text(e.observations, 1800),
    conclusion: text(e.conclusion, 1800),
    nextStep: text(e.nextStep, 1800),
    dataSources: take(e.dataSources, 20).map((s) => ({ id: s.id, kind: s.kind, label: text(s.label, 700) })),
    repoUrl: text(e.repoUrl, 400),
    commit: text(e.commit, 100),
  });
  const referenceRow = (r: Reference) => ({
    id: r.id,
    title: text(r.title, 500),
    authors: text(r.authors, 500),
    year: r.year,
    venue: text(r.venue, 500),
    doi: text(r.doi, 300),
    url: text(r.url, 400),
    readingStatus: r.readingStatus,
    noteQuestion: text(r.noteQuestion, 2000),
    noteMethod: text(r.noteMethod, 2000),
    noteFindings: text(r.noteFindings, 2500),
    noteLimits: text(r.noteLimits, 1800),
    noteRelevance: text(r.noteRelevance, 1800),
  });
  const selected = record
    ? kind === 'project'
      ? projectRow(record as Project)
      : kind === 'task'
        ? taskRow(record as Task)
        : kind === 'experiment'
          ? experimentRow(record as Experiment)
          : referenceRow(record as Reference)
    : null;
  const primaryTagIds = new Set(
    live(data.entityTags)
      .filter((et) => et.entityType === kind && et.entityId === requestedId)
      .map((et) => et.tagId),
  );
  const payload: Record<string, unknown> = {
    schema: 'research-context-v1',
    source: 'current-user-research-data',
    today,
    scope: kind === 'workspace' ? 'workspace' : `${kind}:${requestedId}`,
    record: selected,
    counts,
    projects: take(projects, 50).map(projectRow),
    tasks: take(tasks, 60).map(taskRow),
    milestones: take(milestones, 40).map((m) => ({
      id: m.id,
      projectId: m.projectId,
      title: text(m.title, 300),
      dueDate: m.dueDate,
      done: m.done,
    })),
    subtasks: take(subtasks, 80).map((s) => ({ id: s.id, taskId: s.taskId, title: text(s.title, 300), done: s.done })),
    experiments: take(experiments, kind === 'workspace' ? 8 : 20).map((e) =>
      kind === 'workspace'
        ? {
            id: e.id,
            title: text(e.title, 300),
            projectId: e.projectId,
            experimentDate: e.experimentDate,
            status: e.status,
            results: text(e.results, 500),
            nextStep: text(e.nextStep, 500),
          }
        : experimentRow(e),
    ),
    references: take(references, kind === 'workspace' ? 8 : 20).map((r) =>
      kind === 'workspace'
        ? {
            id: r.id,
            title: text(r.title, 300),
            authors: text(r.authors, 200),
            year: r.year,
            readingStatus: r.readingStatus,
            noteFindings: text(r.noteFindings, 500),
          }
        : referenceRow(r),
    ),
    tags: take(
      live(data.tags).filter((tag) => primaryTagIds.has(tag.id)),
      20,
    ).map((tag) => text(tag.name, 100)),
  };
  if (kind === 'workspace') {
    payload.dueTasks = take(
      allTasks.filter((t) => open(t) && t.dueDate && t.dueDate <= today),
      30,
    ).map(taskRow);
    payload.upcomingTasks = take(
      allTasks.filter((t) => open(t) && t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7)),
      20,
    ).map(taskRow);
  }
  const serialize = () => JSON.stringify({ ...payload, truncated });
  let serialized = serialize();
  // 缩小完整的结构节点，绝不在 JSON 字符串中间硬切。
  while (serialized.length > MAX_CONTEXT_CHARS) {
    const arrays = Object.entries(payload).filter(
      (entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && entry[1].length > 0,
    );
    const largest = arrays.sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
    if (!largest) break;
    largest[1].pop();
    truncated = true;
    serialized = serialize();
  }
  for (const limit of [900, 600, 300, 120]) {
    if (serialized.length <= MAX_CONTEXT_CHARS) break;
    // 单份极长的实验/笔记保留每一字段和目标 ID，均匀收短正文。
    const shrink = (value: unknown): unknown =>
      typeof value === 'string'
        ? value.length > limit
          ? value.slice(0, limit) + '…'
          : value
        : Array.isArray(value)
          ? value.map(shrink)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value).map(([key, item]) => [
                  key,
                  key === 'id' || key.endsWith('Id') ? item : shrink(item),
                ]),
              )
            : value;
    payload.record = shrink(payload.record);
    truncated = true;
    serialized = serialize();
  }
  return {
    text: serialized,
    label: record ? ('name' in record ? record.name : record.title || '未命名记录') : '我的工作区',
    kind,
    id: record?.id ?? null,
    record: record ?? null,
    counts,
    truncated,
  };
}
