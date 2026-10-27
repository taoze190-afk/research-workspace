import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { createProject, createTask, loadDataset } from '@/data/repo';
import { localToday } from '@/domain/date';

/** 冒烟：整棵组件树能在真实数据上渲染出来，工作台显示的是库里的内容而不是硬编码数字。 */
describe('应用渲染冒烟', () => {
  it('工作台读出真实数据，项目名与任务名都出现在页面上', async () => {
    const project = await createProject({ name: '腕臂式肌电采集装置', status: 'active', goal: '识别率不低于 90%' });
    await createTask({ title: '标定静息阈值', projectId: project.id, dueDate: localToday(), priority: 'urgent' });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // 同一个项目名会同时出现在任务行、项目卡和未来七天列表里，所以按「至少一处」断言。
    expect((await screen.findAllByText('腕臂式肌电采集装置')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('标定静息阈值').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: /工作台/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /今日待办/ }).querySelector('.stat-value')?.textContent).toBe('1');
    expect(screen.getByText('进行中项目')).toBeTruthy();
    expect(screen.getByRole('link', { name: /逾期/ })).toBeTruthy();

    const data = await loadDataset();
    expect(data.tasks).toHaveLength(1);
  });

  it('无效 ID 走友好返回入口而不是崩掉', async () => {
    render(
      <MemoryRouter initialEntries={['/experiments/does-not-exist']}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText('找不到这条实验记录')).toBeTruthy();
    expect(screen.getByRole('link', { name: /回到实验记录/ })).toBeTruthy();
  });
});
