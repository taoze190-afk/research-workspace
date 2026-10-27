import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/ui/toast';
afterEach(cleanup);
function Harness({ undo }: { undo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast({ title: '文件已保存', tone: 'success' })}>保存文件</button>
      <button onClick={() => toast({ title: '压缩包已准备好', tone: 'success' })}>打包文件</button>
      <button onClick={() => toast({ title: '任务已完成', action: { label: '撤销', onClick: undo } })}>完成任务</button>
    </>
  );
}
describe('操作通知', () => {
  it('新的普通成功提示替换旧提示，避免连续操作堆叠遮挡界面', async () => {
    render(
      <ToastProvider>
        <Harness undo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存文件' }));
    const notifications = await screen.findByRole('region', { name: '操作通知' });
    expect(await within(notifications).findByText('文件已保存')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打包文件' }));
    expect(await within(notifications).findByText('压缩包已准备好')).toBeTruthy();
    expect(within(notifications).queryByText('文件已保存')).toBeNull();
  });
  it('普通成功提示不会移除仍可撤销的操作', async () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Harness undo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '完成任务' }));
    const notifications = await screen.findByRole('region', { name: '操作通知' });
    fireEvent.click(screen.getByRole('button', { name: '打包文件' }));
    expect(await within(notifications).findByText('任务已完成')).toBeTruthy();
    fireEvent.click(within(notifications).getByRole('button', { name: '撤销' }));
    expect(undo).toHaveBeenCalledOnce();
  });
});
