import type { ResearchContextKind } from './context';

export const WORKFLOW_IDS = [
  'general',
  'next-steps',
  'progress-review',
  'task-breakdown',
  'experiment-plan',
  'experiment-review',
  'reference-note',
  'file-analysis',
] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];
export interface ResearchWorkflow {
  id: WorkflowId;
  title: string;
  output: string;
  icon: 'tasks' | 'project' | 'experiment' | 'reference' | 'files' | 'sparkles';
  prompt: string;
  instructions: string;
}
export const WORKFLOWS: Record<WorkflowId, ResearchWorkflow> = {
  general: {
    id: 'general',
    title: '自由协作',
    output: '围绕当前问题讨论',
    icon: 'sparkles',
    prompt: '请根据当前提供的资料协助我明确问题和下一步；没有依据的内容请直接说明。',
    instructions: '围绕用户的具体问题工作，不因选择工作流就擅自变更记录。',
  },
  'next-steps': {
    id: 'next-steps',
    title: '安排下一步',
    output: '任务与里程碑',
    icon: 'tasks',
    prompt:
      '根据当前资料，找出最值得推进的下一步。避免重复已有任务，为明确可执行的事项生成任务或里程碑建议，并说明验收标准。',
    instructions:
      '工作目标是把现有研究转为可执行事项。沿用当前项目和来源关联；不要重建已有任务。缺少研究目标或日期约束时询问，不猜测。',
  },
  'progress-review': {
    id: 'progress-review',
    title: '检查进度',
    output: '风险与优先级',
    icon: 'project',
    prompt:
      '检查当前资料中的任务、里程碑、实验和阅读进度，指出逾期、阻塞及缺少的证据。只为明确需要的调整生成操作建议。',
    instructions:
      '工作目标是检查真实进度。区分已完成、进行中与尚无记录，不把缺失记录认作已完成；对建议修改给出具体目标和理由。',
  },
  'task-breakdown': {
    id: 'task-breakdown',
    title: '拆分任务',
    output: '步骤与验收标准',
    icon: 'tasks',
    prompt:
      '读取这条任务的说明、状态、日期和已有子任务，拆成可执行步骤，补充依赖与验收标准；优先添加子任务，不重复已有步骤。',
    instructions:
      '围绕当前任务拆分执行。修改当前任务或添加其子任务；需要独立后续任务时沿用项目，说明它与当前任务的关系。',
  },
  'experiment-plan': {
    id: 'experiment-plan',
    title: '规划实验',
    output: '可编辑实验草稿',
    icon: 'experiment',
    prompt:
      '基于当前研究问题和已有证据，规划下一次实验，区分已知条件和待确认假设，明确对照、指标与完成标准，生成可编辑实验草稿建议。不要编造实验结果。',
    instructions: '工作目标是设计尚未执行的实验。新实验只写目的、假设、方法和下一步，不虚构结果、观察或结论。',
  },
  'experiment-review': {
    id: 'experiment-review',
    title: '实验复盘',
    output: '追加记录与后续任务',
    icon: 'experiment',
    prompt:
      '读取这条实验的目的、方法、数据来源和结果，区分观察与推断，梳理异常、局限和下一次验证步骤。建议可追加到原实验或转成后续任务，不覆盖已有记录。',
    instructions:
      '工作目标是复盘实际实验。明确区分原始观察、解释和待验证假设；引用实验字段。正文只追加，后续任务保留实验来源。只有用户明确要求时才调整实验状态。',
  },
  'reference-note': {
    id: 'reference-note',
    title: '整理笔记',
    output: '文献笔记与阅读任务',
    icon: 'reference',
    prompt:
      '根据这篇文献已有资料、笔记和明确附带的文件，整理研究问题、方法、主要结论、局限及与课题的关联。只使用已有事实，可追加笔记、安排阅读任务或关联已有项目，不重复收录文献。',
    instructions:
      '工作目标是把已有文献转成研究积累。不能凭标题补造原文结论。已有笔记用追加，关联项目复用原文献；只有用户明确要求时才标记已读。',
  },
  'file-analysis': {
    id: 'file-analysis',
    title: '分析资料',
    output: '原件摘要与记录建议',
    icon: 'files',
    prompt:
      '分析明确附带的科研文件，引用准确文件名。多份资料请比较一致结论、分歧和证据缺口，再结合当前研究范围提出可保存的记录建议；未附带或未能读取的文件不要假装已经读过。',
    instructions:
      '工作目标是分析用户明确附带的文件。文件目录和元数据不代表正文；无法读取时明确说明。需要保存内容时提出对应研究记录操作，不把原文件内容静默复制到多个模块。',
  },
};
export const isWorkflowId = (value: unknown): value is WorkflowId =>
  typeof value === 'string' && WORKFLOW_IDS.includes(value as WorkflowId);
export function resolveWorkflow(value: unknown, scope: string): WorkflowId {
  if (isWorkflowId(value)) return value;
  return (
    (
      {
        project: 'next-steps',
        task: 'task-breakdown',
        experiment: 'experiment-review',
        reference: 'reference-note',
      } as Record<string, WorkflowId>
    )[scope.split(':')[0]] || 'general'
  );
}
export function workflowsForContext(kind: ResearchContextKind): ResearchWorkflow[] {
  const ids: WorkflowId[] =
    kind === 'task'
      ? ['task-breakdown', 'next-steps', 'progress-review']
      : kind === 'experiment'
        ? ['experiment-review', 'experiment-plan', 'next-steps', 'file-analysis']
        : kind === 'reference'
          ? ['reference-note', 'next-steps', 'file-analysis']
          : kind === 'none'
            ? ['general', 'file-analysis']
            : ['next-steps', 'progress-review', 'experiment-plan', 'reference-note', 'file-analysis'];
  return ids.map((id) => WORKFLOWS[id]);
}

export function recordHref(kind: string, id: string): string | null {
  if (kind === 'project') return '/projects/' + encodeURIComponent(id);
  if (kind === 'task') return '/tasks?focus=' + encodeURIComponent(id);
  if (kind === 'experiment') return '/experiments/' + encodeURIComponent(id);
  if (kind === 'reference') return '/library?focus=' + encodeURIComponent(id);
  if (kind === 'file') return '/files?focus=' + encodeURIComponent(id);
  return null;
}
export function scopeFromRecordHref(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  try {
    const url = new URL(href, 'http://research.local');
    if (url.origin !== 'http://research.local') return null;
    const match = /^\/(projects|experiments)\/([^/]+)$/.exec(url.pathname);
    if (match) return (match[1] === 'projects' ? 'project:' : 'experiment:') + decodeURIComponent(match[2]);
    const focus = url.searchParams.get('focus');
    if (focus && url.pathname === '/tasks') return 'task:' + focus;
    if (focus && url.pathname === '/library') return 'reference:' + focus;
    return null;
  } catch {
    return null;
  }
}
