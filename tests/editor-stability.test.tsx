import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { TaskDrawer } from '@/features/tasks/TaskDrawer';
import { LibraryPage } from '@/features/library/LibraryPage';
import { ExperimentDetailPage } from '@/features/experiments/ExperimentDetailPage';
import { flushPendingSaves } from '@/lib/pendingSaves';
import { dataset, makeExperiment, makeReference, makeTask } from './factory';

const mocks = vi.hoisted(() => ({
  useData: vi.fn(),
  updateTask: vi.fn(),
  updateReference: vi.fn(),
  updateExperiment: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/state/DataContext', () => ({ useData: mocks.useData }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/data/repo', async (original) => ({
  ...(await original<typeof import('@/data/repo')>()),
  updateTask: mocks.updateTask,
  updateReference: mocks.updateReference,
  updateExperiment: mocks.updateExperiment,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const mock of [mocks.updateTask, mocks.updateReference, mocks.updateExperiment])
    mock.mockResolvedValue(undefined);
  mocks.useData.mockReturnValue({
    data: dataset(),
    status: 'ready',
    mutate: async (fn: () => Promise<unknown>) => {
      await fn();
      return true;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('业务编辑的记录与焦点稳定性', () => {
  it('退出前提交正在编辑的任务，不必等待防抖定时器', async () => {
    const task = makeTask({ id: 'task-before-logout', title: '原标题', description: '' });
    const view = render(
      <MemoryRouter>
        <TaskDrawer task={task} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '退出前标题' } });
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '退出前说明' } });
    expect(mocks.updateTask).not.toHaveBeenCalled();
    await act(async () => {
      expect(await flushPendingSaves()).toBe(true);
    });
    expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith(task.id, {
      title: '退出前标题',
      description: '退出前说明',
    });
    await act(async () => view.unmount());
    expect(await flushPendingSaves()).toBe(true);
    expect(mocks.updateTask).toHaveBeenCalledTimes(1);
  });

  it('关闭任务时保存失败会保留抽屉和草稿，允许重试后关闭', async () => {
    const task = makeTask({ id: 'task-failure', title: '待修改' });
    const onOpenChange = vi.fn();
    mocks.updateTask.mockRejectedValueOnce(new Error('模拟本地写入失败'));
    mocks.useData.mockReturnValue({
      data: dataset(),
      status: 'ready',
      mutate: async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return true;
        } catch {
          return false;
        }
      },
    });
    render(
      <MemoryRouter>
        <TaskDrawer task={task} open onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '需要保留的标题' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭' })));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '任务标题' }) as HTMLInputElement).value).toBe('需要保留的标题');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存失败，点此重试' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭' })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('快速修改任务标题与描述后立即关闭，完整草稿仍写入原任务', async () => {
    const task = makeTask({ id: 'task-a', title: '原标题', description: '原说明' });
    const view = render(
      <MemoryRouter>
        <TaskDrawer task={task} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '更新标题' } });
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '更新说明' } });
    await act(async () =>
      view.rerender(
        <MemoryRouter>
          <TaskDrawer task={null} open={false} onOpenChange={() => {}} />
        </MemoryRouter>,
      ),
    );
    expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith(task.id, { title: '更新标题', description: '更新说明' });
  });

  it('换任务不会闪现旧草稿，尚未保存的内容仅提交原任务', async () => {
    const first = makeTask({ id: 'task-a', title: '任务 A' });
    const second = makeTask({ id: 'task-b', title: '任务 B', description: 'B 的说明' });
    const view = render(
      <MemoryRouter>
        <TaskDrawer task={first} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: 'A 的未保存修改' } });
    await act(async () =>
      view.rerender(
        <MemoryRouter>
          <TaskDrawer task={second} open onOpenChange={() => {}} />
        </MemoryRouter>,
      ),
    );
    expect((screen.getByRole('textbox', { name: '任务标题' }) as HTMLInputElement).value).toBe(second.title);
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe(second.description);
    expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith(first.id, { title: 'A 的未保存修改', description: '' });
  });

  it('切换文献保存原笔记且不把旧笔记写给新文献，双击输入区不切换布局', async () => {
    const first = makeReference({ id: 'ref-a', title: '文献 A', noteQuestion: 'A 的原问题' });
    const second = makeReference({ id: 'ref-b', title: '文献 B', noteQuestion: 'B 的原问题' });
    mocks.useData.mockReturnValue({
      data: dataset({ references: [first, second] }),
      status: 'ready',
      mutate: async (fn: () => Promise<unknown>) => {
        await fn();
        return true;
      },
    });
    render(
      <MemoryRouter initialEntries={['/library?focus=ref-a']}>
        <LibraryPage />
      </MemoryRouter>,
    );
    const input = screen.getByRole('textbox', { name: '研究问题' });
    const focusMode = vi.fn();
    window.addEventListener('rw:focus-mode', focusMode);
    fireEvent.doubleClick(input);
    expect(focusMode).not.toHaveBeenCalled();
    window.removeEventListener('rw:focus-mode', focusMode);
    fireEvent.change(input, { target: { value: 'A 的未保存笔记' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /文献 B/ })));
    expect((screen.getByRole('textbox', { name: '研究问题' }) as HTMLTextAreaElement).value).toBe(second.noteQuestion);
    expect(mocks.updateReference).toHaveBeenCalledExactlyOnceWith(
      first.id,
      expect.objectContaining({ noteQuestion: 'A 的未保存笔记' }),
    );
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(mocks.updateReference).toHaveBeenCalledTimes(1);
  });

  it('切换实验立即显示新记录，离开前的草稿只写回原实验', async () => {
    const first = makeExperiment({ id: 'exp-a', title: '实验 A', purpose: 'A 的目的' });
    const second = makeExperiment({ id: 'exp-b', title: '实验 B', purpose: 'B 的目的' });
    mocks.useData.mockReturnValue({
      data: dataset({ experiments: [first, second] }),
      status: 'ready',
      mutate: async (fn: () => Promise<unknown>) => {
        await fn();
        return true;
      },
    });
    function Navigation() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/experiments/exp-b')}>切换到 B</button>;
    }
    render(
      <MemoryRouter initialEntries={['/experiments/exp-a']}>
        <Navigation />
        <Routes>
          <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '目的' }), { target: { value: 'A 的未保存目的' } });
    const focusMode = vi.fn();
    window.addEventListener('rw:focus-mode', focusMode);
    fireEvent.doubleClick(screen.getByRole('textbox', { name: '目的' }));
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    fireEvent.doubleClick(screen.getByText('A 的未保存目的'));
    expect(focusMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    window.removeEventListener('rw:focus-mode', focusMode);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '切换到 B' })));
    expect((screen.getByRole('textbox', { name: '实验标题' }) as HTMLInputElement).value).toBe(second.title);
    expect((screen.getByRole('textbox', { name: '目的' }) as HTMLTextAreaElement).value).toBe(second.purpose);
    expect(mocks.updateExperiment).toHaveBeenCalledExactlyOnceWith(
      first.id,
      expect.objectContaining({ purpose: 'A 的未保存目的' }),
    );
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(mocks.updateExperiment).toHaveBeenCalledTimes(1);
  });
});
