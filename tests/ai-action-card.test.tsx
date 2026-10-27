import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionCard } from '@/features/ai/ActionCard';
import type { ActionPreview, AiAction } from '@/features/ai/actions';

afterEach(cleanup);
const action: AiAction = { action: 'create_task', title: '真实任务' };
const preview: ActionPreview = {
  valid: true,
  title: '新建任务',
  target: '当前课题',
  changes: [{ label: '标题', after: '真实任务' }],
  warnings: [],
};

describe('AI 操作确认卡', () => {
  it('保存过程中锁住采纳与关闭，快速点击只发出一次请求', async () => {
    let release: () => void = () => {};
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const dismiss = vi.fn();
    render(
      <MemoryRouter>
        <ActionCard actions={[action]} previews={[preview]} onAdopt={callback} onDismiss={dismiss} />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: '采纳：新建任务' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(callback).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: '忽略全部提议' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'AI 提议的动作' }).getAttribute('aria-busy')).toBe('true');
    release();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('失败原因保留可重试，成功结果禁用再次执行并可打开记录', async () => {
    const callback = vi.fn();
    const view = render(
      <MemoryRouter>
        <ActionCard
          actions={[action]}
          previews={[preview]}
          results={[{ ok: false, message: '暂时无法保存' }]}
          onAdopt={callback}
          onDismiss={() => {}}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '重试：新建任务' }));
    expect(callback).toHaveBeenCalledWith(action);
    await waitFor(() => expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false'));
    view.rerender(
      <MemoryRouter>
        <ActionCard
          actions={[action]}
          previews={[preview]}
          results={[{ ok: true, message: '已保存任务', href: '/tasks?focus=created' }]}
          onAdopt={callback}
          onDismiss={() => {}}
        />
      </MemoryRouter>,
    );
    const done = screen.getByRole('button', { name: '已执行：新建任务' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(screen.getByRole('link', { name: '查看记录' }).getAttribute('href')).toBe('/tasks?focus=created');
    fireEvent.click(done);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('意外的保存异常会显示错误并释放操作锁，允许用户重试', async () => {
    const callback = vi.fn().mockRejectedValueOnce(new Error('存储不可用')).mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <ActionCard actions={[action]} previews={[preview]} onAdopt={callback} onDismiss={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '采纳：新建任务' }));
    await waitFor(() => expect(screen.getByText('存储不可用')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '重试：新建任务' }));
    await waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
  });
});
