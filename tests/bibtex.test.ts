import { describe, expect, it } from 'vitest';
import { toBibtex } from '@/lib/bibtex';
import { makeReference } from './factory';

describe('BibTeX 导出', () => {
  it('空库导出空文本', () => {
    expect(toBibtex([])).toBe('');
  });

  it('期刊条目：作者、标题、期刊、年份、DOI 都在', () => {
    const bib = toBibtex([
      makeReference({ title: 'Deep learning for EMG decoding', authors: 'Zhang San；Li Si', year: 2024, venue: 'Journal of Neuroengineering', doi: '10.1/xyz', url: 'https://example.com' }),
    ]);
    expect(bib).toContain('@article{zhangsan2024deep,');
    expect(bib).toContain('author = {{Zhang San} and {Li Si}}');
    expect(bib).toContain('title = {Deep learning for EMG decoding}');
    expect(bib).toContain('journal = {Journal of Neuroengineering}');
    expect(bib).toContain('year = {2024}');
    expect(bib).toContain('doi = {10.1/xyz}');
    expect(bib).toContain('url = {https://example.com}');
  });

  it('出处带会议特征词就走 @inproceedings + booktitle', () => {
    const bib = toBibtex([makeReference({ title: 'A Model', authors: '', year: 2023, venue: 'Proceedings of the CVPR' })]);
    expect(bib).toContain('@inproceedings{');
    expect(bib).toContain('booktitle = {Proceedings of the CVPR}');
    expect(bib).not.toContain('journal =');
  });

  it('同名同年的第二条 key 加后缀，不撞车', () => {
    const bib = toBibtex([
      makeReference({ title: 'Deep EMG', authors: 'Wang Wu', year: 2024 }),
      makeReference({ title: 'Deep EMG', authors: 'Wang Wu', year: 2024 }),
    ]);
    expect(bib).toContain('{wangwu2024deep,');
    expect(bib).toContain('{wangwu2024deepa,');
  });

  it('中文作者与中文标题也能成 key（退回 ref 前缀）', () => {
    const bib = toBibtex([makeReference({ title: '肌电信号研究', authors: '孙冉', year: 2024 })]);
    expect(bib).toContain('@article{ref2024,');
    expect(bib).toContain('author = {{孙冉}}');
    expect(bib).toContain('title = {肌电信号研究}');
  });

  it('值里的花括号被剥掉，输出保持配平', () => {
    const bib = toBibtex([makeReference({ title: 'On {L}atex Tricks', year: 2020 })]);
    expect((bib.match(/\{/g) ?? []).length).toBe((bib.match(/\}/g) ?? []).length);
    expect(bib).toContain('title = {On Latex Tricks}');
  });

  it('软删除的条目不导出', () => {
    const bib = toBibtex([makeReference({ title: '已删除', deletedAt: 1 }), makeReference({ title: '还在', year: 2021 })]);
    expect(bib).not.toContain('已删除');
    expect(bib).toContain('还在');
  });
});
