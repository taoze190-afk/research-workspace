import { z } from 'zod';
import { SCHEMA_VERSION, db } from '@/data/db';
import type { Dataset } from '@/domain/types';
import { defaultPrefs, type Prefs } from './prefs';

const baseShape = {
  id: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.nullable(z.number()),
  isDemo: z.boolean().default(false),
};

const str = (fallback = '') => z.string().optional().transform((v) => v ?? fallback);
const nullableStr = z.nullable(z.string()).optional().transform((v) => v ?? null);
const numOrNull = z.nullable(z.number().int()).optional().transform((v) => v ?? null);

export const projectSchema = z.object({
  ...baseShape,
  name: z.string(),
  question: str(),
  goal: str(),
  status: z.enum(['planned', 'active', 'paused', 'completed', 'archived']),
  startDate: nullableStr,
  endDate: nullableStr,
  favorite: z.boolean().default(false),
});

export const milestoneSchema = z.object({
  ...baseShape,
  projectId: z.string(),
  title: z.string(),
  dueDate: nullableStr,
  done: z.boolean().default(false),
  sortOrder: z.number().default(0),
});

export const taskSchema = z.object({
  ...baseShape,
  title: z.string(),
  description: str(),
  status: z.enum(['todo', 'doing', 'done', 'cancelled']),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
  dueDate: nullableStr,
  projectId: nullableStr,
  sourceExperimentId: nullableStr,
  referenceId: nullableStr,
  completedAt: numOrNull,
  recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
});

export const subtaskSchema = z.object({
  ...baseShape,
  taskId: z.string(),
  title: z.string(),
  done: z.boolean().default(false),
  sortOrder: z.number().default(0),
});

export const dataSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['path', 'version', 'link', 'model', 'param', 'metric', 'other']),
  label: z.string(),
});

export const experimentSchema = z.object({
  ...baseShape,
  title: z.string(),
  experimentDate: z.string(),
  projectId: nullableStr,
  status: z.enum(['draft', 'active', 'done', 'failed']).default('draft'),
  purpose: str(),
  hypothesis: str(),
  dataSources: z.array(dataSourceSchema).default([]),
  method: str(),
  results: str(),
  observations: str(),
  conclusion: str(),
  nextStep: str(),
  repoUrl: str(),
  commit: str(),
  sourceExperimentId: nullableStr,
});

export const referenceSchema = z.object({
  ...baseShape,
  title: z.string(),
  authors: str(),
  year: numOrNull,
  venue: str(),
  doi: str(),
  url: str(),
  readingStatus: z.enum(['unread', 'reading', 'read']).default('unread'),
  favorite: z.boolean().default(false),
  noteQuestion: str(),
  noteMethod: str(),
  noteFindings: str(),
  noteLimits: str(),
  noteRelevance: str(),
});

export const tagSchema = z.object({ ...baseShape, name: z.string() });
export const entityTagSchema = z.object({
  ...baseShape,
  tagId: z.string(),
  entityType: z.enum(['project', 'task', 'experiment', 'reference']),
  entityId: z.string(),
});
export const projectReferenceSchema = z.object({ ...baseShape, projectId: z.string(), referenceId: z.string() });

const list = <S extends z.ZodTypeAny>(schema: S) => z.array(schema).default([]);

export const datasetSchema = z.object({
  projects: list(projectSchema),
  milestones: list(milestoneSchema),
  tasks: list(taskSchema),
  subtasks: list(subtaskSchema),
  experiments: list(experimentSchema),
  references: list(referenceSchema),
  tags: list(tagSchema),
  entityTags: list(entityTagSchema),
  projectReferences: list(projectReferenceSchema),
});

export const backupEnvelopeSchema = z.object({
  app: z.literal('research-workspace'),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  prefs: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  data: datasetSchema,
});

export type BackupFile = z.infer<typeof backupEnvelopeSchema>;

export const ATTACHMENT_NOTE =
  '备份包含记录的全部内容（含正文里粘贴的截图）。实验里手动填写的本地路径、数据版本与来源链接只是文字记录，不包含对应的外部文件。';

export function buildBackup(data: Dataset, prefs: Prefs = defaultPrefs): BackupFile {
  return {
    app: 'research-workspace',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    prefs: { ...prefs },
    note: ATTACHMENT_NOTE,
    data: structuredClone(data),
  };
}

export interface ParseResult {
  ok: boolean;
  file?: BackupFile;
  errors: string[];
  schemaVersion?: number;
}

