import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { DataProvider, useData } from '@/state/DataContext';
import type { Dataset } from '@/domain/types';
import { dataset, makeProject } from './factory';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadDataset: vi.fn(),
  toast: vi.fn(),
  flush: vi.fn(),
  getSyncState: vi.fn(),
}));
vi.mock('@/state/AuthContext', () => ({ useAuth: mocks.auth }));
vi.mock('@/data/repo', () => ({ loadDataset: mocks.loadDataset }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/data/sync.ts', () => ({
  flush: mocks.flush,
  getSyncState: mocks.getSyncState,
  rememberedAccount: () => 'account-a',
}));

const initial = dataset({ projects: [makeProject({ name: '账号 A 的项目' })] });
const nextAccount = dataset({ projects: [makeProject({ name: '账号 B 的项目' })] });
const updated = dataset({ projects: [makeProject({ name: '已更新项目' })] });
const frames: { account: string | null; status: string; names: string[] }[] = [];
let latestContext: ReturnType<typeof useData>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function auth(account = 'account-a', phase = 'signed-in', dataVersion = 1) {
  return { phase, user: phase === 'checking' || phase === 'signed-out' ? null : { id: account }, dataVersion };
}
function Probe() {
  const ctx = useData();
  latestContext = ctx;
  const [draft, setDraft] = useState('');
  frames.push({
    account: mocks.auth().user?.id ?? null,
    status: ctx.status,
    names: ctx.data.projects.map((p) => p.name),
  });
  return (
    <>
      <p data-testid="status">{ctx.status}</p>
      <p data-testid="projects">{ctx.data.projects.map((p) => p.name).join(',')}</p>
      <input aria-label="草稿" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => void ctx.refresh()}>刷新</button>
      <button onClick={() => void ctx.mutate(async () => {})}>保存</button>
    </>
  );
}
const tree = () => (
  <DataProvider>
    <Probe />
  </DataProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  frames.length = 0;
  mocks.auth.mockReturnValue(auth());
  mocks.flush.mockResolvedValue(true);
  mocks.getSyncState.mockReturnValue({ mode: 'local' });
  mocks.loadDataset.mockReset();
  mocks.loadDataset.mockResolvedValue(initial);
});
afterEach(cleanup);

