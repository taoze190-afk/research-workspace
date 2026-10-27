import { describe, expect, it } from 'vitest';
import { resolveAgentTarget } from '@/features/agent/target';
import { dataset, makeExperiment, makeProject, makeReference, makeTask } from './factory';
import { MAX_CONTEXT_CHARS } from '@/features/ai/context';

describe('AI 副驾驶上下文解析', () => {
  const project = makeProject({ name: '肌电课题', question: '边缘部署的瓶颈？', goal: '确定切入点' });
  const reference = makeReference({ title: '边缘端肌电综述', noteQuestion: '算力还是功耗？' });
  const experiment = makeExperiment({ title: '基线复现', purpose: '验证流程', results: 'mAP=0.512' });
  const task = makeTask({ title: '复现主表', description: '含数据准备' });
  const data = dataset({ projects: [project], references: [reference], experiments: [experiment], tasks: [task] });

  it('文献详情：聚焦参数带出笔记内容', () => {
    const t = resolveAgentTarget('/library', `?focus=${reference.id}`, data);
    expect(t.kind).toBe('reference');
    expect(t.label).toBe('边缘端肌电综述');
    expect(t.content).toContain('算力还是功耗？');
    expect(t.content).not.toContain('（还没有笔记）');
  });

  it('实验详情：带出全部结构化字段与来源', () => {
    const e2 = makeExperiment({ title: '含来源', dataSources: [{ id: 'd1', kind: 'param', label: 'lr=0.01' }] });
    const t = resolveAgentTarget(`/experiments/${e2.id}`, '', { ...data, experiments: [experiment, e2] });
    expect(t.kind).toBe('experiment');
    expect(t.content).toContain('lr=0.01');
    expect(JSON.parse(t.content).record.purpose).toBe('');
  });

  it('项目详情：带出任务列表与进度', () => {
    const t = resolveAgentTarget(`/projects/${project.id}`, '', {
      ...data,
      tasks: [makeTask({ title: '复现主表', projectId: project.id, status: 'done' })],
    });
    expect(t.kind).toBe('project');
    expect(t.content).toContain('复现主表');
    expect(JSON.parse(t.content).tasks[0].status).toBe('done');
    expect(JSON.parse(t.content).record.id).toBe(project.id);
  });

  it('任务聚焦与其他页面落到工作台概况', () => {
    const t1 = resolveAgentTarget('/tasks', `?focus=${task.id}`, data);
    expect(t1.kind).toBe('task');
    expect(t1.content).toContain('含数据准备');
    const t2 = resolveAgentTarget('/settings', '', data);
    expect(t2.kind).toBe('workspace');
    expect(JSON.parse(t2.content).counts.references).toBe(1);
  });

  it('超长内容截断并注明', () => {
    const long = makeExperiment({ method: 'x'.repeat(6000) });
    const t = resolveAgentTarget(`/experiments/${long.id}`, '', { ...data, experiments: [long] });
    expect(t.content.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(JSON.parse(t.content).truncated).toBe(true);
  });

  it('工作室明确不附带资料时，副驾驶也不读取整个工作区', () => {
    const target = resolveAgentTarget('/ai', '?scope=none', data);
    expect(target.content).toBe('');
    expect(target.id).toBeNull();
  });

  it('工作室选定资料与业务页使用同一准确目标', () => {
    const target = resolveAgentTarget('/ai', `?scope=task:${task.id}`, data);
    expect(target.kind).toBe('task');
    expect(target.id).toBe(task.id);
    expect(JSON.parse(target.content).record.description).toBe('含数据准备');
  });
});
