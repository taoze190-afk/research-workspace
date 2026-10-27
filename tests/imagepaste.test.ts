import { describe, expect, it } from 'vitest';
import { insertImageAtCursor, markdownImageToken } from '@/lib/imagePaste';

describe('截图插入', () => {
  const md = markdownImageToken('data:image/png;base64,AAAA', '截图 2026-10-24');

  it('图片标记的形状', () => {
    expect(md).toBe('![截图 2026-10-24](data:image/png;base64,AAAA)');
  });

  it('粘在段落中间时先补一个空行，不黏住上一段', () => {
    const r = insertImageAtCursor('上一段文字', md, 5);
    expect(r.text).toBe('上一段文字\n\n' + md);
    expect(r.cursor).toBe(5 + 2 + md.length);
  });

  it('紧跟换行后不再补行', () => {
    expect(insertImageAtCursor('第一行\n', md, 4).text).toBe('第一行\n' + md);
    expect(insertImageAtCursor('', md, 0).text).toBe(md);
  });

  it('替换选区：图永远另起一行，光标落在插入内容之后', () => {
    const r = insertImageAtCursor('前[选中]后', md, 1, 5);
    expect(r.text).toBe('前\n\n' + md + '后');
    expect(r.cursor).toBe(1 + 2 + md.length);
  });
});
