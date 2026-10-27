import { describe, expect, it } from 'vitest';
import { parseDeconstruct, parsePlanner } from '@/features/agent/results';

describe('AI 结构化动作的输入校验', () => {
  const task = { title: '完成对照实验', daysFromNow: 3, priority: 'high' };
  const plan = (tasks: unknown[]) => JSON.stringify({ phases: [{ name: '验证', weeks: 'W1', tasks }] });
  it('只接受完整的文献结构，不对缺少字段的回答回填笔记', () => {
    expect(parseDeconstruct('{"motivation":"只有动机"}')).toBeNull();
    expect(
      parseDeconstruct(
        JSON.stringify({ motivation: '问题', methodology: '方法', baselines: '对照', limitations: '局限' }),
      ),
    ).toMatchObject({ methodology: '方法' });
  });
  it('拒绝缺失任务、非法优先级、非整数或过远日期', () => {
    expect(parsePlanner('{"phases":[{"name":"x"}]}')).toBeNull();
    expect(parsePlanner(plan([{ ...task, priority: 'invalid' }]))).toBeNull();
    expect(parsePlanner(plan([{ ...task, daysFromNow: 1.5 }]))).toBeNull();
    expect(parsePlanner(plan([{ ...task, daysFromNow: 10000 }]))).toBeNull();
  });
  it('拒绝重复标题，合法任务完整保留', () => {
    expect(parsePlanner(plan([task, task]))).toBeNull();
    expect(parsePlanner(plan([task]))?.[0].tasks).toEqual([task]);
  });
});
