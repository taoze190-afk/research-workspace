import { db } from '@/data/db';
import {
  addMilestone,
  addSubtask,
  createExperiment,
  createProject,
  createReference,
  createTask,
  linkReferenceProject,
  loadDataset,
  setTaskStatus,
  spawnNextTask,
  updateExperiment,
  updateProject,
  updateReference,
  updateTask,
} from '@/data/repo';
import {
  PRIORITIES,
  PROJECT_STATUSES,
  READING_STATUSES,
  TASK_STATUSES,
  EXPERIMENT_STATUSES,
  experimentStatusLabels,
  priorityLabels,
  projectStatusLabels,
  readingStatusLabels,
  taskStatusLabels,
  type Dataset,
  type Experiment,
  type Project,
  type Reference,
  type Task,
} from '@/domain/types';
import { isValidDateString, localToday } from '@/domain/date';
import { getSyncState, rememberedAccount } from '@/data/sync';

export interface AiAction {
  action: string;
  [key: string]: unknown;
}
export interface ActionContext {
  kind: string;
  id: string | null;
}
export interface ActionResult {
  ok: boolean;
  message: string;
  href?: string;
  errorCode?: 'validation' | 'not_found' | 'ambiguous' | 'conflict' | 'storage' | 'unsupported' | 'rolled_back';
}
export interface ActionChange {
  label: string;
  before?: string;
  after: string;
}
export interface ActionPreview {
  valid: boolean;
  title: string;
  target: string;
  changes: ActionChange[];
  warnings: string[];
  error?: string;
}
export interface ActionBatchResult extends ActionResult {
  results: ActionResult[];
}

export const MAX_AI_BATCH_ITEMS = 12;
export const MAX_AI_ACTIONS = 12;
export const SUPPORTED_ACTIONS = [
  'create_project',
  'update_project',
  'create_task',
  'create_tasks',
  'update_task',
  'create_milestones',
  'add_subtasks',
  'create_experiment',
  'update_experiment',
  'create_reference',
  'write_reference_note',
  'set_reading_status',
  'set_experiment_status',
  'link_reference_project',
] as const;