export function parseBackupJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`文件不是合法 JSON：${(e as Error).message}`] };
  }
  if (raw === null || typeof raw !== 'object') return { ok: false, errors: ['文件顶层必须是对象'] };
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  // 老版本备份可以进（缺的字段按默认值补），比当前应用新的版本才拒绝
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    return {
      ok: false,
      schemaVersion: version,
      errors: [`不支持的数据版本 v${version}（当前应用写入与读取的都是 v${SCHEMA_VERSION}），已有数据库未做任何改动`],
    };
  }
  const parsed = backupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '顶层'}：${i.message}`);
    return { ok: false, schemaVersion: version as number | undefined, errors: issues.length ? issues : ['文件结构不符合备份格式'] };
  }
  return { ok: true, file: parsed.data, errors: [], schemaVersion: version as number | undefined };
}

export type ImportMode = 'merge' | 'replace';

export const TABLE_KEYS = [
  'projects',
  'milestones',
  'tasks',
  'subtasks',
  'experiments',
  'references',
  'tags',
  'entityTags',
  'projectReferences',
] as const;

export type TableKey = (typeof TABLE_KEYS)[number];

export interface ImportPlan {
  mode: ImportMode;
  incoming: Dataset;
  counts: Record<TableKey, number>;
  toAdd: number;
  toUpdate: number;
  unchanged: number;
  orphans: string[];
  detachWarnings: string[];
  duplicateIds: string[];
  blockers: string[];
  /** 合并后可解析的外键集合，写入阶段用它决定哪些引用要退回空值 */
  knownProjects: Set<string>;
  knownExperiments: Set<string>;
}

function dupIds(rows: { id: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) dup.add(r.id);
    seen.add(r.id);
  }
  return [...dup];
}

function idsOf(rows: unknown[]): Set<string> {
  return new Set(rows.map((r) => (r as { id: string }).id));
}

function liveIds(rows: unknown[]): Set<string> {
  return new Set(
    rows
      .filter((r) => (r as { deletedAt: number | null }).deletedAt === null)
      .map((r) => (r as { id: string }).id)
  );
}

/** 只读预演：不落库，产出差异统计与阻断性错误。 */
export function planImport(file: BackupFile, current: Dataset, mode: ImportMode): ImportPlan {
  const incoming = file.data;
  const plan: ImportPlan = {
    mode,
    incoming,
    counts: Object.fromEntries(TABLE_KEYS.map((k) => [k, incoming[k].length])) as Record<TableKey, number>,
    toAdd: 0,
    toUpdate: 0,
    unchanged: 0,
    orphans: [],
    detachWarnings: [],
    duplicateIds: [],
    blockers: [],
    knownProjects: new Set(),
    knownExperiments: new Set(),
  };

  for (const key of TABLE_KEYS) {
    const dup = dupIds(incoming[key] as { id: string }[]);
    if (dup.length) plan.duplicateIds.push(`${key}：${dup.length} 个重复 ID`);
  }
  if (plan.duplicateIds.length) {
    plan.blockers.push(`备份文件内部有重复 ID（${plan.duplicateIds.join('；')}），已拒绝导入以免覆盖已有记录`);
    return plan;
  }

  // replace 只看导入集，merge 看「现有 + 导入」的并集
  const union = (key: TableKey) => (mode === 'replace' ? idsOf(incoming[key]) : new Set([...idsOf(current[key]), ...idsOf(incoming[key])]));
  plan.knownProjects = union('projects');
  plan.knownExperiments = union('experiments');
  const knownTasks = union('tasks');
  const knownReferences = union('references');
  const knownTags = union('tags');

  for (const m of incoming.milestones) if (!plan.knownProjects.has(m.projectId)) plan.orphans.push(`里程碑 ${m.title || m.id} 指向的项目 ${m.projectId} 不存在`);
  for (const s of incoming.subtasks) if (!knownTasks.has(s.taskId)) plan.orphans.push(`子任务 ${s.id} 指向的任务 ${s.taskId} 不存在`);
  for (const l of incoming.projectReferences) {
    if (!plan.knownProjects.has(l.projectId)) plan.orphans.push(`文献关联 ${l.id} 指向的项目 ${l.projectId} 不存在`);
    if (!knownReferences.has(l.referenceId)) plan.orphans.push(`文献关联 ${l.id} 指向的条目 ${l.referenceId} 不存在`);
  }
  for (const et of incoming.entityTags) if (!knownTags.has(et.tagId)) plan.orphans.push(`标签关系 ${et.id} 指向的标签 ${et.tagId} 不存在`);

  const liveProjects = mode === 'replace' ? idsOf(incoming.projects) : new Set([...liveIds(current.projects), ...idsOf(incoming.projects)]);
  const liveExperiments = mode === 'replace' ? idsOf(incoming.experiments) : new Set([...liveIds(current.experiments), ...idsOf(incoming.experiments)]);

  for (const t of incoming.tasks) {
    if (t.projectId && !liveProjects.has(t.projectId)) plan.detachWarnings.push(`任务「${t.title || t.id}」的所属项目不在文件里，导入后退回未关联`);
    if (t.sourceExperimentId && !liveExperiments.has(t.sourceExperimentId)) plan.detachWarnings.push(`任务「${t.title || t.id}」的来源实验不在文件里，导入后清除来源标记`);
  }
  for (const e of incoming.experiments) {
    if (e.projectId && !liveProjects.has(e.projectId)) plan.detachWarnings.push(`实验「${e.title || e.id}」的所属项目不在文件里，导入后退回未关联`);
    if (e.sourceExperimentId && !liveExperiments.has(e.sourceExperimentId)) plan.detachWarnings.push(`实验「${e.title || e.id}」的复制来源不在文件里，导入后清除`);
  }

  if (plan.orphans.length) {
    plan.blockers.push(`关联完整性检查未通过（${plan.orphans.length} 处）：${plan.orphans.slice(0, 5).join('；')}`);
    return plan;
  }

  if (mode === 'merge') {
    for (const key of TABLE_KEYS) {
      const existing = new Map(current[key].map((r) => [(r as { id: string }).id, r as { updatedAt: number }]));
      for (const row of incoming[key]) {
        const before = existing.get(row.id);
        if (!before) plan.toAdd += 1;
        else if (row.updatedAt > before.updatedAt) plan.toUpdate += 1;
        else plan.unchanged += 1;
      }
    }
  } else {
    plan.toAdd = TABLE_KEYS.reduce((sum, k) => sum + incoming[k].length, 0);
  }

  return plan;
}

export interface ImportOutcome {
  added: number;
  updated: number;
  detached: number;
}

/** 退回空值而不是留下指向不存在实体的外键。 */
function sanitize(key: TableKey, rows: unknown[], plan: ImportPlan): { rows: unknown[]; detached: number } {
  if (key !== 'tasks' && key !== 'experiments') return { rows, detached: 0 };
  let detached = 0;
  const next = (rows as Record<string, unknown>[]).map((row) => {
    const out = { ...row };
    if (row.projectId && !plan.knownProjects.has(row.projectId as string)) {
      out.projectId = null;
      detached += 1;
    }
    if (row.sourceExperimentId && !plan.knownExperiments.has(row.sourceExperimentId as string)) {
      out.sourceExperimentId = null;
      detached += 1;
    }
    return out;
  });
  return { rows: next, detached };
}

/**
 * 一笔 Dexie 事务写完全部表；任何一步抛错整笔回滚，库里不会留下半套数据。
 */
export async function applyImport(file: BackupFile, plan: ImportPlan): Promise<ImportOutcome> {
  if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
  let added = 0;
  let updated = 0;
  let detached = 0;

  return db.transaction('rw', db.tables, async () => {
    if (plan.mode === 'replace') {
      for (const key of TABLE_KEYS) await db.table(key).clear();
      for (const key of TABLE_KEYS) {
        const clean = sanitize(key, file.data[key], plan);
        detached += clean.detached;
        await db.table(key).bulkAdd(clean.rows as never[]);
        added += clean.rows.length;
      }
      return { added, updated, detached };
    }

    for (const key of TABLE_KEYS) {
      const clean = sanitize(key, file.data[key], plan);
      detached += clean.detached;
      const existing = new Map((await db.table(key).toArray()).map((r) => [(r as { id: string }).id, r as { updatedAt: number }]));
      const toInsert: unknown[] = [];
      for (const row of clean.rows) {
        const before = existing.get((row as { id: string }).id);
        if (!before) {
          toInsert.push(row);
        } else if ((row as { updatedAt: number }).updatedAt > before.updatedAt) {
          await db.table(key).put(row as never);
          updated += 1;
        }
      }
      if (toInsert.length) await db.table(key).bulkAdd(toInsert as never[]);
      added += toInsert.length;
    }
    return { added, updated, detached };
  });
}

export function backupFileName(prefix = '研序备份'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分内核取消下载，留一点时间交给浏览器。
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
