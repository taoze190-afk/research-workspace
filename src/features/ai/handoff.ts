import type { AiMessage } from '@/lib/ai';
import { createId } from '@/lib/id';
import { describeAction, parseActionsReply, type ActionResult, type AiAction } from './actions';
import { newConversation, saveConversation, type StudioConversation, type StudioBatch } from './conversations';
import { resolveWorkflow } from './workflows';

export function handoffToStudio(
  owner: string,
  input: {
    scope: string;
    source: 'platform' | 'personal';
    messages: AiMessage[];
    draft: string;
    actions: AiAction[];
    results: Map<AiAction, ActionResult>;
    issues: string[];
    completed?: ActionResult | null;
    batches?: StudioBatch[];
  },
): { conversation: StudioConversation; href: string } | null {
  const conversation = newConversation(input.source, input.scope, input.draft);
  conversation.workflow = resolveWorkflow(undefined, input.scope);
  conversation.messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ ...m, content: m.role === 'assistant' ? parseActionsReply(m.content).text : m.content }));
  let assistantIndex = conversation.messages.length - 1;
  while (assistantIndex >= 0 && conversation.messages[assistantIndex].role !== 'assistant') assistantIndex--;
  if (input.batches?.length)
    conversation.batches = input.batches.map((batch) => ({
      ...batch,
      actions: [...batch.actions],
      results: [...batch.results],
      issues: [...batch.issues],
    }));
  else if (input.actions.length && assistantIndex >= 0)
    conversation.batches.push({
      id: createId(),
      messageIndex: assistantIndex,
      actions: input.actions,
      results: input.actions.map((action) => input.results.get(action) || null),
      issues: input.issues,
    });
  if (assistantIndex >= 0 && !conversation.messages[assistantIndex].content)
    conversation.messages[assistantIndex].content = input.actions.length
      ? '已带入待确认操作。'
      : '生成尚未完成，可继续提问。';
  if (input.completed?.ok && assistantIndex >= 0 && !conversation.batches.some((b) => b.results.some((r) => r?.ok))) {
    const href = input.completed.href;
    const link = href && /^\/(projects|tasks|experiments|library)([/?]|$)/.test(href) ? ` [查看记录](${href})` : '';
    conversation.messages[assistantIndex].content += '\n\n已保存的操作：' + input.completed.message + link;
  }
  if (!saveConversation(owner, conversation)) return null;
  // 空讨论没有可保存内容时，仍使用范围和草稿打开工作室。
  const params = new URLSearchParams({
    chat: conversation.id,
    scope: conversation.scope,
    workflow: conversation.workflow,
  });
  if (!conversation.messages.length && !conversation.draft.trim()) params.delete('chat');
  return { conversation, href: '/ai?' + params };
}

export const actionHistoryText = (conversation: StudioConversation, messageIndex: number) =>
  conversation.batches
    .filter((batch) => batch.messageIndex === messageIndex)
    .flatMap((batch) =>
      batch.actions.map(
        (action, index) =>
          describeAction(action) +
          (batch.results[index]?.ok ? '（已执行）' : batch.dismissed ? '（已忽略）' : '（未执行）'),
      ),
    )
    .join('；');
