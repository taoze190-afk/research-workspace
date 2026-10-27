/** AI 回复协议与执行入口。所有修改均由预览卡确认后经过 repository 与事务保存。 */
import { SUPPORTED_ACTIONS, type AiAction } from './action-engine';
export * from './action-engine';

export interface ParsedAction {
  text: string;
  action: AiAction | null;
  issues: string[];
}
export interface ParsedActions {
  text: string;
  actions: AiAction[];
  issues: string[];
}
const ACTION_BLOCK = /```action(?=\s|\{)\s*([\s\S]*?)```/g;

/** 不把无法执行的 JSON 当成已可操作的卡片；问题交给界面显示并支持重新生成。 */
export function parseActionsReply(reply: string): ParsedActions {
  const actions: AiAction[] = [];
  const issues: string[] = [];
  const text = reply.replace(ACTION_BLOCK, (_all, body: string) => {
    if (body.length > 160000) {
      issues.push('操作内容过长，请精简后重试');
      return '';
    }
    try {
      const parsed: unknown = JSON.parse(body.trim());
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof (parsed as AiAction).action !== 'string'
      ) {
        issues.push('有一项操作缺少有效类型，请让 AI 重新生成');
      } else if (!SUPPORTED_ACTIONS.includes((parsed as AiAction).action as (typeof SUPPORTED_ACTIONS)[number])) {
        issues.push(`暂不支持操作「${(parsed as AiAction).action}」，没有执行`);
      } else actions.push(parsed as AiAction);
    } catch {
      issues.push('有一项操作格式不完整，请让 AI 重新生成');
    }
    return '';
  });
  const unfinished = /```action\b/.test(text);
  if (unfinished) issues.push('操作内容尚未完整返回，没有执行');
  return { text: (unfinished ? text.replace(/```action\b[\s\S]*$/, '') : text).trimEnd(), actions, issues };
}

export function parseActionReply(reply: string): ParsedAction {
  const { text, actions, issues } = parseActionsReply(reply);
  return { text, action: actions[0] ?? null, issues };
}

export const ACTION_SYSTEM_PROMPT = `
你可以读取用户已提供的资料，并提出实际保存操作。每项操作都必须等用户确认采纳后才会执行。不要声称尚未执行的操作已经完成。
需要修改记录时，在回复末尾给出一个或多个 action 代码块，每块是一个 JSON 对象，例如：
\`\`\`action
{"action":"create_task","title":"复现实验主表","priority":"high","dueDate":"2026-11-01"}
\`\`\`
可用操作（严格使用以下字段，不要添加 userId、id、deletedAt、isDemo 等系统字段）：
- create_project: {"action":"create_project","name":"项目名称","question":"研究问题，可省略","goal":"目标，可省略","status":"planned|active|paused|completed|archived，可省略","startDate":"YYYY-MM-DD，可省略","endDate":"YYYY-MM-DD，可省略"}
- update_project: {"action":"update_project","projectId":"真实项目 ID，可省略以使用当前项目","changes":{"goal":"新目标","status":"active"}}。changes 只支持 name/question/goal/status/startDate/endDate。
- create_task: {"action":"create_task","title":"任务标题","description":"说明，可省略","priority":"urgent|high|medium|low，可省略","dueDate":"YYYY-MM-DD，可省略","projectId":"真实项目 ID，可省略"}。当前是项目时自动关联；当前是实验或文献时关联该记录。
- create_tasks: {"action":"create_tasks","projectId":"真实项目 ID，可省略","items":[{"title":"任务一","description":"完成标准","priority":"high","dueDate":"YYYY-MM-DD"}]}。一次最多12项，不要输出空标题。
- update_task: {"action":"update_task","taskId":"已提供资料中的真实任务 ID","changes":{"status":"todo|doing|done|cancelled","priority":"urgent|high|medium|low","dueDate":"YYYY-MM-DD 或 null","title":"新标题","description":"新说明"}}。changes 只包含用户要求改的字段；当前选中任务时可省略 taskId。不要猜 ID，也不要凭模糊标题修改全工作区任务。
- create_milestones: {"action":"create_milestones","projectId":"真实项目 ID，可省略以使用当前项目","items":[{"title":"里程碑","dueDate":"YYYY-MM-DD，可省略"}]}。
- add_subtasks: {"action":"add_subtasks","taskId":"真实任务 ID，当前选中任务时可省略","items":["子任务一","子任务二"]}。旧格式 taskTitle 只允许在已选项目内定位恰好唯一的任务。
- create_experiment: {"action":"create_experiment","title":"实验标题","projectId":"真实项目 ID，可省略","purpose":"目的，可省略","hypothesis":"假设，可省略","method":"方法，可省略","nextStep":"下一步，可省略","experimentDate":"YYYY-MM-DD，可省略"}。不要伪造尚未完成的实验结果。
- update_experiment: {"action":"update_experiment","experimentId":"真实实验 ID，当前选中实验时可省略","field":"purpose|hypothesis|method|results|observations|conclusion|nextStep","value":"追加的内容"}。只追加，不覆盖旧记录。
- create_reference: {"action":"create_reference","title":"文献标题","authors":"作者，可省略","year":2026,"venue":"来源，可省略","doi":"真实 DOI，可省略","url":"完整 http(s) 来源链接，可省略","projectId":"真实项目 ID，可省略"}。只整理用户提供或已核实的文献，不编造来源和结论。
- write_reference_note: {"action":"write_reference_note","referenceId":"真实文献 ID，当前选中文献时可省略","field":"noteQuestion|noteMethod|noteFindings|noteLimits|noteRelevance","value":"笔记内容","mode":"fill|append，可省略"}。默认仅填写空字段；已有内容需要用 append 明确追加，绝不覆盖。
- set_reading_status: {"action":"set_reading_status","referenceId":"真实文献 ID，当前选中文献时可省略","readingStatus":"unread|reading|read"}。只在用户明确要求时调整阅读状态，不依据猜测标记已读。
- set_experiment_status: {"action":"set_experiment_status","experimentId":"真实实验 ID，当前选中实验时可省略","status":"draft|active|done|failed"}。用户明确说明实验完成或失败后才提议变更，不能依据缺少结果自行标记完成。
- link_reference_project: {"action":"link_reference_project","referenceId":"已存在的文献 ID，当前选中文献时可省略","projectId":"真实项目 ID，当前选中项目时可省略"}。复用已有文献，不重复创建；已有关联保持一份。
日期必须是有效的 YYYY-MM-DD。任务/项目标题最多240字，单段正文最多20000字，一次最多12个动作、每个批量最多12项。
使用资料里的真实 ID；选中项目时不得修改其外的任务。缺少定位信息先询问用户，不要猜测。动作卡已经展示明细，正文只简短说明意图即可。
`;
