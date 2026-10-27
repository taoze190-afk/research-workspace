import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/domain/quickAdd';
import type { Project } from '@/domain/types';
import { makeProject } from './factory';

const TODAY = '2026-10-24'; // 周六

const projects: Project[] = [makeProject({ name: '腕臂式肌电信号采集装置' }), makeProject({ name: '挥拍前肌电轨迹分析' })];

describe('快速添加解析', () => {
  it('纯标题：不动日期、优先级和项目', () => {
    const r = parseQuickAdd('重跑受试者数据', projects, TODAY);
    expect(r).toEqual({ title: '重跑受试者数据', dueDate: null, priority: 'medium', projectId: null });
  });

  it('!优先级 被吃掉，剩下的进标题', () => {
    expect(parseQuickAdd('!紧急 检查数据', projects, TODAY).priority).toBe('urgent');
    expect(parseQuickAdd('补录 !低', projects, TODAY)).toMatchObject({ title: '补录', priority: 'low' });
    expect(parseQuickAdd('!超高 危', projects, TODAY).title).toBe('!超高 危');
  });

  it('#项目 精确命中，前缀也能命中', () => {
    expect(parseQuickAdd('#挥拍前肌电轨迹分析 整理', projects, TODAY).projectId).toBe(projects[1].id);
    expect(parseQuickAdd('#腕臂式 补录', projects, TODAY).projectId).toBe(projects[0].id);
  });

  it('@项目 同样命中；#打中优先级词时优先当优先级', () => {
    expect(parseQuickAdd('@腕臂式 补录', projects, TODAY).projectId).toBe(projects[0].id);
    expect(parseQuickAdd('补录 @挥拍 !低', projects, TODAY)).toMatchObject({ projectId: projects[1].id, priority: 'low' });
    expect(parseQuickAdd('补录 #高', projects, TODAY)).toMatchObject({ priority: 'high', projectId: null });
  });

  it('#打不中的标签留在标题里，不吞词', () => {
    const r = parseQuickAdd('#不存在 补录', projects, TODAY);
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('#不存在 补录');
  });

  it('今天/明天/后天/大后天', () => {
    expect(parseQuickAdd('今天 交表', projects, TODAY).dueDate).toBe('2026-10-24');
    expect(parseQuickAdd('明天 交表', projects, TODAY).dueDate).toBe('2026-10-25');
    expect(parseQuickAdd('后天 交表', projects, TODAY).dueDate).toBe('2026-10-26');
    expect(parseQuickAdd('大后天 交表', projects, TODAY).dueDate).toBe('2026-10-27');
  });

  it('周X 指下一次出现（含今天），下周X 指下一周', () => {
    expect(parseQuickAdd('周日 复盘', projects, TODAY).dueDate).toBe('2026-10-25');
    expect(parseQuickAdd('周一 复盘', projects, TODAY).dueDate).toBe('2026-10-26');
    expect(parseQuickAdd('下周三 组会', projects, TODAY).dueDate).toBe('2026-11-04');
    expect(parseQuickAdd('下下周一 组会', projects, TODAY).dueDate).toBe('2026-11-09');
    expect(parseQuickAdd('周五 交开题', projects, TODAY).dueDate).toBe('2026-10-30');
  });

  it('月日缺年份：今年的，过了就顺延一年', () => {
    expect(parseQuickAdd('11月3日 申报', projects, TODAY).dueDate).toBe('2026-11-03');
    expect(parseQuickAdd('1月5日 申报', projects, TODAY).dueDate).toBe('2027-01-05');
    expect(parseQuickAdd('10-30 申报', projects, TODAY).dueDate).toBe('2026-10-30');
    expect(parseQuickAdd('12/1 申报', projects, TODAY).dueDate).toBe('2026-12-01');
  });

  it('完整年月日原样接受，不存在的日期不算日期', () => {
    expect(parseQuickAdd('2027-02-14 旅行', projects, TODAY).dueDate).toBe('2027-02-14');
    const bad = parseQuickAdd('2月30日 旅行', projects, TODAY);
    expect(bad.dueDate).toBeNull();
    expect(bad.title).toBe('2月30日 旅行');
  });

  it('一句话里四样全有', () => {
    const r = parseQuickAdd('周五 交开题报告 #挥拍 !高', projects, TODAY);
    expect(r).toEqual({ title: '交开题报告', dueDate: '2026-10-30', priority: 'high', projectId: projects[1].id });
  });

  it('只有日期没有标题：标题为空，由调用方兜底', () => {
    expect(parseQuickAdd('明天', projects, TODAY).title).toBe('');
  });
});