describe('数据快照与页面稳定性', () => {
  it('身份检查中不读取镜像，首次快照完成前只暴露空数据和 loading', async () => {
    const pending = deferred<Dataset>();
    mocks.auth.mockReturnValue(auth('account-a', 'checking'));
    const view = render(tree());
    expect(mocks.loadDataset).not.toHaveBeenCalled();
    expect(screen.getByTestId('projects').textContent).toBe('');
    mocks.loadDataset.mockReturnValue(pending.promise);
    mocks.auth.mockReturnValue(auth());
    view.rerender(tree());
    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(screen.getByTestId('projects').textContent).toBe('');
    await act(async () => pending.resolve(initial));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('projects').textContent).toBe('账号 A 的项目');
  });

  it('切换账号首帧即隐藏旧数据，旧账号较晚完成的读取不能覆盖新账号', async () => {
    const stale = deferred<Dataset>();
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    mocks.loadDataset.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(nextAccount);
    fireEvent.click(screen.getByText('刷新'));
    const beforeSwitch = frames.length;
    mocks.auth.mockReturnValue(auth('account-b'));
    view.rerender(tree());
    expect(screen.getByTestId('projects').textContent).toBe('');
    await screen.findByText('账号 B 的项目');
    await act(async () => stale.resolve(initial));
    expect(screen.getByTestId('projects').textContent).toBe('账号 B 的项目');
    expect(
      frames
        .slice(beforeSwitch)
        .filter((frame) => frame.account === 'account-b')
        .every((frame) => !frame.names.includes('账号 A 的项目')),
    ).toBe(true);
  });

  it('退出账号的首帧不保留任何科研数据', async () => {
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    const beforeExit = frames.length;
    mocks.auth.mockReturnValue(auth('account-a', 'signed-out'));
    view.rerender(tree());
    expect(screen.getByTestId('projects').textContent).toBe('');
    expect(frames.slice(beforeExit).every((frame) => frame.names.length === 0)).toBe(true);
  });

  it('新账号读取失败时显示空数据与错误，不能回退到旧账号快照', async () => {
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    mocks.loadDataset.mockRejectedValueOnce(new Error('模拟读取失败'));
    mocks.auth.mockReturnValue(auth('account-b'));
    view.rerender(tree());
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('projects').textContent).toBe('');
  });

  it('普通保存期间保持 ready、输入内容和焦点，不挂载临时加载页', async () => {
    render(tree());
    await screen.findByText('账号 A 的项目');
    const pending = deferred<Dataset>();
    mocks.loadDataset.mockReturnValueOnce(pending.promise);
    const input = screen.getByRole('textbox', { name: '草稿' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '连续输入中的草稿' } });
    input.focus();
    const beforeSave = frames.length;
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mocks.loadDataset).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    await act(async () => pending.resolve(updated));
    expect(screen.getByTestId('projects').textContent).toBe('已更新项目');
    expect(input.value).toBe('连续输入中的草稿');
    expect(document.activeElement).toBe(input);
    expect(frames.slice(beforeSave).every((frame) => frame.status === 'ready')).toBe(true);
  });

  it('同账号服务端镜像更新后自动重读，刷新期间保留现有页面', async () => {
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    mocks.loadDataset.mockResolvedValueOnce(updated);
    const beforeRecovery = frames.length;
    mocks.auth.mockReturnValue(auth('account-a', 'signed-in', 2));
    view.rerender(tree());
    await screen.findByText('已更新项目');
    expect(mocks.loadDataset).toHaveBeenCalledTimes(2);
    expect(frames.slice(beforeRecovery).every((frame) => frame.status === 'ready')).toBe(true);
  });

  it('账号切换后调用旧编辑器 mutate 闭包时，不执行写库函数', async () => {
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    const staleMutate = latestContext.mutate;
    mocks.loadDataset.mockResolvedValueOnce(nextAccount);
    mocks.auth.mockReturnValue(auth('account-b'));
    view.rerender(tree());
    await screen.findByText('账号 B 的项目');
    const write = vi.fn(async () => {});
    let result = true;
    await act(async () => {
      result = await staleMutate(write, { success: '旧账号草稿已保存' });
    });
    expect(result).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.loadDataset).toHaveBeenCalledTimes(2);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByTestId('projects').textContent).toBe('账号 B 的项目');
  });

  it('旧写入等待期间切换账号，完成后不刷新或提示到新账号', async () => {
    const view = render(tree());
    await screen.findByText('账号 A 的项目');
    const staleMutate = latestContext.mutate;
    const write = deferred<void>();
    let result!: Promise<boolean>;
    await act(async () => {
      result = staleMutate(() => write.promise, { success: '不应出现的保存提示' });
    });
    mocks.loadDataset.mockResolvedValueOnce(nextAccount);
    mocks.auth.mockReturnValue(auth('account-b'));
    view.rerender(tree());
    await screen.findByText('账号 B 的项目');
    await act(async () => write.resolve());
    expect(await result).toBe(false);
    expect(mocks.loadDataset).toHaveBeenCalledTimes(2);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByTestId('projects').textContent).toBe('账号 B 的项目');
  });

  it('本地保存成功而上传失败仍返回成功，并明确提示待同步', async () => {
    render(tree());
    await screen.findByText('账号 A 的项目');
    mocks.getSyncState.mockReturnValue({ mode: 'server', lastError: '模拟离线' });
    mocks.flush.mockResolvedValueOnce(false);
    const write = vi.fn(async () => {});
    let result = false;
    await act(async () => {
      result = await latestContext.mutate(write);
    });
    expect(result).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '还没同步到服务器' }));
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it('实际写库失败仍返回失败，不把未保存内容当作成功', async () => {
    render(tree());
    await screen.findByText('账号 A 的项目');
    mocks.getSyncState.mockReturnValue({ mode: 'server' });
    let result = true;
    await act(async () => {
      result = await latestContext.mutate(async () => {
        throw new Error('模拟磁盘写入失败');
      });
    });
    expect(result).toBe(false);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.loadDataset).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '保存失败' }));
  });
});
