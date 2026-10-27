import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { AgentDrawer } from '@/features/agent/AgentDrawer';
import type { AiConfig, AiMessage } from '@/lib/ai';
import { dataset, makeTask } from './factory';
import { createExperiment, createReference, loadDataset, updateExperiment } from '@/data/repo';
import { registerPendingSave } from '@/lib/pendingSaves';
import { readConversations } from '@/features/ai/conversations';

type ChatOptions = { signal?: AbortSignal; onDelta?: (delta: string) => void };
const mocks = vi.hoisted(() => ({
  useData: vi.fn(),
  loadAiConfig: vi.fn<() => AiConfig>(),
  aiChat: vi.fn<(config: AiConfig, messages: AiMessage[], options?: ChatOptions) => Promise<string>>(),
  toast: vi.fn(),
  auth: vi.fn(),
  platformAi: vi.fn(),
}));

vi.mock('@/state/DataContext', () => ({ useData: mocks.useData }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/state/AuthContext', () => ({ useAuth: mocks.auth }));
vi.mock('@/data/api', () => ({ api: { platformAi: mocks.platformAi } }));
vi.mock('@/lib/ai', async (original) => ({
  ...(await original<typeof import('@/lib/ai')>()),
  loadAiConfig: mocks.loadAiConfig,
  aiChat: mocks.aiChat,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ phase: 'local', user: null });
  mocks.useData.mockReturnValue({ data: dataset(), mutate: vi.fn(async () => true) });
  mocks.loadAiConfig.mockReturnValue({ enabled: false, baseUrl: '', apiKey: '', model: '' });
  mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
    options?.onDelta?.('这是本地模拟模型的回答');
    return '这是本地模拟模型的回答';
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AI 副驾驶首次接入与导航', () => {
  it('初次未配置，带问题打开并异步读取就绪配置后只自动发送一次', async () => {
    const consumed = vi.fn();
    const onOpenChange = vi.fn();
    const question = '请帮我安排研究计划';
    const view = render(
      <MemoryRouter>
        <AgentDrawer open={false} onOpenChange={onOpenChange} onQuestionConsumed={consumed} />
      </MemoryRouter>,
    );
    expect(mocks.loadAiConfig).toHaveBeenCalledTimes(1);
    expect(mocks.aiChat).not.toHaveBeenCalled();

    mocks.loadAiConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://model.example.test/v1',
      apiKey: '',
      model: 'mock-ready-model',
    });
    view.rerender(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={onOpenChange} initialQuestion={question} onQuestionConsumed={consumed} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('这是本地模拟模型的回答')).toBeTruthy();
    expect(mocks.loadAiConfig).toHaveBeenCalledTimes(2);
    expect(mocks.aiChat).toHaveBeenCalledTimes(1);
    expect(mocks.aiChat.mock.calls[0][0].model).toBe('mock-ready-model');
    expect(mocks.aiChat.mock.calls[0][1].at(-1)).toEqual({ role: 'user', content: question });
    expect(consumed).toHaveBeenCalledTimes(1);
    view.rerender(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={onOpenChange} initialQuestion={question} onQuestionConsumed={consumed} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止生成' })).toBeNull());
    expect(mocks.aiChat).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('未接入时进入设置会同时关闭 modal，不遮挡目标页面', async () => {
    const change = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      const location = useLocation();
      return (
        <>
          <output data-testid="current-path">{location.pathname}</output>
          <AgentDrawer
            open={open}
            onOpenChange={(value) => {
              change(value);
              setOpen(value);
            }}
          />
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Harness />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '去接入模型' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('current-path').textContent).toBe('/settings');
    expect(change).toHaveBeenCalledWith(false);
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it('登录用户使用已配置的平台模型，不要求填写个人接口', async () => {
    mocks.auth.mockReturnValue({ phase: 'signed-in', user: { id: 'member-1', role: 'member' } });
    mocks.platformAi.mockResolvedValue({
      enabled: true,
      configured: true,
      aiAllowed: true,
      model: 'platform-test-model',
    });
    render(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="读取我的任务" onQuestionConsumed={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('这是本地模拟模型的回答')).toBeTruthy();
    expect(mocks.platformAi).toHaveBeenCalledTimes(1);
    expect(mocks.aiChat).toHaveBeenCalledTimes(1);
    expect(mocks.aiChat.mock.calls[0][0]).toMatchObject({
      mode: 'platform',
      model: 'platform-test-model',
      apiKey: '',
      baseUrl: '',
    });
    expect(mocks.loadAiConfig).not.toHaveBeenCalled();
  });

  it('平台未授权当前用户时明确显示原因且不发送请求', async () => {
    mocks.auth.mockReturnValue({ phase: 'signed-in', user: { id: 'member-2', role: 'member' } });
    mocks.platformAi.mockResolvedValue({
      enabled: true,
      configured: true,
      aiAllowed: false,
      model: 'platform-test-model',
    });
    render(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="不应自动发送" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('当前账号未获平台 AI 授权')).toBeTruthy();
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('向 AI 副驾驶提问')).toBeNull();
  });

  it('动作采纳按钮连续点击只保存一次，保存后移除提议', async () => {
    const mutate = vi.fn(async (run: () => Promise<unknown>) => {
      await run();
      return true;
    });
    mocks.useData.mockReturnValue({ data: dataset(), mutate });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
      const reply = '准备新建。\n```action\n{"action":"create_task","title":"副驾驶真实任务"}\n```';
      options?.onDelta?.(reply);
      return reply;
    });
    render(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="创建任务" />
      </MemoryRouter>,
    );
    const adopt = await screen.findByRole('button', { name: /^采纳：/ });
    fireEvent.click(adopt);
    fireEvent.click(adopt);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect((await loadDataset()).tasks.filter((row) => row.title === '副驾驶真实任务')).toHaveLength(1);
  });

  it('保存失败保留提议，重试后落库并清除失败状态', async () => {
    const mutate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementation(async (run: () => Promise<unknown>) => {
        await run();
        return true;
      });
    mocks.useData.mockReturnValue({ data: dataset(), mutate });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
      const reply = '```action\n{"action":"create_task","title":"副驾驶重试任务"}\n```';
      options?.onDelta?.(reply);
      return reply;
    });
    render(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="创建任务" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^采纳：/ }));
    const retry = await screen.findByRole('button', { name: /^重试：/ });
    expect((await loadDataset()).tasks).toHaveLength(0);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull());
    expect((await loadDataset()).tasks.filter((row) => row.title === '副驾驶重试任务')).toHaveLength(1);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('无效动作显示解析问题，并可请求重新生成', async () => {
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat.mockImplementationOnce(async (_config, _messages, options) => {
      const reply = '```action\n{"action":"erase_everything"}\n```';
      options?.onDelta?.(reply);
      return reply;
    });
    render(
      <MemoryRouter>
        <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="测试无效操作" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('暂不支持操作'));
    expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新生成操作' }));
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(2));
  });

  it('结构化笔记工具只填最新仍为空的字段，保留已有笔记', async () => {
    const reference = await createReference({ title: '解构资料', noteQuestion: '已有研究问题' });
    const mutate = vi.fn(async (run: () => Promise<unknown>) => {
      await run();
      return true;
    });
    mocks.useData.mockReturnValue({ data: await loadDataset(), mutate });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
      const reply =
        '```json\n{"motivation":"模型提出的问题","methodology":"模型整理的方法","baselines":"已有基线","limitations":"模型整理的局限"}\n```';
      options?.onDelta?.(reply);
      return reply;
    });
    render(
      <MemoryRouter initialEntries={['/library?focus=' + reference.id]}>
        <AgentDrawer open onOpenChange={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '结构化解构' }));
    fireEvent.click(await screen.findByRole('button', { name: '填入空白笔记' }));
    await waitFor(async () => expect((await loadDataset()).references[0].noteLimits).toBe('模型整理的局限'));
    const saved = (await loadDataset()).references[0];
    expect(saved.noteQuestion).toBe('已有研究问题');
    expect(saved.noteMethod).toContain('模型整理的方法');
  });

  it('发送前读取最新镜像，不把界面旧快照交给模型', async () => {
    const experiment = await createExperiment({ title: '当前实验', method: '旧方法' });
    mocks.useData.mockReturnValue({ data: await loadDataset(), mutate: vi.fn(async () => true) });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    render(
      <MemoryRouter initialEntries={['/experiments/' + experiment.id]}>
        <AgentDrawer open onOpenChange={vi.fn()} />
      </MemoryRouter>,
    );
    await updateExperiment(experiment.id, { method: '其他编辑器刚保存的最新方法' });
    fireEvent.change(await screen.findByLabelText('向 AI 副驾驶提问'), { target: { value: '复盘方法' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(mocks.aiChat).toHaveBeenCalledTimes(1));
    const messages = JSON.stringify(mocks.aiChat.mock.calls[0][1]);
    expect(messages).toContain('其他编辑器刚保存的最新方法');
    expect(messages).not.toContain('旧方法');
  });

  it('存在保存失败的编辑器时不把旧内容发送给模型', async () => {
    const unregister = registerPendingSave(async () => false);
    try {
      mocks.loadAiConfig.mockReturnValue({
        enabled: true,
        baseUrl: 'http://local.test/v1',
        apiKey: '',
        model: 'local',
      });
      render(
        <MemoryRouter>
          <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="读取当前内容" />
        </MemoryRouter>,
      );
      expect(await screen.findByText('当前编辑内容保存失败，请先重试保存。')).toBeTruthy();
      expect(mocks.aiChat).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it('切换到另一个任务时清除旧资料的待确认操作', async () => {
    const task = makeTask({ title: '切换后的任务' });
    mocks.useData.mockReturnValue({ data: dataset({ tasks: [task] }), mutate: vi.fn(async () => true) });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat.mockImplementation(async (_config, _messages, options) => {
      const reply = '```action\n{"action":"create_task","title":"旧资料的提议"}\n```';
      options?.onDelta?.(reply);
      return reply;
    });
    let navigate: ReturnType<typeof useNavigate>;
    function Harness() {
      navigate = useNavigate();
      return <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="生成提议" />;
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>,
    );
    await screen.findByRole('region', { name: 'AI 提议的动作' });
    act(() => navigate('/tasks?focus=' + task.id));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull());
    expect(screen.getByText('切换后的任务')).toBeTruthy();
  });

  it('在工作室打开保留准确任务范围和当前输入草稿', async () => {
    const task = makeTask({ title: '当前任务' });
    mocks.useData.mockReturnValue({ data: dataset({ tasks: [task] }), mutate: vi.fn(async () => true) });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    const close = vi.fn();
    function Harness() {
      const location = useLocation();
      return (
        <>
          <output data-testid="studio-route">{location.pathname + location.search}</output>
          <AgentDrawer open onOpenChange={close} />
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/tasks?focus=' + task.id]}>
        <Harness />
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText('向 AI 副驾驶提问'), { target: { value: '尚未发送的任务问题' } });
    fireEvent.click(screen.getByRole('link', { name: '在工作室打开' }));
    await waitFor(() => expect(screen.getByTestId('studio-route').textContent).toContain('/ai?'));
    const url = new URL(screen.getByTestId('studio-route').textContent!, 'https://local.test');
    expect(url.searchParams.get('scope')).toBe('task:' + task.id);
    const saved = readConversations('local').find((conversation) => conversation.id === url.searchParams.get('chat'));
    expect(saved?.draft).toBe('尚未发送的任务问题');
    expect(saved?.scope).toBe('task:' + task.id);
    expect(close).toHaveBeenCalledWith(false);
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it('多轮交接保留已经采纳的回执和新一轮待处理操作', async () => {
    const mutate = vi.fn(async (run: () => Promise<unknown>) => {
      await run();
      return true;
    });
    mocks.useData.mockReturnValue({ data: dataset(), mutate });
    mocks.loadAiConfig.mockReturnValue({ enabled: true, baseUrl: 'http://local.test/v1', apiKey: '', model: 'local' });
    mocks.aiChat
      .mockResolvedValueOnce('第一轮提议。\n```action\n{"action":"create_task","title":"交接已保存任务"}\n```')
      .mockResolvedValueOnce('第二轮提议。\n```action\n{"action":"create_task","title":"交接待处理任务"}\n```');
    function Harness() {
      const location = useLocation();
      return (
        <>
          <output data-testid="handoff-route">{location.pathname + location.search}</output>
          <AgentDrawer open onOpenChange={vi.fn()} initialQuestion="交接第一轮" />
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^采纳：/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 提议的动作' })).toBeNull());
    const input = screen.getByLabelText('向 AI 副驾驶提问');
    fireEvent.change(input, { target: { value: '交接第二轮' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    await screen.findByText('第二轮提议。');
    fireEvent.change(input, { target: { value: '交接后继续的草稿' } });
    fireEvent.click(screen.getByRole('link', { name: '在工作室打开' }));
    await waitFor(() => expect(screen.getByTestId('handoff-route').textContent).toContain('/ai?'));
    const url = new URL(screen.getByTestId('handoff-route').textContent!, 'http://local.test');
    const saved = readConversations('local').find((c) => c.id === url.searchParams.get('chat'))!;
    expect(saved.draft).toBe('交接后继续的草稿');
    expect(saved.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['交接第一轮', '交接第二轮']);
    expect(saved.batches).toHaveLength(2);
    expect(saved.batches[0].results[0]?.ok).toBe(true);
    expect(saved.batches[1].results[0]).toBeNull();
    expect((await loadDataset()).tasks.filter((t) => t.title.startsWith('交接'))).toHaveLength(1);
  });
});
