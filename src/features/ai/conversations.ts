import type { AiMessage } from '@/lib/ai';
import { attachmentReference, validAttachmentReference, type AiAttachment } from '@/lib/ai-attachments';
import { createId } from '@/lib/id';
import type { ActionResult, AiAction } from './actions';
import { isWorkflowId, type WorkflowId } from './workflows';
import { sanitizeResearchTrace } from './provenance';

export interface StudioBatch {
  id: string;
  messageIndex: number;
  actions: AiAction[];
  results: (ActionResult | null)[];
  issues: string[];
  dismissed?: boolean;
}
export interface StudioConversation {
  id: string;
  title: string;
  scope: string;
  source: 'platform' | 'personal';
  workflow?: WorkflowId;
  messages: AiMessage[];
  batches: StudioBatch[];
  draft: string;
  draftAttachments?: AiAttachment[];
  updatedAt: number;
}
const key = (owner: string) => `rw.studio.v2.${encodeURIComponent(owner)}`;
const MAX_CHARS = 700_000;

export function newConversation(
  source: StudioConversation['source'],
  scope = 'workspace',
  draft = '',
): StudioConversation {
  return { id: createId(), title: '', scope, source, messages: [], batches: [], draft, updatedAt: Date.now() };
}

/** 本机对话按账号分开。研究记录仍由原有数据库同步，对话不包含模型密钥。 */
export function readConversations(owner: string): StudioConversation[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row): row is StudioConversation => {
        if (!row || typeof row !== 'object') return false;
        const r = row as StudioConversation;
        return (
          typeof r.id === 'string' &&
          typeof r.title === 'string' &&
          typeof r.scope === 'string' &&
          ['platform', 'personal'].includes(r.source) &&
          typeof r.draft === 'string' &&
          (r.draftAttachments === undefined ||
            (Array.isArray(r.draftAttachments) &&
              r.draftAttachments.length <= 6 &&
              r.draftAttachments.every(validAttachmentReference))) &&
          Number.isFinite(r.updatedAt) &&
          Array.isArray(r.messages) &&
          r.messages.every(
            (m) =>
              m &&
              ['user', 'assistant'].includes(m.role) &&
              typeof m.content === 'string' &&
              (m.attachments === undefined ||
                (Array.isArray(m.attachments) &&
                  m.attachments.length <= 6 &&
                  m.attachments.every(validAttachmentReference))),
          ) &&
          Array.isArray(r.batches) &&
          r.batches.every(
            (b) =>
              b &&
              typeof b.id === 'string' &&
              Number.isInteger(b.messageIndex) &&
              Array.isArray(b.actions) &&
              b.actions.every((a) => a && typeof a.action === 'string') &&
              Array.isArray(b.results) &&
              b.results.every((v) => v === null || (v && typeof v.ok === 'boolean' && typeof v.message === 'string')) &&
              Array.isArray(b.issues) &&
              b.issues.every((i) => typeof i === 'string'),
          )
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((conversation) => ({
        ...conversation,
        workflow: isWorkflowId(conversation.workflow) ? conversation.workflow : undefined,
        batches: conversation.batches.map((b) => ({ ...b, dismissed: b.dismissed === true })),
        draftAttachments: conversation.draftAttachments?.map(attachmentReference),
        messages: conversation.messages.map((message) => ({
          ...message,
          research: sanitizeResearchTrace(message.research),
          ...(message.attachments ? { attachments: message.attachments.map(attachmentReference) } : {}),
        })),
      }));
  } catch {
    return [];
  }
}

export function saveConversation(owner: string, conversation: StudioConversation): boolean {
  if (!conversation.messages.length && !conversation.draft.trim() && !conversation.draftAttachments?.length)
    return true;
  try {
    const start = Math.max(0, conversation.messages.length - 40);
    const current = {
      ...conversation,
      workflow: isWorkflowId(conversation.workflow) ? conversation.workflow : undefined,
      title: (
        conversation.messages.find((m) => m.role === 'user')?.content ||
        conversation.draft ||
        conversation.draftAttachments?.[0]?.name ||
        conversation.messages.find((m) => m.attachments?.length)?.attachments?.[0]?.name ||
        '附件讨论'
      ).slice(0, 36),
      draftAttachments: conversation.draftAttachments?.map(attachmentReference),
      messages: conversation.messages.slice(start).map((m) => ({
        ...m,
        research: sanitizeResearchTrace(m.research),
        content: m.content.slice(0, 50_000),
        ...(m.attachments?.length ? { attachments: m.attachments.map(attachmentReference) } : {}),
      })),
      batches: conversation.batches
        .filter((b) => b.messageIndex >= start)
        .map((b) => ({ ...b, dismissed: b.dismissed === true, messageIndex: b.messageIndex - start })),
    };
    const rows = [current, ...readConversations(owner).filter((r) => r.id !== current.id)].slice(0, 12);
    while (rows.length > 1 && JSON.stringify(rows).length > MAX_CHARS) rows.pop();
    // 单次对话过长时留在当前页面，明确报告保存失败，不悄悄截掉操作收据。
    const json = JSON.stringify(rows);
    if (json.length > MAX_CHARS) return false;
    localStorage.setItem(key(owner), json);
    return true;
  } catch {
    return false;
  }
}

export function deleteConversation(owner: string, id: string): boolean {
  try {
    localStorage.setItem(key(owner), JSON.stringify(readConversations(owner).filter((r) => r.id !== id)));
    return true;
  } catch {
    return false;
  }
}
