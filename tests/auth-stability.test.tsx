import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/state/AuthContext';

const mocks = vi.hoisted(() => ({
  api: { me: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn() },
  bootstrap: vi.fn(),
  detectMode: vi.fn(),
  startAutoRetry: vi.fn(),
  stopAutoRetry: vi.fn(),
  flushPendingSaves: vi.fn(),
  toast: vi.fn(),
  clearMirror: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('@/data/api.ts', () => ({ api: mocks.api }));
vi.mock('@/lib/ai', () => ({ setAiConfigOwner: vi.fn() }));
vi.mock('@/lib/pendingSaves', () => ({ flushPendingSaves: mocks.flushPendingSaves }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/data/sync.ts', () => ({
  bootstrap: mocks.bootstrap,
  detectMode: mocks.detectMode,
  startAutoRetry: mocks.startAutoRetry,
  stopAutoRetry: mocks.stopAutoRetry,
  installWriteCapture: vi.fn(),
  rememberedAccount: () => 'account-a',
  rememberedMode: () => 'server',
  setQueueOwner: vi.fn(),
  setMode: vi.fn(),
  countPending: vi.fn(),
  clearMirror: mocks.clearMirror,
  flush: mocks.flush,
}));

const user = { id: 'account-a', email: 'a@example.test', role: 'member', nickname: null };
let context: ReturnType<typeof useAuth>;
function Probe() {
  context = useAuth();
  return (
    <p>
      {context.phase}:{context.dataVersion}
    </p>
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detectMode.mockResolvedValue('server');
  mocks.bootstrap.mockReset();
  mocks.bootstrap.mockResolvedValue(undefined);
  mocks.api.me.mockReset();
  mocks.api.me.mockResolvedValue(user);
  mocks.api.login.mockResolvedValue({ user });
  mocks.api.signup.mockResolvedValue({ user });
  mocks.api.logout.mockResolvedValue({});
  mocks.flushPendingSaves.mockResolvedValue(true);
  mocks.clearMirror.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(true);
});
afterEach(cleanup);

describe('账号与镜像准备顺序', () => {
  it('首次连接等镜像准备好再显示已登录，避免先渲染空库', async () => {
    const pending = deferred();
    mocks.bootstrap.mockReturnValueOnce(pending.promise);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(1));
    expect(screen.getByText('checking:0')).toBeTruthy();
    await act(async () => pending.resolve());
    expect(screen.getByText('signed-in:1')).toBeTruthy();
  });

  it('登录提交在镜像完成前保留登录页，完成后才切换并通知数据更新', async () => {
    mocks.api.me.mockRejectedValueOnce({ status: 401 });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-out:0');
    const pending = deferred();
    mocks.bootstrap.mockReturnValueOnce(pending.promise);
    let result!: Promise<string | null>;
    await act(async () => {
      result = context.signIn(user.email, 'test-password');
    });
    expect(context.phase).toBe('signed-out');
    await act(async () => {
      pending.resolve();
      await result;
    });
    expect(screen.getByText('signed-in:1')).toBeTruthy();
  });

  it('离线自动恢复先完成镜像再更新版本，原离线页面保持到准备完成', async () => {
    mocks.api.me.mockRejectedValueOnce({ status: 503 });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('offline:0');
    const pending = deferred();
    mocks.bootstrap.mockReturnValueOnce(pending.promise);
    const recovered = mocks.startAutoRetry.mock.calls[0][0] as () => Promise<void>;
    let result!: Promise<void>;
    await act(async () => {
      result = recovered();
    });
    expect(context.phase).toBe('offline');
    expect(context.dataVersion).toBe(0);
    await act(async () => {
      pending.resolve();
      await result;
    });
    expect(screen.getByText('signed-in:1')).toBeTruthy();
  });

  it('组件卸载后停止自动重试，不让旧回调更新新会话', async () => {
    mocks.api.me.mockRejectedValueOnce({ status: 503 });
    const view = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('offline:0');
    const recovered = mocks.startAutoRetry.mock.calls[0][0] as () => Promise<void>;
    view.unmount();
    expect(mocks.stopAutoRetry).toHaveBeenCalledTimes(1);
    await recovered();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('恢复连接发现账号改变时先隐藏旧页面，镜像完成后才公开新身份', async () => {
    mocks.api.me.mockRejectedValueOnce({ status: 503 });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('offline:0');
    const pending = deferred();
    mocks.bootstrap.mockReturnValueOnce(pending.promise);
    mocks.api.me.mockResolvedValueOnce({ ...user, id: 'account-b' });
    const recovered = mocks.startAutoRetry.mock.calls[0][0] as () => Promise<void>;
    let result!: Promise<void>;
    await act(async () => {
      result = recovered();
    });
    expect(context.phase).toBe('checking');
    expect(context.user?.id).not.toBe('account-b');
    await act(async () => {
      pending.resolve();
      await result;
    });
    expect(context.phase).toBe('signed-in');
    expect(context.user?.id).toBe('account-b');
  });

  it('立即退出先等待未保存草稿，再屏蔽旧页面并注销会话', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-in:1');
    const saved = deferred();
    const logout = deferred();
    mocks.flushPendingSaves.mockReturnValueOnce(saved.promise.then(() => true));
    mocks.api.logout.mockReturnValueOnce(logout.promise);
    let result!: Promise<void>;
    await act(async () => {
      result = context.signOut();
    });
    expect(context.phase).toBe('signed-in');
    expect(mocks.api.logout).not.toHaveBeenCalled();
    await act(async () => saved.resolve());
    expect(context.phase).toBe('checking');
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(mocks.clearMirror).not.toHaveBeenCalled();
    await act(async () => {
      logout.resolve();
      await result;
    });
    expect(context.phase).toBe('signed-out');
    expect(mocks.clearMirror).toHaveBeenCalledTimes(1);
  });

  it('退出前保存失败则保留账号与编辑器，并提示重试', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-in:1');
    mocks.flushPendingSaves.mockResolvedValueOnce(false);
    await act(async () => context.signOut());
    expect(context.phase).toBe('signed-in');
    expect(context.user?.id).toBe('account-a');
    expect(mocks.api.logout).not.toHaveBeenCalled();
    expect(mocks.clearMirror).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '还有编辑未保存' }));
  });

  it('网络退出失败仍完成本地退出，不产生未处理的拒绝', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-in:1');
    mocks.api.logout.mockRejectedValueOnce(new Error('模拟断网'));
    await act(async () => context.signOut());
    expect(context.phase).toBe('signed-out');
    expect(context.user).toBeNull();
    expect(mocks.clearMirror).toHaveBeenCalledTimes(1);
  });
});
