import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { createProject, createReference, linkReferenceProject, unlinkReferenceProject, loadDataset } from '@/data/repo';

afterEach(cleanup);

function openLibrary(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe('文献筛选回归', () => {
  it('编辑笔记后切换项目，退出旧文献并保留未防抖保存的笔记', async () => {
    const a = await createProject({ name: '当前课题' });
    const b = await createProject({ name: '另一个课题' });
    const first = await createReference({ title: '正在编辑的文献' });
    const second = await createReference({ title: '另一个课题的文献' });
    await linkReferenceProject(first.id, a.id);
    await linkReferenceProject(second.id, b.id);
    openLibrary(`/library?project=${a.id}&focus=${first.id}`);
    const detail = await screen.findByRole('region', { name: '文献详情' });
    fireEvent.change(within(detail).getByLabelText('研究问题'), { target: { value: '切换筛选前刚写的研究问题' } });
    fireEvent.change(screen.getByLabelText('按关联项目筛选'), { target: { value: b.id } });
    await waitFor(() => expect(screen.queryByRole('region', { name: '文献详情' })).toBeNull());
    const catalog = screen.getByRole('region', { name: '文献索引' });
    expect(within(catalog).getByText('另一个课题的文献')).toBeTruthy();
    await waitFor(async () =>
      expect((await loadDataset()).references.find((r) => r.id === first.id)?.noteQuestion).toBe(
        '切换筛选前刚写的研究问题',
      ),
    );
  });
  it('按项目筛选只显示仍然关联的文献，切换项目后更新结果', async () => {
    const a = await createProject({ name: '肌电课题' });
    const b = await createProject({ name: '轨迹课题' });
    const first = await createReference({ title: '肌电特征提取' });
    const second = await createReference({ title: '运动轨迹分析' });
    const removed = await createReference({ title: '已解除的关联文献' });
    await linkReferenceProject(first.id, a.id);
    await linkReferenceProject(second.id, b.id);
    await linkReferenceProject(removed.id, a.id);
    await unlinkReferenceProject(removed.id, a.id);
    openLibrary(`/library?project=${a.id}`);
    const catalog = await screen.findByRole('region', { name: '文献索引' });
    expect(await within(catalog).findByText('肌电特征提取')).toBeTruthy();
    expect(within(catalog).queryByText('运动轨迹分析')).toBeNull();
    expect(within(catalog).queryByText('已解除的关联文献')).toBeNull();
    fireEvent.change(screen.getByLabelText('按关联项目筛选'), { target: { value: b.id } });
    await waitFor(() => expect(within(catalog).getByText('运动轨迹分析')).toBeTruthy());
    expect(within(catalog).queryByText('肌电特征提取')).toBeNull();
  });

  it('工作台待读统计入口包含待读与阅读中，排除已读', async () => {
    await createReference({ title: '尚未阅读的文献', readingStatus: 'unread' });
    await createReference({ title: '正在阅读的文献', readingStatus: 'reading' });
    await createReference({ title: '已经读完的文献', readingStatus: 'read' });
    openLibrary('/');
    const overview = await screen.findByRole('navigation', { name: '概览' });
    fireEvent.click(within(overview).getByRole('link', { name: /待读文献/ }));
    const main = await screen.findByRole('main');
    await waitFor(() => expect(within(main).getByLabelText('按阅读状态筛选')).toBeTruthy());
    const catalog = within(main).getByRole('region', { name: '文献索引' });
    expect(within(catalog).getByText('尚未阅读的文献')).toBeTruthy();
    expect(within(catalog).getByText('正在阅读的文献')).toBeTruthy();
    expect(within(catalog).queryByText('已经读完的文献')).toBeNull();
  });
});