class ActionError extends Error {
  constructor(
    message: string,
    readonly code: ActionResult['errorCode'] = 'validation',
  ) {
    super(message);
  }
}
const fail = (message: string, code?: ActionResult['errorCode']): never => {
  throw new ActionError(message, code);
};
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown, label = '操作'): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) fail(`不支持的字段：${extra.join('、')}`);
};
const text = (value: unknown, label: string, max = 20000, required = false): string => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail(`${label}必须是文字`);
  const result = (value as string).trim();
  if (required && !result) fail(`${label}不能为空`);
  if (result.length > max) fail(`${label}不能超过 ${max} 个字符`);
  return result;
};
const date = (value: unknown, label = '日期'): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isValidDateString(value)) fail(`${label}必须是有效的 YYYY-MM-DD 日期`);
  return value as string;
};
const enumValue = <T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}不合法`);
  return value as T;
};
const list = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length === 0) fail(`${label}不能为空`);
  if ((value as unknown[]).length > MAX_AI_BATCH_ITEMS) fail(`${label}最多 ${MAX_AI_BATCH_ITEMS} 项`);
  return value as unknown[];
};
const safeUrl = (value: unknown): string => {
  const result = text(value, '文献链接', 2048);
  if (!result) return '';
  try {
    const url = new URL(result);
    if (!['http:', 'https:'].includes(url.protocol)) fail('文献链接只支持 http 或 https');
  } catch (error) {
    if (error instanceof ActionError) throw error;
    fail('文献链接必须是完整的网址');
  }
  return result;
};
const live = <T extends { id: string; deletedAt: number | null }>(rows: T[], id: string, label: string): T => {
  const row = rows.find((row) => row.id === id && row.deletedAt === null);
  return row ?? fail(`${label}不存在、已删除或不属于当前账号`, 'not_found');
};
function projectFor(
  action: Record<string, unknown>,
  data: Dataset,
  context: ActionContext,
  required = false,
): Project | null {
  if (own(action, 'projectId')) {
    if (action.projectId === null && !required) return null;
    const project = live(data.projects, text(action.projectId, '项目 ID', 100, true), '目标项目');
    if (context.kind === 'project' && context.id && project.id !== context.id)
      fail('不能修改所选项目范围之外的记录', 'conflict');
    return project;
  }
  if (context.kind === 'project' && context.id) return live(data.projects, context.id, '当前项目');
  if (required) fail('请先选择项目，或指定项目 ID');
  return null;
}
function taskFor(action: Record<string, unknown>, data: Dataset, context: ActionContext): Task {
  const project = projectFor(action, data, context);
  if (own(action, 'taskId')) {
    const task = live(data.tasks, text(action.taskId, '任务 ID', 100, true), '目标任务');
    if (context.kind === 'task' && context.id && task.id !== context.id) fail('目标任务不是当前所选任务', 'conflict');
    if (context.kind === 'project' && context.id && task.projectId !== context.id)
      fail('目标任务不在所选项目中', 'conflict');
    if (project && task.projectId !== project.id) fail('目标任务不在所选项目中', 'conflict');
    return task;
  }
  if (context.kind === 'task' && context.id) return live(data.tasks, context.id, '当前任务');
  // 旧提示词可能只输出标题；只在已选项目范围内接受恰好唯一的结果。
  const title = text(action.taskTitle, '任务标题', 240);
  if (!project || !title) fail('请指定任务 ID，或在选中项目中提供唯一任务标题');
  const pool = data.tasks.filter((row) => row.deletedAt === null && row.projectId === project!.id);
  const exact = pool.filter((row) => row.title === title);
  const matches = exact.length ? exact : pool.filter((row) => row.title.includes(title));
  if (matches.length !== 1)
    fail(
      matches.length ? '找到多项同名任务，请指定任务 ID' : '当前项目中没有找到该任务',
      matches.length ? 'ambiguous' : 'not_found',
    );
  return matches[0];
}
function experimentFor(action: Record<string, unknown>, data: Dataset, context: ActionContext): Experiment {
  const id = own(action, 'experimentId')
    ? text(action.experimentId, '实验 ID', 100, true)
    : context.kind === 'experiment'
      ? context.id
      : null;
  if (!id) fail('请先选择实验记录，或指定实验 ID');
  const row = live(data.experiments, id as string, '目标实验');
  if (context.kind === 'experiment' && context.id && row.id !== context.id)
    fail('目标实验不是当前所选实验', 'conflict');
  if (context.kind === 'project' && context.id && row.projectId !== context.id)
    fail('目标实验不在所选项目中', 'conflict');
  return row;
}
function referenceFor(action: Record<string, unknown>, data: Dataset, context: ActionContext): Reference {
  const id = own(action, 'referenceId')
    ? text(action.referenceId, '文献 ID', 100, true)
    : context.kind === 'reference'
      ? context.id
      : null;
  if (!id) fail('请先选择文献，或指定文献 ID');
  const row = live(data.references, id as string, '目标文献');
  if (context.kind === 'reference' && context.id && row.id !== context.id) fail('目标文献不是当前所选文献', 'conflict');
  if (
    context.kind === 'project' &&
    context.id &&
    !data.projectReferences.some(
      (link) => link.deletedAt === null && link.projectId === context.id && link.referenceId === row.id,
    )
  )
    fail('目标文献未关联所选项目', 'conflict');
  return row;
}
const namedFields: Record<string, string> = {
  name: '项目名称',
  question: '研究问题',
  goal: '研究目标',
  status: '状态',
  startDate: '开始日期',
  endDate: '截止日期',
  title: '标题',
  description: '说明',
  priority: '优先级',
  dueDate: '截止日期',
  purpose: '研究目的',
  hypothesis: '假设',
  method: '方法与步骤',
  results: '结果',
  observations: '观察与异常',
  conclusion: '结论',
  nextStep: '下一步',
  noteQuestion: '研究问题',
  noteMethod: '研究方法',
  noteFindings: '主要结论',
  noteLimits: '局限',
  noteRelevance: '与研究的关联',
  readingStatus: '阅读状态',
};
const format = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '未填写';
  if (key === 'status')
    return (
      { ...projectStatusLabels, ...taskStatusLabels, ...experimentStatusLabels }[
        String(value) as keyof typeof taskStatusLabels
      ] ?? String(value)
    );
  if (key === 'priority') return priorityLabels[String(value) as keyof typeof priorityLabels] ?? String(value);
  if (key === 'readingStatus')
    return readingStatusLabels[String(value) as keyof typeof readingStatusLabels] ?? String(value);
  return String(value);
};
const changesFor = (after: Record<string, unknown>, before?: object): ActionChange[] =>
  Object.entries(after).map(([key, value]) => ({
    label: namedFields[key] ?? key,
    ...(before ? { before: format(key, (before as Record<string, unknown>)[key]) } : {}),
    after: format(key, value),
  }));
interface Plan extends ActionPreview {
  apply: () => Promise<ActionResult>;
}
const plan = (
  title: string,
  target: string,
  changes: ActionChange[],
  apply: Plan['apply'],
  warnings: string[] = [],
): Plan => ({ valid: true, title, target, changes, warnings, apply });

function compileAction(raw: AiAction, data: Dataset, context: ActionContext): Plan {
  const action = object(raw);
  const kind = text(action.action, '操作类型', 80, true);
  switch (kind) {
    case 'create_project': {
      keys(action, ['action', 'name', 'question', 'goal', 'status', 'startDate', 'endDate']);
      const fields = {
        name: text(action.name, '项目名称', 240, true),
        question: text(action.question, '研究问题'),
        goal: text(action.goal, '研究目标'),
        status: enumValue(action.status, PROJECT_STATUSES, '项目状态', 'planned'),
        startDate: date(action.startDate),
        endDate: date(action.endDate),
      };
      if (fields.startDate && fields.endDate && fields.startDate > fields.endDate) fail('截止日期不能早于开始日期');
      return plan('新建项目', fields.name, changesFor(fields), async () => {
        const row = await createProject(fields);
        return { ok: true, message: `已创建项目「${row.name}」`, href: `/projects/${row.id}` };
      });
    }
    case 'update_project': {
      keys(action, ['action', 'projectId', 'changes']);
      const project = projectFor(action, data, context, true)!;
      const input = object(action.changes, '项目修改');
      keys(input, ['name', 'question', 'goal', 'status', 'startDate', 'endDate']);
      if (!Object.keys(input).length) fail('没有需要修改的项目字段');
      const fields: Partial<Project> = {};
      for (const key of ['name', 'question', 'goal'] as const)
        if (own(input, key))
          fields[key] = text(input[key], namedFields[key], key === 'name' ? 240 : 20000, key === 'name');
      if (own(input, 'status')) fields.status = enumValue(input.status, PROJECT_STATUSES, '项目状态');
      for (const key of ['startDate', 'endDate'] as const) if (own(input, key)) fields[key] = date(input[key]);
      const after = { ...project, ...fields };
      if (after.startDate && after.endDate && after.startDate > after.endDate) fail('截止日期不能早于开始日期');
      return plan('修改项目', project.name, changesFor(fields, project), async () => {
        await updateProject(project.id, fields);
        return { ok: true, message: `已更新项目「${project.name}」`, href: `/projects/${project.id}` };
      });
    }
    case 'create_task':
    case 'create_tasks': {
      keys(
        action,
        kind === 'create_task'
          ? ['action', 'title', 'description', 'priority', 'dueDate', 'projectId', 'status']
          : ['action', 'items', 'projectId'],
      );
      const project = projectFor(action, data, context);
      const sourceExperiment =
        context.kind === 'experiment' && context.id ? live(data.experiments, context.id, '当前实验') : null;
      const sourceReference =
        context.kind === 'reference' && context.id ? live(data.references, context.id, '当前文献') : null;
      const sourceTask = context.kind === 'task' && context.id ? live(data.tasks, context.id, '当前任务') : null;
      const items = (kind === 'create_task' ? [action] : list(action.items, '任务列表')).map((value) => {
        const item = object(value, '任务');
        if (kind !== 'create_task') keys(item, ['title', 'description', 'priority', 'dueDate', 'status']);
        return {
          title: text(item.title, '任务标题', 240, true),
          description: text(item.description, '任务说明'),
          priority: enumValue(item.priority, PRIORITIES, '任务优先级', 'medium'),
          dueDate: date(item.dueDate),
          status: enumValue(item.status, TASK_STATUSES, '任务状态', 'todo'),
          projectId: own(action, 'projectId')
            ? (project?.id ?? null)
            : (project?.id ?? sourceExperiment?.projectId ?? sourceTask?.projectId ?? null),
          sourceExperimentId: sourceExperiment?.id ?? null,
          referenceId: sourceReference?.id ?? null,
        };
      });
      return plan(
        kind === 'create_task' ? '新建任务' : `新建 ${items.length} 项任务`,
        project?.name ?? sourceExperiment?.title ?? sourceReference?.title ?? sourceTask?.title ?? '未关联任务',
        items.flatMap((item, i) =>
          changesFor({
            title: item.title,
            description: item.description,
            priority: item.priority,
            dueDate: item.dueDate,
            status: item.status,
          }).map((change) => ({ ...change, label: items.length > 1 ? `${i + 1}. ${change.label}` : change.label })),
        ),
        async () => {
          const rows = [];
          for (const item of items) rows.push(await createTask(item));
          return {
            ok: true,
            message: items.length === 1 ? `已创建任务「${rows[0].title}」` : `已创建 ${items.length} 项任务`,
            href:
              items.length === 1
                ? `/tasks?focus=${rows[0].id}`
                : project
                  ? `/tasks?filter=all&project=${project.id}`
                  : '/tasks?filter=all',
          };
        },
      );
    }
    case 'update_task': {
      keys(action, [
        'action',
        'taskId',
        'taskTitle',
        'projectId',
        'changes',
        'title',
        'description',
        'status',
        'priority',
        'dueDate',
      ]);
      const task = taskFor(action, data, context);
      const editable = ['title', 'description', 'status', 'priority', 'dueDate'];
      if (own(action, 'changes') && editable.some((key) => own(action, key)))
        fail('请将任务修改放在 changes 中，不要与顶层字段混用');
      const input = own(action, 'changes')
        ? object(action.changes, '任务修改')
        : Object.fromEntries(editable.filter((key) => own(action, key)).map((key) => [key, action[key]]));
      keys(input, editable);
      if (!Object.keys(input).length) fail('没有需要修改的任务字段');
      const fields: Partial<Task> = {};
      if (own(input, 'title')) fields.title = text(input.title, '任务标题', 240, true);
      if (own(input, 'description')) fields.description = text(input.description, '任务说明');
      if (own(input, 'status')) fields.status = enumValue(input.status, TASK_STATUSES, '任务状态');
      if (own(input, 'priority')) fields.priority = enumValue(input.priority, PRIORITIES, '任务优先级');
      if (own(input, 'dueDate')) fields.dueDate = date(input.dueDate);
      const spawn = fields.status === 'done' && task.status !== 'done' && task.recurrence !== 'none';
      return plan(
        '修改任务',
        task.title,
        changesFor(fields, task),
        async () => {
          const { status, ...rest } = fields;
          if (Object.keys(rest).length) await updateTask(task.id, rest);
          if (status) await setTaskStatus(task.id, status);
          if (spawn) await spawnNextTask({ ...task, ...fields });
          return { ok: true, message: `已更新任务「${fields.title ?? task.title}」`, href: `/tasks?focus=${task.id}` };
        },
        spawn ? ['完成后将按原有重复规则创建下一期任务'] : [],
      );
    }
    case 'create_milestones': {
      keys(action, ['action', 'projectId', 'items']);
      const project = projectFor(action, data, context, true)!;
      const items = list(action.items, '里程碑列表').map((value) => {
        const item = object(value, '里程碑');
        keys(item, ['title', 'dueDate']);
        return { title: text(item.title, '里程碑标题', 240, true), dueDate: date(item.dueDate) };
      });
      return plan(
        `新建 ${items.length} 个里程碑`,
        project.name,
        items.map((item) => ({ label: item.title, after: item.dueDate ?? '未设日期' })),
        async () => {
          for (const item of items) await addMilestone({ ...item, projectId: project.id });
          return { ok: true, message: `已创建 ${items.length} 个里程碑`, href: `/projects/${project.id}` };
        },
      );
    }
    case 'add_subtasks': {
      keys(action, ['action', 'taskId', 'taskTitle', 'projectId', 'items']);
      const task = taskFor(action, data, context);
      const items = list(action.items, '子任务列表').map((value) => text(value, '子任务标题', 240, true));
      return plan(
        `添加 ${items.length} 项子任务`,
        task.title,
        items.map((title) => ({ label: '子任务', after: title })),
        async () => {
          for (const title of items) await addSubtask(task.id, title);
          return {
            ok: true,
            message: `已给「${task.title}」添加 ${items.length} 项子任务`,
            href: `/tasks?focus=${task.id}`,
          };
        },
      );
    }
    case 'create_experiment': {
      const fieldsAllowed = [
        'title',
        'purpose',
        'hypothesis',
        'method',
        'results',
        'observations',
        'conclusion',
        'nextStep',
      ];
      keys(action, ['action', 'projectId', 'experimentDate', ...fieldsAllowed]);
      const project = projectFor(action, data, context);
      const fields = Object.fromEntries(
        fieldsAllowed.map((key) => [
          key,
          text(action[key], namedFields[key], key === 'title' ? 240 : 20000, key === 'title'),
        ]),
      ) as Pick<
        Experiment,
        'title' | 'purpose' | 'hypothesis' | 'method' | 'results' | 'observations' | 'conclusion' | 'nextStep'
      >;
      const experimentDate = date(action.experimentDate, '实验日期') ?? localToday();
      return plan('新建实验', project?.name ?? '未关联实验', changesFor(fields), async () => {
        const row = await createExperiment({ ...fields, experimentDate, projectId: project?.id ?? null });
        return { ok: true, message: `已创建实验「${row.title}」`, href: `/experiments/${row.id}` };
      });
    }
    case 'update_experiment': {
      keys(action, ['action', 'experimentId', 'field', 'value']);
      const experiment = experimentFor(action, data, context);
      const field = enumValue(
        action.field,
        ['purpose', 'hypothesis', 'method', 'results', 'observations', 'conclusion', 'nextStep'] as const,
        '实验字段',
      );
      const value = text(action.value, '追加内容', 20000, true);
      const before = experiment[field].trim();
      const merged = before ? `${before}\n${value}` : value;
      if (merged.length > 50000) fail('追加后的实验内容不能超过 50000 个字符');
      return plan(
        '追加实验记录',
        experiment.title || '未命名实验',
        [{ label: namedFields[field], before: before || '未填写', after: merged }],
        async () => {
          await updateExperiment(experiment.id, { [field]: merged });
          return {
            ok: true,
            message: `已追加到实验的「${namedFields[field]}」`,
            href: `/experiments/${experiment.id}`,
          };
        },
        before ? ['在已有内容后追加，不替换原文'] : [],
      );
    }
    case 'create_reference': {
      keys(action, ['action', 'title', 'authors', 'year', 'venue', 'doi', 'url', 'projectId', 'readingStatus']);
      const project = projectFor(action, data, context);
      const year = action.year === undefined || action.year === null ? null : action.year;
      if (
        year !== null &&
        (typeof year !== 'number' || !Number.isInteger(year) || year < 1000 || year > new Date().getFullYear() + 2)
      )
        fail('文献年份不合法');
      const fields = {
        title: text(action.title, '文献标题', 500, true),
        authors: text(action.authors, '作者', 2000),
        year: year as number | null,
        venue: text(action.venue, '出版来源', 1000),
        doi: text(action.doi, 'DOI', 300),
        url: safeUrl(action.url),
        readingStatus: enumValue(action.readingStatus, READING_STATUSES, '阅读状态', 'unread'),
      };
      const normalizedDoi = fields.doi
        .toLowerCase()
        .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
        .replace(/^doi:\s*/, '');
      if (normalizedDoi && !/^10\.\d{4,9}\/\S+$/i.test(normalizedDoi)) fail('DOI 格式不正确');
      if (
        normalizedDoi &&
        data.references.some(
          (row) =>
            row.deletedAt === null &&
            row.doi
              .toLowerCase()
              .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
              .replace(/^doi:\s*/, '') === normalizedDoi,
        )
      )
        fail('该 DOI 已存在，请打开已有文献', 'conflict');
      fields.doi = normalizedDoi;
      return plan(
        '新建文献',
        project?.name ?? '文献库',
        [
          { label: '文献标题', after: fields.title },
          { label: '作者', after: fields.authors || '未填写' },
          { label: '来源', after: fields.doi || fields.url || '未填写' },
          { label: '阅读状态', after: readingStatusLabels[fields.readingStatus] },
        ],
        async () => {
          const row = await createReference(fields);
          if (project) await linkReferenceProject(row.id, project.id);
          return { ok: true, message: `已收录文献「${row.title}」`, href: `/library?focus=${row.id}` };
        },
        fields.doi || fields.url ? [] : ['尚未填写 DOI 或来源链接'],
      );
    }
    case 'set_reading_status': {
      keys(action, ['action', 'referenceId', 'readingStatus']);
      const reference = referenceFor(action, data, context);
      const readingStatus = enumValue(action.readingStatus, READING_STATUSES, '阅读状态');
      return plan('更新阅读状态', reference.title, changesFor({ readingStatus }, reference), async () => {
        await updateReference(reference.id, { readingStatus });
        return {
          ok: true,
          message: '文献已标记为' + readingStatusLabels[readingStatus],
          href: '/library?focus=' + reference.id,
        };
      });
    }
    case 'set_experiment_status': {
      keys(action, ['action', 'experimentId', 'status']);
      const experiment = experimentFor(action, data, context);
      const status = enumValue(action.status, EXPERIMENT_STATUSES, '实验状态');
      return plan('更新实验状态', experiment.title || '未命名实验', changesFor({ status }, experiment), async () => {
        await updateExperiment(experiment.id, { status });
        return {
          ok: true,
          message: '实验已标记为' + experimentStatusLabels[status],
          href: '/experiments/' + experiment.id,
        };
      });
    }
    case 'link_reference_project': {
      keys(action, ['action', 'referenceId', 'projectId']);
      const project = projectFor(action, data, context, true)!;
      const id = own(action, 'referenceId')
        ? text(action.referenceId, '文献 ID', 100, true)
        : context.kind === 'reference'
          ? context.id
          : null;
      if (!id) fail('请指定需要关联的文献 ID');
      if (context.kind === 'reference' && context.id && id !== context.id) fail('目标文献不是当前所选文献', 'conflict');
      const reference = live(data.references, id as string, '目标文献');
      const linked = data.projectReferences.some(
        (row) => row.deletedAt === null && row.projectId === project.id && row.referenceId === reference.id,
      );
      return plan(
        '关联已有文献',
        reference.title,
        [{ label: '关联项目', before: linked ? project.name + '（已关联）' : '尚未关联此项目', after: project.name }],
        async () => {
          await linkReferenceProject(reference.id, project.id);
          return {
            ok: true,
            message: '已将文献关联到「' + project.name + '」',
            href: '/projects/' + project.id + '?tab=library',
          };
        },
      );
    }
    case 'write_reference_note': {
      keys(action, ['action', 'referenceId', 'field', 'value', 'mode']);
      const reference = referenceFor(action, data, context);
      const field = enumValue(
        action.field,
        ['noteQuestion', 'noteMethod', 'noteFindings', 'noteLimits', 'noteRelevance'] as const,
        '笔记字段',
      );
      const value = text(action.value, '笔记内容', 20000, true);
      const mode = enumValue(action.mode, ['fill', 'append'] as const, '笔记写入方式', 'fill');
      const before = reference[field].trim();
      if (before && mode !== 'append') fail('该笔记已有内容。请使用追加方式，原文不会被覆盖', 'conflict');
      const merged = before ? `${before}\n${value}` : value;
      if (merged.length > 50000) fail('追加后的笔记不能超过 50000 个字符');
      return plan(
        mode === 'append' ? '追加文献笔记' : '填写文献笔记',
        reference.title || '未命名文献',
        [{ label: namedFields[field], before: before || '未填写', after: merged }],
        async () => {
          await updateReference(reference.id, { [field]: merged });
          return { ok: true, message: `已${before ? '追加' : '填入'}文献笔记`, href: `/library?focus=${reference.id}` };
        },
        before ? ['在已有内容后追加，不替换原文'] : [],
      );
    }
    default:
      return fail(`不支持的操作：${kind}`, 'unsupported');
  }
}

/** 预览使用界面数据；执行时再次在事务内检查最新数据，预览不能绕过校验。 */
export function previewAiAction(action: AiAction, data: Dataset, context: ActionContext): ActionPreview {
  try {
    const { apply: _apply, ...preview } = compileAction(action, data, context);
    return preview;
  } catch (error) {
    return {
      valid: false,
      title: describeAction(action),
      target: '',
      changes: [],
      warnings: [],
      error: (error as Error).message,
    };
  }
}

/** 整批在现有 repository 上执行；任一项失败则整体回滚，回滚不会进入同步队列。 */
const completed = new WeakMap<AiAction, { key: string; result: ActionResult }>();
const ownerKey = () => (getSyncState().mode === 'server' ? rememberedAccount() : 'local');
async function runAtomicActions(actions: AiAction[], context: ActionContext): Promise<ActionBatchResult> {
  if (!Array.isArray(actions) || !actions.length || actions.length > MAX_AI_ACTIONS) {
    const message = `一次操作需包含 1–${MAX_AI_ACTIONS} 项`;
    return { ok: false, message, errorCode: 'validation', results: [] };
  }
  const results: ActionResult[] = [];
  const owner = ownerKey();
  const key = `${owner}:${context.kind}:${context.id ?? ''}`;
  const applied: { action: AiAction; result: ActionResult }[] = [];
  let index = 0;
  try {
    await db.transaction('rw', db.tables, async () => {
      for (index = 0; index < actions.length; index++) {
        if (ownerKey() !== owner) fail('账号已切换，本次操作没有保存', 'conflict');
        const previous = completed.get(actions[index]);
        if (previous?.key === key) {
          results.push(previous.result);
          continue;
        }
        const fresh = await loadDataset();
        const compiled = compileAction(actions[index], fresh, context);
        const result = await compiled.apply();
        results.push(result);
        applied.push({ action: actions[index], result });
      }
      if (ownerKey() !== owner) fail('账号已切换，本次操作没有保存', 'conflict');
    });
    for (const item of applied) completed.set(item.action, { key, result: item.result });
    return {
      ok: true,
      message: actions.length === 1 ? results[0].message : `已执行 ${actions.length} 项操作`,
      href: results.at(-1)?.href,
      results,
    };
  } catch (error) {
    const issue =
      error instanceof ActionError ? error : new ActionError('保存失败，请重试。此次操作没有保存任何改动。', 'storage');
    return {
      ok: false,
      message: issue.message,
      errorCode: issue.code,
      results: actions.map((action, i) => {
        const previous = completed.get(action);
        if (previous?.key === key) return previous.result;
        return {
          ok: false,
          message: i === index ? issue.message : i < index ? '本批操作已回滚，尚未保存' : '本批操作未执行',
          errorCode: i === index ? issue.code : 'rolled_back',
        };
      }),
    };
  }
}

const executing = new WeakMap<AiAction, { key: string; actions: AiAction[]; promise: Promise<ActionBatchResult> }>();
/** 同一张提议卡的并发点击复用同一个执行结果；不同批次重叠时拒绝重复保存。 */
export function executeAiActions(
  actions: AiAction[],
  _data: Dataset,
  context: ActionContext,
): Promise<ActionBatchResult> {
  const invalid = (message: string): ActionBatchResult => ({
    ok: false,
    message,
    errorCode: 'validation',
    results: Array.isArray(actions) ? actions.map(() => ({ ok: false, message, errorCode: 'validation' })) : [],
  });
  if (!Array.isArray(actions) || !actions.length || actions.length > MAX_AI_ACTIONS)
    return Promise.resolve(invalid(`一次操作需包含 1–${MAX_AI_ACTIONS} 项`));
  if (actions.some((action) => !action || typeof action !== 'object' || Array.isArray(action)))
    return Promise.resolve(invalid('操作格式不正确'));
  const owner = ownerKey();
  if (getSyncState().mode === 'server' && !owner) return Promise.resolve(invalid('请登录后再执行操作'));
  const key = `${owner}:${context.kind}:${context.id ?? ''}`;
  const existing = actions.map((action) => executing.get(action)).find(Boolean);
  if (existing) {
    if (
      existing.key === key &&
      existing.actions.length === actions.length &&
      existing.actions.every((action, index) => action === actions[index])
    )
      return existing.promise;
    return Promise.resolve(invalid('其中一项操作正在执行，请稍后再试'));
  }
  const promise = runAtomicActions(actions, context).finally(() => {
    for (const action of actions) if (executing.get(action)?.promise === promise) executing.delete(action);
  });
  const lock = { key, actions: [...actions], promise };
  for (const action of actions) executing.set(action, lock);
  return promise;
}

/** 兼容旧调用方，忽略其旧快照，始终在事务内读取当前账号镜像。 */
export async function executeAiAction(action: AiAction, data: Dataset, context: ActionContext): Promise<ActionResult> {
  const result = await executeAiActions([action], data, context);
  return result.ok
    ? (result.results[0] ?? result)
    : { ok: false, message: result.message, errorCode: result.errorCode };
}

const brief = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export function describeAction(action: AiAction): string {
  if (!action || typeof action !== 'object') return '无效操作';
  switch (action.action) {
    case 'create_project':
      return `新建项目「${brief(action.name) || '未命名'}」`;
    case 'update_project':
      return '修改项目';
    case 'create_task':
      return `新建任务「${brief(action.title) || '未命名'}」`;
    case 'create_tasks':
      return `批量新建 ${Array.isArray(action.items) ? action.items.length : 0} 条任务`;
    case 'update_task':
      return '修改任务';
    case 'create_milestones':
      return `新建 ${Array.isArray(action.items) ? action.items.length : 0} 条里程碑`;
    case 'add_subtasks':
      return `添加 ${Array.isArray(action.items) ? action.items.length : 0} 条子任务`;
    case 'create_experiment':
      return `新建实验「${brief(action.title) || '未命名'}」`;
    case 'update_experiment':
      return `追加实验的${namedFields[brief(action.field)] ?? '记录'}`;
    case 'create_reference':
      return `收录文献「${brief(action.title) || '未命名'}」`;
    case 'write_reference_note':
      return `填写文献笔记（${namedFields[brief(action.field)] ?? '未知字段'}）`;
    case 'set_reading_status':
      return '更新文献阅读状态';
    case 'set_experiment_status':
      return '更新实验状态';
    case 'link_reference_project':
      return '关联已有文献到项目';
    default:
      return '无法识别的操作';
  }
}
