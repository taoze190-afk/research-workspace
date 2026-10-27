import { describe, expect, it } from 'vitest';
import { citationTypeOf, toGbt7714 } from '@/lib/citation';
import { makeReference } from './factory';

describe('GB/T 7714 引用格式', () => {
  it('期刊条目：作者. 标题[J]. 刊名, 年份.', () => {
    const ref = makeReference({ title: '肌电信号研究', authors: '孙冉；郑也夫', year: 2021, venue: '示例嵌入式系统' });
    expect(toGbt7714(ref)).toBe('孙冉, 郑也夫. 肌电信号研究[J]. 示例嵌入式系统, 2021.');
  });

  it('会议出处用 [C]', () => {
    const ref = makeReference({ title: 'A Model', authors: 'Zhang San', year: 2023, venue: 'Proceedings of CVPR' });
    expect(citationTypeOf(ref)).toBe('C');
    expect(toGbt7714(ref)).toContain('[C].');
  });

  it('超过三位作者取前三加「等」', () => {
    const ref = makeReference({ title: 'T', authors: '甲；乙；丙；丁', year: 2020, venue: 'X' });
    expect(toGbt7714(ref)).toContain('甲, 乙, 丙, 等.');
  });

  it('缺字段就少写，绝不编造', () => {
    expect(toGbt7714(makeReference({ title: '只有标题', authors: '', year: null, venue: '' }))).toBe('只有标题[J].');
    expect(toGbt7714(makeReference({ title: '', authors: '', year: null, venue: '' }))).toBe('未命名条目[J].');
  });
});
