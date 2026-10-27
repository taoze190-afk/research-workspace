import { afterEach, describe, expect, it } from 'vitest';
import { deleteConversation, newConversation, readConversations, saveConversation } from '@/features/ai/conversations';

afterEach(() => localStorage.clear());
describe('AI 工作室本机对话', () => {
  it('保存对话、草稿和已执行状态，账号之间互不读取', () => {
    const c = newConversation('personal', 'project:p', '待发送问题');
    c.messages = [
      { role: 'user', content: '安排实验' },
      { role: 'assistant', content: '已准备' },
    ];
    c.batches = [
      {
        id: 'b',
        messageIndex: 1,
        actions: [{ action: 'create_task', title: '任务' }],
        results: [{ ok: true, message: '已创建' }],
        issues: [],
      },
    ];
    expect(saveConversation('a', c)).toBe(true);
    expect(readConversations('a')[0]).toMatchObject({
      scope: 'project:p',
      draft: '待发送问题',
      batches: [{ results: [{ ok: true }] }],
    });
    expect(readConversations('b')).toEqual([]);
    expect(deleteConversation('b', c.id)).toBe(true);
    expect(readConversations('a')).toHaveLength(1);
  });
  it('更新同一对话不会重复；空白对话不占历史', () => {
    const c = newConversation('personal');
    expect(saveConversation('a', c)).toBe(true);
    expect(readConversations('a')).toHaveLength(0);
    c.draft = '第一个问题';
    saveConversation('a', c);
    c.draft = '修改的问题';
    saveConversation('a', c);
    expect(readConversations('a')).toHaveLength(1);
    expect(readConversations('a')[0].draft).toBe('修改的问题');
    deleteConversation('a', c.id);
    expect(readConversations('a')).toHaveLength(0);
  });
  it('无效的缓存不进入对话执行界面', () => {
    localStorage.setItem('rw.studio.v2.a', JSON.stringify([{ id: 'fake', messages: 'bad' }]));
    expect(readConversations('a')).toEqual([]);
  });
  it('仅有附件的草稿也保存，正文与图片数据不进入localStorage', () => {
    const conversation = newConversation('personal');
    const attachment = {
      id: 'stored-image',
      name: 'plot.png',
      mimeType: 'image/png',
      size: 120,
      kind: 'image' as const,
      dataUrl: 'data:image/png;base64,secret-image',
      text: 'secret-file-text',
    };
    conversation.draftAttachments = [attachment];
    expect(saveConversation('owner', conversation)).toBe(true);
    expect(readConversations('owner')[0].draftAttachments).toEqual([
      { id: 'stored-image', name: 'plot.png', mimeType: 'image/png', size: 120, kind: 'image' },
    ]);
    conversation.messages = [{ role: 'user', content: '请看图', attachments: [attachment] }];
    saveConversation('owner', conversation);
    const raw = localStorage.getItem('rw.studio.v2.owner');
    expect(raw).not.toContain('secret-image');
    expect(raw).not.toContain('secret-file-text');
    expect(readConversations('owner')[0].messages[0].attachments?.[0].id).toBe('stored-image');
  });
});
