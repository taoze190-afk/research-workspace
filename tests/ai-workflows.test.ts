import { afterEach, describe, expect, it, vi } from 'vitest';
import { base, dataset, makeProject, makeTask, makeReference } from './factory';
import { buildResearchContext } from '@/features/ai/context';
import { captureResearchTrace, sanitizeResearchTrace } from '@/features/ai/provenance';
import { resolveWorkflow, scopeFromRecordHref, workflowsForContext } from '@/features/ai/workflows';
import { handoffToStudio, actionHistoryText } from '@/features/ai/handoff';
import { newConversation, readConversations, saveConversation } from '@/features/ai/conversations';
import { buildMessages } from '@/lib/ai';
import { serializeAiMessages } from '@/lib/ai-attachments';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('统一工作流与资料追溯', () => {
  it('各模块默认工作目标不同，结果链接只接受本站正式记录', () => {
    expect(resolveWorkflow(undefined, 'task:t')).toBe('task-breakdown');
    expect(resolveWorkflow(undefined, 'experiment:e')).toBe('experiment-review');
    expect(workflowsForContext('reference').map((w) => w.id)).toContain('reference-note');
    expect(workflowsForContext('task').map((w) => w.id)).not.toContain('reference-note');
    expect(scopeFromRecordHref('/tasks?focus=task-1')).toBe('task:task-1');
    expect(scopeFromRecordHref('/projects/p?tab=library')).toBe('project:p');
    for (const href of [
      'https://elsewhere.test/tasks?focus=t',
      '//elsewhere.test',
      'javascript:alert(1)',
      '/\\elsewhere.test/projects/p',
      '/projects/%',
    ])
      expect(scopeFromRecordHref(href)).toBeNull();
  });
  it('来源清单以实际装入摘要的记录为准，不把被省略资料或其他课题列为已发送', () => {
    const project = makeProject({ id: 'p', name: '当前项目' });
    const task = makeTask({ id: 't', projectId: 'p', title: '实际发送的任务' });
    const omitted = makeTask({ id: 'omitted', projectId: 'p', title: '未发送任务' });
    const other = makeProject({ id: 'other', name: '不应出现的项目' });
    const data = dataset({ projects: [project, other], tasks: [task, omitted] });
    const context = buildResearchContext(data, 'project:p');
    const payload = JSON.parse(context.text);
    payload.tasks = payload.tasks.filter((row: { id: string }) => row.id === 't');
    context.text = JSON.stringify(payload);
    const trace = captureResearchTrace(
      data,
      context,
      'next-steps',
      [{ id: 'file', name: '原件.pdf', mimeType: 'application/pdf', size: 10, kind: 'text' }],
      123,
    );
    expect(trace.sources.map((s) => s.id)).toEqual(['p', 'file', 't']);
    expect(trace.capturedAt).toBe(123);
    expect(JSON.stringify(trace)).not.toContain('未发送任务');
    expect(JSON.stringify(trace)).not.toContain('不应出现的项目');
    expect(captureResearchTrace(data, buildResearchContext(data, 'none'), 'general').sources).toEqual([]);
  });
  it('追溯元数据不进入模型消息，也不持久化正文或外部跳转地址', () => {
    const reference = makeReference({ id: 'r', noteFindings: '不能在来源元数据中复制的完整正文' });
    const data = dataset({ references: [reference] });
    const trace = captureResearchTrace(data, buildResearchContext(data, 'reference:r'), 'reference-note');
    const history = [{ role: 'user' as const, content: '第一问', research: trace }];
    const request = buildMessages('rule', '', history, '第二问');
    expect(request[1]).not.toHaveProperty('research');
    expect(serializeAiMessages(history)[0]).toEqual({ role: 'user', content: '第一问' });
    const changed = structuredClone(trace);
    changed.sources[0].href = 'javascript:alert(1)';
    expect(sanitizeResearchTrace(changed)?.sources[0].href).toBe('/library?focus=r');
    expect(JSON.stringify(trace)).not.toContain(reference.noteFindings);
    const conversation = newConversation('personal', 'reference:r');
    conversation.workflow = 'reference-note';
    conversation.messages = history;
    expect(saveConversation('a', conversation)).toBe(true);
    expect(readConversations('a')[0].messages[0].research?.sources[0].id).toBe('r');
    expect(readConversations('b')).toEqual([]);
  });

  it('子任务和里程碑来源可回到所属记录，丢失父记录的快照不产生错误链接', () => {
    const project = makeProject({ id: 'parent-project' });
    const task = makeTask({ id: 'parent-task', projectId: project.id });
    const data = dataset({
      projects: [project],
      tasks: [task],
      subtasks: [{ ...base(), id: 'child', taskId: task.id, title: '核对数据', done: false, sortOrder: 0 }],
      milestones: [
        { ...base(), id: 'stage', projectId: project.id, title: '阶段验收', dueDate: null, done: false, sortOrder: 0 },
      ],
    });
    const trace = captureResearchTrace(data, buildResearchContext(data, 'project:' + project.id), 'next-steps');
    expect(trace.sources.find((s) => s.id === 'child')?.href).toBe('/tasks?focus=parent-task');
    expect(trace.sources.find((s) => s.id === 'stage')?.href).toBe('/projects/parent-project');
    expect(sanitizeResearchTrace(trace)?.sources).toEqual(trace.sources);
    delete trace.sources.find((s) => s.id === 'child')!.parentId;
    expect(sanitizeResearchTrace(trace)).toBeUndefined();
  });
});
describe('副驾驶交接与操作回执', () => {
  it('交接保留多轮讨论、草稿、待处理和成功操作，已执行项不会重新待采纳', () => {
    const done = { action: 'create_task', title: '已创建的任务' },
      pending = { action: 'create_task', title: '待确认的任务' };
    const transferred = handoffToStudio('owner', {
      scope: 'project:p',
      source: 'platform',
      draft: '继续讨论',
      messages: [
        { role: 'user', content: '安排工作' },
        { role: 'assistant', content: '已准备好' },
      ],
      actions: [pending],
      results: new Map(),
      issues: [],
      batches: [
        {
          id: 'batch',
          messageIndex: 1,
          actions: [done, pending],
          results: [{ ok: true, message: '已创建', href: '/tasks?focus=created' }, null],
          issues: [],
        },
      ],
    });
    expect(transferred).not.toBeNull();
    const saved = readConversations('owner')[0];
    expect(saved.messages).toHaveLength(2);
    expect(saved.draft).toBe('继续讨论');
    expect(saved.batches[0].results[0]?.ok).toBe(true);
    expect(saved.batches[0].results[1]).toBeNull();
    expect(new URL(transferred!.href, 'http://local').searchParams.get('chat')).toBe(saved.id);
    saved.batches[0].dismissed = true;
    saveConversation('owner', saved);
    const restored = readConversations('owner')[0];
    expect(actionHistoryText(restored, 1)).toContain('已执行');
    expect(actionHistoryText(restored, 1)).toContain('已忽略');
    expect(restored.batches[0].results[0]?.ok).toBe(true);
  });
  it('保存失败时交接明确失败，不返回会丢失讨论的跳转地址', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('存储已满');
    });
    expect(
      handoffToStudio('owner', {
        scope: 'workspace',
        source: 'personal',
        messages: [{ role: 'user', content: '必须保留' }],
        draft: '',
        actions: [],
        results: new Map(),
        issues: [],
      }),
    ).toBeNull();
  });
});
