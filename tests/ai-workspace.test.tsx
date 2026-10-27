import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AiWorkspacePage } from '@/features/ai/AiWorkspacePage';
import type { AiConfig, AiMessage } from '@/lib/ai';
import { db } from '@/data/db';
import { loadDataset } from '@/data/repo';
import { dataset, makeProject, makeTask } from './factory';
import { readConversations } from '@/features/ai/conversations';

type ChatOptions = { signal?: AbortSignal; onDelta?: (delta: string) => void };
const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useData: vi.fn(),
  platformAi: vi.fn(),
  loadAiConfig: vi.fn(),
  aiChat: vi.fn<(config: AiConfig, messages: AiMessage[], options?: ChatOptions) => Promise<string>>(),
}));
vi.mock('@/state/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/state/DataContext', () => ({ useData: mocks.useData }));
vi.mock('@/data/api', () => ({ api: { platformAi: mocks.platformAi } }));
vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai')>()),
  loadAiConfig: mocks.loadAiConfig,
  aiChat: mocks.aiChat,
}));
const user = {
  id: 'researcher-a',
  email: 'researcher@example.test',
  role: 'user',
  nickname: '测试研究者',
  aiEnabled: true,
};
const selectedProject = makeProject({ id: 'selected-project', name: '肌电识别研究', question: '如何降低跨受试者差异' });
const otherProject = makeProject({ id: 'other-project', name: '另一个独立课题' });
const selectedTask = makeTask({ projectId: selectedProject.id, title: '验证特征稳定性' });
const otherTask = makeTask({ projectId: otherProject.id, title: '另一个课题的独立任务' });

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(localStorage)) if (key.startsWith('rw.studio.v2.')) localStorage.removeItem(key);
  mocks.useAuth.mockReturnValue({ phase: 'signed-in', user });
  await db.projects.bulkPut([selectedProject, otherProject]);
  await db.tasks.bulkPut([selectedTask, otherTask]);
  const mutate = vi.fn(async (fn: () => Promise<unknown>) => {
    await fn();
    mocks.useData.mockReturnValue({ data: await loadDataset(), status: 'ready', mutate });
    return true;
  });
  mocks.useData.mockReturnValue({
    data: dataset({ projects: [selectedProject, otherProject], tasks: [selectedTask, otherTask] }),
    status: 'ready',
    mutate,
  });
  mocks.platformAi.mockResolvedValue({
    provider: 'custom',
    model: 'test-platform-model',
    enabled: true,
    configured: true,
    baseUrl: 'https://model.example.test/v1',
    keyVariable: 'TEST_ONLY',
    aiAllowed: true,
  });
  mocks.loadAiConfig.mockReturnValue({ enabled: false, baseUrl: '', apiKey: '', model: '' });
  mocks.aiChat.mockReset();
  mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
    options?.onDelta?.('模型测试回答');
    return '模型测试回答';
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: !query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openStudio() {
  const view = render(
    <MemoryRouter initialEntries={['/ai']}>
      <AiWorkspacePage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mocks.platformAi).toHaveBeenCalledTimes(1));
  return view;
}
async function openInspector() {
  fireEvent.click(screen.getByRole('button', { name: '资料与模型' }));
  return screen.findByRole('dialog');
}
async function chooseScope(value: string) {
  const drawer = await openInspector();
  fireEvent.change(within(drawer).getByLabelText('研究范围'), { target: { value } });
  fireEvent.click(within(drawer).getByRole('button', { name: '完成' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
async function chooseSource(value: string) {
  const drawer = await openInspector();
  fireEvent.change(within(drawer).getByLabelText('模型来源'), { target: { value } });
  fireEvent.click(within(drawer).getByRole('button', { name: '完成' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
async function ask(question: string) {
  const before = mocks.aiChat.mock.calls.length;
  const input = screen.getByRole('textbox', { name: '向 AI 提问' });
  fireEvent.change(input, { target: { value: question } });
  await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
  await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(before + 1));
  await waitFor(() => expect(screen.getByRole('log', { name: '对话记录' }).getAttribute('aria-busy')).toBe('false'));
}
const contextOf = (call: number) =>
  mocks.aiChat.mock.calls[call][1]
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
const actionReply = (action: unknown, text = '已准备好建议。') =>
  `${text}\n\`\`\`action\n${JSON.stringify(action)}\n\`\`\``;

// 这些测试保留真实记录和 repository；仅替换模型网络与身份/数据 Provider。
describe('AI 工作室交互回归', () => {
  it('选择工作流保留旧草稿，明确发送后才请求模型', async () => {
    await openStudio();
    fireEvent.change(screen.getByRole('textbox', { name: '向 AI 提问' }), { target: { value: '原来的研究草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切换工作流：自由协作' }));
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: /规划实验/ }));
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '切换工作流：规划实验' })).toBeTruthy();
    expect(readConversations(user.id).some((c) => c.draft === '原来的研究草稿')).toBe(true);
    await ask('设计一次实验');
    expect(contextOf(0)).toContain('新实验只写目的、假设、方法和下一步');
  });

  it('本轮资料只显示实际发送的项目记录，恢复对话后仍可核对', async () => {
    const view = await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('核对当前课题');
    fireEvent.click(screen.getByRole('button', { name: '查看本轮资料' }));
    let drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('link', { name: new RegExp(selectedTask.title) })).toBeTruthy();
    expect(within(drawer).queryByText(otherTask.title)).toBeNull();
    expect(within(drawer).queryByText(otherProject.name)).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: '完成' }));
    view.unmount();
    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AiWorkspacePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '查看本轮资料' }));
    drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('link', { name: new RegExp(selectedTask.title) })).toBeTruthy();
  });

  it('收起操作卡后保留已保存回执与正式记录链接', async () => {
    mocks.aiChat.mockResolvedValueOnce(actionReply({ action: 'create_task', title: '回执保留任务' }));
    await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('增加后续工作');
    fireEvent.click(screen.getByRole('button', { name: '采纳：新建任务' }));
    await screen.findByRole('button', { name: '已执行：新建任务' });
    fireEvent.click(screen.getByRole('button', { name: '忽略全部提议' }));
    expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看操作记录' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('已保存')).toBeTruthy();
    const saved = (await loadDataset()).tasks.filter((task) => task.title === '回执保留任务');
    expect(saved).toHaveLength(1);
    expect(within(drawer).getByRole('link', { name: '查看记录' }).getAttribute('href')).toBe(
      '/tasks?focus=' + saved[0].id,
    );
  });

  it('保存结果可以继续跟进，下一轮范围落到真实新任务', async () => {
    mocks.aiChat.mockResolvedValueOnce(actionReply({ action: 'create_task', title: '继续跟进任务' }));
    await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('安排具体工作');
    fireEvent.click(screen.getByRole('button', { name: '采纳：新建任务' }));
    await screen.findByRole('button', { name: '已执行：新建任务' });
    fireEvent.click(screen.getByRole('button', { name: '继续跟进' }));
    expect(screen.getByRole('button', { name: '研究范围：继续跟进任务' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '切换工作流：拆分任务' })).toBeTruthy();
    await ask('拆分这项工作');
    const task = (await loadDataset()).tasks.find((row) => row.title === '继续跟进任务')!;
    expect(contextOf(1)).toContain(task.id);
    expect(contextOf(1)).toContain(selectedProject.name);
    expect(contextOf(1)).not.toContain(otherProject.name);
  });

  it('本机对话保存失败时不切走当前讨论', async () => {
    await openStudio();
    await ask('需要保留的当前讨论');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储空间已满', 'QuotaExceededError');
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: '新对话' }));
      expect(screen.getByText('需要保留的当前讨论')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain('未能保存在本机');
    } finally {
      write.mockRestore();
    }
  });
  it('默认附带当前工作台的真实摘要，Ctrl+Enter 请求包含项目与任务 ID', async () => {
    await openStudio();
    expect(screen.getByRole('button', { name: '研究范围：我的工作区' })).toBeTruthy();
    await ask('检查整个工作台的进度');
    const context = contextOf(0);
    expect(context).toContain(selectedProject.name);
    expect(context).toContain(otherProject.name);
    expect(context).toContain(selectedTask.title);
    expect(context).toContain(selectedTask.id);
    expect(context).toContain(otherTask.title);
    expect(mocks.aiChat.mock.calls[0][1].at(-1)).toEqual({ role: 'user', content: '检查整个工作台的进度' });
  });

  it('显式选择不附带资料时，请求只含问题和规则而不泄露研究记录', async () => {
    await openStudio();
    await chooseScope('none');
    await ask('先讨论一个普通研究问题');
    const messages = mocks.aiChat.mock.calls[0][1];
    expect(messages.filter((message) => message.role === 'system')).toHaveLength(1);
    expect(messages.at(-1)).toEqual({ role: 'user', content: '先讨论一个普通研究问题' });
    expect(JSON.stringify(messages)).not.toContain(selectedProject.name);
    expect(JSON.stringify(messages)).not.toContain(otherProject.name);
    expect(screen.getByRole('button', { name: '研究范围：不附带资料' })).toBeTruthy();
  });

  it('选择项目后发送真实关联任务，排除其他课题资料', async () => {
    await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('请根据选中的课题安排下一步');
    const context = contextOf(0);
    expect(context).toContain(selectedProject.name);
    expect(context).toContain(selectedProject.question);
    expect(context).toContain(selectedTask.title);
    expect(context).not.toContain(otherProject.name);
    expect(context).not.toContain(otherTask.title);
    expect(mocks.aiChat.mock.calls[0][1].at(-1)?.content).toBe('请根据选中的课题安排下一步');
  });

  it('切换资料创建独立讨论并保留历史，恢复后只续接原课题消息', async () => {
    await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('保留这个课题的讨论');
    await chooseScope(`project:${otherProject.id}`);
    expect(screen.queryByText('保留这个课题的讨论')).toBeNull();
    expect(screen.getByRole('button', { name: `研究范围：${otherProject.name}` })).toBeTruthy();
    await ask('另一个课题的讨论');
    expect(contextOf(1)).toContain(otherProject.name);
    expect(contextOf(1)).not.toContain(selectedProject.name);
    fireEvent.click(screen.getByRole('button', { name: '对话记录' }));
    const history = await screen.findByRole('dialog');
    expect(within(history).getByRole('button', { name: '打开对话：另一个课题的讨论' })).toBeTruthy();
    fireEvent.click(within(history).getByRole('button', { name: '打开对话：保留这个课题的讨论' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('保留这个课题的讨论')).toBeTruthy();
    expect(screen.queryByText('另一个课题的讨论')).toBeNull();
    expect(screen.getByRole('button', { name: `研究范围：${selectedProject.name}` })).toBeTruthy();
    await ask('继续讨论原课题');
    const messages = mocks.aiChat.mock.calls[2][1];
    expect(messages).toContainEqual({ role: 'user', content: '保留这个课题的讨论' });
    expect(messages).toContainEqual({ role: 'assistant', content: '模型测试回答' });
    expect(JSON.stringify(messages)).not.toContain('另一个课题的讨论');
    expect(contextOf(2)).toContain(selectedProject.name);
    expect(contextOf(2)).not.toContain(otherProject.name);
  });

  it('模型失败重试同一次请求，不重复用户消息或中断片段', async () => {
    mocks.aiChat.mockImplementationOnce(async (_config, _messages, options) => {
      options?.onDelta?.('上一轮已完成的回答');
      return '上一轮已完成的回答';
    });
    await openStudio();
    await ask('先回顾课题背景');
    mocks.aiChat.mockImplementationOnce(async (_config, _messages, options) => {
      options?.onDelta?.('本次中断的回答片段');
      throw new Error('测试模型暂时不可用');
    });
    await ask('请帮我梳理研究假设');
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByText('模型测试回答')).toBeTruthy();
    expect(mocks.aiChat).toHaveBeenCalledTimes(3);
    const failed = mocks.aiChat.mock.calls[1][1],
      retried = mocks.aiChat.mock.calls[2][1];
    expect(retried).toEqual(failed);
    expect(retried).toContainEqual({ role: 'user', content: '先回顾课题背景' });
    expect(retried).toContainEqual({ role: 'assistant', content: '上一轮已完成的回答' });
    expect(retried.filter((m) => m.role === 'user' && m.content === '请帮我梳理研究假设')).toHaveLength(1);
    expect(JSON.stringify(retried)).not.toContain('本次中断的回答片段');
    expect(screen.getAllByText('先回顾课题背景')).toHaveLength(1);
    expect(screen.getAllByText('请帮我梳理研究假设')).toHaveLength(1);
    expect(screen.queryByText('本次中断的回答片段')).toBeNull();
  });

  it('成功返回空内容时显示可重试错误，并沿用原问题', async () => {
    mocks.aiChat.mockResolvedValueOnce('');
    await openStudio();
    await ask('请检查这个空回答请求');
    expect((await screen.findByRole('alert')).textContent).toContain('空内容');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('模型测试回答')).toBeTruthy();
    expect(mocks.aiChat.mock.calls[1][1]).toEqual(mocks.aiChat.mock.calls[0][1]);
    expect(screen.getAllByText('请检查这个空回答请求')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('个人接口生成期间离线会话恢复在线，不中断请求或卡住输入', async () => {
    mocks.useAuth.mockReturnValue({ phase: 'offline', user });
    mocks.loadAiConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://personal.example.test/v1',
      apiKey: '',
      model: 'test-personal-model',
    });
    let resolveChat!: (value: string) => void;
    let options: ChatOptions | undefined;
    mocks.aiChat.mockImplementationOnce((_config, _messages, opts) => {
      options = opts;
      return new Promise<string>((resolve) => {
        resolveChat = resolve;
      });
    });
    const view = render(
      <MemoryRouter initialEntries={['/ai']}>
        <AiWorkspacePage />
      </MemoryRouter>,
    );
    await chooseSource('personal');
    const input = screen.getByRole('textbox', { name: '向 AI 提问' });
    fireEvent.change(input, { target: { value: '恢复网络时继续生成' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1));
    expect(mocks.aiChat.mock.calls[0][0].mode).toBe('personal');
    expect(options?.signal?.aborted).toBe(false);
    mocks.useAuth.mockReturnValue({ phase: 'signed-in', user });
    view.rerender(
      <MemoryRouter initialEntries={['/ai']}>
        <AiWorkspacePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.platformAi).toHaveBeenCalledTimes(1));
    expect(options?.signal?.aborted).toBe(false);
    await act(async () => {
      options?.onDelta?.('网络恢复后继续完成的个人模型回答');
      resolveChat('网络恢复后继续完成的个人模型回答');
    });
    expect(await screen.findByText('网络恢复后继续完成的个人模型回答')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await ask('继续发送下一轮问题');
    expect(mocks.aiChat).toHaveBeenCalledTimes(2);
  });

  it('采纳真实保存任务，下一轮读取更新后的数据并保留每轮操作收据', async () => {
    mocks.aiChat.mockResolvedValueOnce(actionReply({ action: 'create_task', title: '操作测试任务' }, '准备新增任务。'));
    const view = await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('请增加一项可执行任务');
    const first = screen.getByRole('region', { name: 'AI 提议的动作' });
    const adopt = within(first).getByRole('button', { name: '采纳：新建任务' });
    fireEvent.click(adopt);
    fireEvent.click(adopt);
    await waitFor(() => expect(within(first).getByRole('button', { name: '已执行：新建任务' })).toBeTruthy());
    const created = (await loadDataset()).tasks.filter((task) => task.title === '操作测试任务');
    expect(created).toHaveLength(1);
    expect(created[0].projectId).toBe(selectedProject.id);
    mocks.aiChat.mockResolvedValueOnce(
      actionReply({ action: 'update_task', taskId: created[0].id, changes: { priority: 'high' } }, '准备调整优先级。'),
    );
    await ask('将新任务优先级调高');
    expect(contextOf(1)).toContain(created[0].id);
    expect(contextOf(1)).toContain('操作测试任务');
    expect(JSON.stringify(mocks.aiChat.mock.calls[1][1])).toContain('已执行');
    const cards = screen.getAllByRole('region', { name: 'AI 提议的动作' });
    expect(cards).toHaveLength(2);
    expect((within(cards[0]).getByRole('button', { name: '已执行：新建任务' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // 保留第二轮待采纳项，模拟离开再回来；已执行项不能再次保存。
    view.unmount();
    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AiWorkspacePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'AI 提议的动作' })).toHaveLength(2));
    const restored = screen.getAllByRole('region', { name: 'AI 提议的动作' });
    expect((within(restored[0]).getByRole('button', { name: '已执行：新建任务' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(restored[1]).getByRole('button', { name: '采纳：修改任务' }));
    await waitFor(async () => expect((await db.tasks.get(created[0].id))?.priority).toBe('high'));
    expect(await db.tasks.filter((task) => task.title === '操作测试任务').toArray()).toHaveLength(1);
  });

  it('保存失败后保留提议与重试入口，重试真正保存整个批量', async () => {
    mocks.aiChat.mockResolvedValueOnce(
      actionReply(
        { action: 'create_tasks', items: [{ title: '批量第一项' }, { title: '批量第二项' }] },
        '准备批量新增。',
      ),
    );
    await openStudio();
    await chooseScope(`project:${selectedProject.id}`);
    await ask('增加两个任务');
    const rejectSecond = (_key: unknown, row: unknown) => {
      if ((row as { title: string }).title === '批量第二项') throw new Error('测试写入失败');
    };
    db.tasks.hook('creating', rejectSecond);
    const card = screen.getByRole('region', { name: 'AI 提议的动作' });
    try {
      fireEvent.click(within(card).getByRole('button', { name: '采纳：新建 2 项任务' }));
      await waitFor(() => expect(within(card).getByRole('button', { name: '重试：新建 2 项任务' })).toBeTruthy());
      expect(await db.tasks.filter((task) => task.title.startsWith('批量')).toArray()).toHaveLength(0);
      expect(within(card).getByRole('status').textContent).toContain('保存失败');
    } finally {
      db.tasks.hook('creating').unsubscribe(rejectSecond);
    }
    fireEvent.click(within(card).getByRole('button', { name: '重试：新建 2 项任务' }));
    await waitFor(() => expect(within(card).getByRole('button', { name: '已执行：新建 2 项任务' })).toBeTruthy());
    expect(
      await db.tasks.filter((task) => task.title.startsWith('批量') && task.projectId === selectedProject.id).toArray(),
    ).toHaveLength(2);
  });
});
