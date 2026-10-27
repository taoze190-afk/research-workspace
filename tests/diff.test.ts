import { describe, expect, it } from 'vitest';
import { changedFields, compactDiff, diffLines } from '@/domain/diff';

describe('行级 diff', () => {
  it('相同文本全是 same', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(rows.every((r) => r.type === 'same')).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('修改一行 = 一删一增，位置对齐', () => {
    const rows = diffLines('第一行\n第二行\n第三行', '第一行\n改过的第二行\n第三行');
    expect(rows).toEqual([
      { type: 'same', text: '第一行' },
      { type: 'del', text: '第二行' },
      { type: 'add', text: '改过的第二行' },
      { type: 'same', text: '第三行' },
    ]);
  });

  it('新增与删除在末尾也能收干净', () => {
    expect(diffLines('a\nb', 'a\nb\nc').at(-1)).toEqual({ type: 'add', text: 'c' });
    expect(diffLines('a\nb\nc', 'a\nb').at(-1)).toEqual({ type: 'del', text: 'c' });
    expect(diffLines('', '新内容')).toEqual([{ type: 'add', text: '新内容' }]);
    expect(diffLines('旧内容', '')).toEqual([{ type: 'del', text: '旧内容' }]);
  });

  it('\\r\\n 先归一成 \\n 再比', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((r) => r.type === 'same')).toBe(true);
  });

  it('compactDiff 只留变化处上下各一行，中间折成 gap', () => {
    const rows = diffLines('1\n2\n3\n4\n5\n6\n7', '1\n2\n三\n4\n5\n六\n7');
    const out = compactDiff(rows);
    expect(out.some((r) => r.type === 'gap')).toBe(true);
    const texts = out.map((r) => ('text' in r ? r.text : `gap:${r.count}`));
    expect(texts).toEqual(['gap:1', '2', '3', '三', '4', '5', '6', '六', '7']);
  });

  it('changedFields 按 trim 后比较挑出有变化的字段', () => {
    expect(changedFields([['purpose', ' 一样 ', '一样'], ['method', 'a', 'b'], ['results', '', '']])).toEqual(['method']);
  });
});
