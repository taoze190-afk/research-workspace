import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '@/app/App';
import * as repo from '@/data/repo';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function RouteProbe() {
  const location = useLocation();
  return <output aria-label="当前测试路由">{location.pathname + location.search}</output>;
}
function open(route: string) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <RouteProbe />
    </MemoryRouter>,
  );
}
function currentRoute() {
  return new URL(screen.getByLabelText('当前测试路由').textContent!, 'https://local.test');
}
async function expectStudio(scope: string, label: string, prompt: string) {
  await screen.findByRole('button', { name: '研究范围：' + label });
  const draft = await screen.findByLabelText('向 AI 提问');
  await waitFor(() => expect((draft as HTMLTextAreaElement).value).toContain(prompt));
  fireEvent.click(screen.getByRole('button', { name: '资料与模型' }));
  const select = await screen.findByLabelText('研究范围');
  expect((select as HTMLSelectElement).value).toBe(scope);
}

describe('业务记录进入 AI 工作室', () => {
  it('项目入口携带准确资料 ID 与可执行的项目问题', async () => {
    const project = await repo.createProject({ name: '需要 AI 协助的项目' });
    open(`/projects/${project.id}`);
    const link = await screen.findByRole('link', { name: 'AI 协助' });
    const entry = new URL(link.getAttribute('href')!, 'https://local.test');
    expect(entry.searchParams.get('scope')).toBe(`project:${project.id}`);
    expect(entry.searchParams.get('prompt')).toContain('里程碑');
    fireEvent.click(link);
    await expectStudio(`project:${project.id}`, project.name, '里程碑');
  });
  it('实验入口先保存刚输入的内容再进入 AI', async () => {
    const experiment = await repo.createExperiment({ title: '正在编辑的实验' });
    open(`/experiments/${experiment.id}`);
    fireEvent.change(await screen.findByLabelText('方法与步骤'), { target: { value: '进入 AI 前刚输入的方法' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 协助' }));
    await expectStudio(`experiment:${experiment.id}`, experiment.title, '这条实验');
    expect((await repo.loadDataset()).experiments.find((row) => row.id === experiment.id)?.method).toBe(
      '进入 AI 前刚输入的方法',
    );
  });
  it('文献入口先保存新笔记，再带入文献 ID', async () => {
    const reference = await repo.createReference({ title: '正在编辑的文献' });
    open(`/library?focus=${reference.id}`);
    fireEvent.change(await screen.findByLabelText('研究问题'), { target: { value: '进入 AI 前刚输入的问题' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 协助整理文献' }));
    await expectStudio(`reference:${reference.id}`, reference.title, '这篇文献');
    expect((await repo.loadDataset()).references.find((row) => row.id === reference.id)?.noteQuestion).toBe(
      '进入 AI 前刚输入的问题',
    );
  });
  it('文献保存失败时保留当前编辑器与草稿，不进入 AI', async () => {
    const reference = await repo.createReference({ title: '保存失败的文献' });
    open(`/library?focus=${reference.id}`);
    fireEvent.change(await screen.findByLabelText('研究问题'), { target: { value: '需要保留的草稿' } });
    vi.spyOn(repo, 'updateReference').mockRejectedValue(new Error('模拟存储失败'));
    fireEvent.click(screen.getByRole('button', { name: 'AI 协助整理文献' }));
    await screen.findByRole('button', { name: '保存失败，重试' });
    expect(currentRoute().pathname).toBe('/library');
    expect((screen.getByLabelText('研究问题') as HTMLTextAreaElement).value).toBe('需要保留的草稿');
  });
  it('任务入口先保存标题，并携带所选任务而不是只带项目', async () => {
    const task = await repo.createTask({ title: '待拆分的任务' });
    open(`/tasks?filter=all&focus=${task.id}`);
    fireEvent.change(await screen.findByLabelText('任务标题'), { target: { value: '刚修改的任务标题' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 协助' }));
    await expectStudio(`task:${task.id}`, '刚修改的任务标题', '这条任务');
    expect((await repo.loadDataset()).tasks.find((row) => row.id === task.id)?.title).toBe('刚修改的任务标题');
  });
});
