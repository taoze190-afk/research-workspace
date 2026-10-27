import type { Dataset } from '@/domain/types';
import type { AiAttachment } from '@/lib/ai-attachments';
import type { ResearchContext } from './context';
import { isWorkflowId, recordHref, type WorkflowId } from './workflows';

export type SourceKind = 'project' | 'task' | 'experiment' | 'reference' | 'file' | 'milestone' | 'subtask';
export interface ResearchSource {
  kind: SourceKind;
  id: string;
  title: string;
  href: string;
  parentId?: string;
  updatedAt?: number;
}
export interface ResearchTrace {
  scope: string;
  label: string;
  workflow: WorkflowId;
  capturedAt: number;
  hash: string;
  sources: ResearchSource[];
  totalSources: number;
  truncated: boolean;
}
export function contextHash(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function captureResearchTrace(
  data: Dataset,
  context: ResearchContext,
  workflow: WorkflowId,
  attachments: AiAttachment[] = [],
  now = Date.now(),
): ResearchTrace {
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  const tables = {
    project: data.projects,
    task: data.tasks,
    experiment: data.experiments,
    reference: data.references,
    milestone: data.milestones,
    subtask: data.subtasks,
  };
  const add = (kind: SourceKind, id: unknown, title?: string) => {
    if (typeof id !== 'string' || !id || seen.has(kind + ':' + id)) return;
    const row = kind === 'file' ? null : tables[kind].find((r) => r.id === id && r.deletedAt === null);
    if (kind !== 'file' && !row) return;
    const parentId =
      kind === 'milestone' && row && 'projectId' in row
        ? row.projectId
        : kind === 'subtask' && row && 'taskId' in row
          ? row.taskId
          : undefined;
    const href = parentId
      ? recordHref(kind === 'milestone' ? 'project' : 'task', parentId)
      : kind === 'milestone' || kind === 'subtask'
        ? null
        : recordHref(kind, id);
    if (!href) return;
    seen.add(kind + ':' + id);
    sources.push({
      kind,
      id,
      title: (title || (row && ('name' in row ? row.name : row.title)) || '未命名记录').slice(0, 180),
      href,
      ...(parentId ? { parentId } : {}),
      ...(row ? { updatedAt: row.updatedAt } : {}),
    });
  };
  if (context.id) add(context.kind as SourceKind, context.id);
  attachments.forEach((file) => add('file', file.id, file.name));
  // 清单只认实际装入摘要的节点，不能把因预算省略的记录标作已经发送。
  if (context.text) {
    try {
      const payload = JSON.parse(context.text) as Record<string, unknown>;
      for (const [key, kind] of [
        ['projects', 'project'],
        ['tasks', 'task'],
        ['experiments', 'experiment'],
        ['references', 'reference'],
        ['milestones', 'milestone'],
        ['subtasks', 'subtask'],
      ] as const)
        if (Array.isArray(payload[key]))
          for (const row of payload[key]) if (row && typeof row === 'object') add(kind, (row as { id?: unknown }).id);
    } catch {
      /* 不是有效摘要时不补造来源 */
    }
  }
  return {
    scope: context.id ? context.kind + ':' + context.id : context.kind,
    label: context.label.slice(0, 180),
    workflow,
    capturedAt: now,
    hash: contextHash(context.text),
    sources: sources.slice(0, 20),
    totalSources: sources.length,
    truncated: context.truncated || sources.length > 20,
  };
}
/** 旧对话和不合法可选元数据不应使整段聊天丢失；只保留受控来源字段。 */
export function sanitizeResearchTrace(value: unknown): ResearchTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const t = value as ResearchTrace;
  if (
    typeof t.scope !== 'string' ||
    t.scope.length > 180 ||
    typeof t.label !== 'string' ||
    t.label.length > 180 ||
    !isWorkflowId(t.workflow) ||
    !Number.isFinite(t.capturedAt) ||
    typeof t.hash !== 'string' ||
    t.hash.length > 20 ||
    !Array.isArray(t.sources) ||
    t.sources.length > 20 ||
    !Number.isInteger(t.totalSources) ||
    t.totalSources < t.sources.length ||
    typeof t.truncated !== 'boolean'
  )
    return undefined;
  const sources: ResearchSource[] = [];
  for (const s of t.sources) {
    if (
      !s ||
      !['project', 'task', 'experiment', 'reference', 'file', 'milestone', 'subtask'].includes(s.kind) ||
      typeof s.id !== 'string' ||
      !s.id ||
      s.id.length > 100 ||
      typeof s.title !== 'string' ||
      s.title.length > 180
    )
      return undefined;
    const isChild = s.kind === 'milestone' || s.kind === 'subtask';
    if (isChild && (typeof s.parentId !== 'string' || !s.parentId || s.parentId.length > 100)) return undefined;
    const href = isChild
      ? recordHref(s.kind === 'milestone' ? 'project' : 'task', s.parentId!)
      : recordHref(s.kind, s.id);
    if (!href) return undefined;
    sources.push({
      kind: s.kind,
      id: s.id,
      title: s.title,
      href,
      ...(isChild ? { parentId: s.parentId } : {}),
      ...(Number.isFinite(s.updatedAt) ? { updatedAt: s.updatedAt } : {}),
    });
  }
  return {
    scope: t.scope,
    label: t.label,
    workflow: t.workflow,
    capturedAt: t.capturedAt,
    hash: t.hash,
    sources,
    totalSources: t.totalSources,
    truncated: t.truncated,
  };
}
