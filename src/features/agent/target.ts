import type { Dataset } from '@/domain/types';
import { buildResearchContext } from '@/features/ai/context';

export interface AgentTarget {
  kind: 'reference' | 'experiment' | 'project' | 'task' | 'workspace';
  id: string | null;
  label: string;
  /** 与工作室共用的、有准确记录 ID 的研究资料摘要。 */
  content: string;
}

/** 当前页面与工作室使用同一份上下文，列表页也可读取实际项目/任务索引。 */
export function resolveAgentTarget(pathname: string, search: string, data: Dataset): AgentTarget {
  const params = new URLSearchParams(search);
  const focus = params.get('focus');
  let scope = 'workspace';
  if (pathname.startsWith('/library') && focus) scope = `reference:${focus}`;
  else if (pathname.startsWith('/tasks') && focus) scope = `task:${focus}`;
  else if (pathname.startsWith('/ai') && params.has('scope')) scope = params.get('scope') || 'workspace';
  else {
    const match = /^\/(projects|experiments)\/([^/]+)$/.exec(pathname);
    if (match) scope = `${match[1] === 'projects' ? 'project' : 'experiment'}:${decodeURIComponent(match[2])}`;
  }
  const context = buildResearchContext(data, scope);
  // 保留 AgentTarget 契约；未附带或已失效的资料不能悄悄扩大成整个工作区。
  return {
    kind: context.kind === 'none' ? 'workspace' : context.kind,
    id: context.id,
    label: context.label,
    content: context.text,
  };
}
