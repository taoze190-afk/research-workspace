import { describe, expect, it } from 'vitest';
import { crossrefToMetadata } from '@/lib/doi';

const message = {
  title: ['A Study of EMG Decoding'],
  author: [
    { family: 'Zhang', given: 'San' },
    { family: '孙', given: '冉' },
    { name: 'Research Collective' },
  ],
  issued: { 'date-parts': [[2024, 3]] },
  'container-title': ['J Neuroeng Rehabil'],
  resource: { primary: { URL: 'https://doi.org/10.1/xyz' } },
};

describe('Crossref 元数据映射', () => {
  it('西文名「名 姓」，中文名连写不空格，机构名单独成段', () => {
    const meta = crossrefToMetadata(message);
    expect(meta).toEqual({
      title: 'A Study of EMG Decoding',
      authors: 'San Zhang；孙冉；Research Collective',
      year: 2024,
      venue: 'J Neuroeng Rehabil',
      url: 'https://doi.org/10.1/xyz',
    });
  });

  it('没有标题就视为失败，不返回半条', () => {
    expect(crossrefToMetadata({ author: [{ family: 'Zhang' }] })).toBeNull();
    expect(crossrefToMetadata(null)).toBeNull();
    expect(crossrefToMetadata('nope')).toBeNull();
  });

  it('缺年份、缺出处、缺链接各自留空', () => {
    const meta = crossrefToMetadata({ title: ['Only Title'] });
    expect(meta).toEqual({ title: 'Only Title', authors: '', year: null, venue: '', url: '' });
  });
});
