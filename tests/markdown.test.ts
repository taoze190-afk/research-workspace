import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';

describe('Markdown 渲染（公式与图片）', () => {
  it('行内公式渲染成 KaTeX，不改动周边文字', () => {
    const html = renderMarkdown('位移满足 $x^2 + y^2$ 即可');
    expect(html).toContain('katex');
    expect(html).toContain('即可');
    expect(html).not.toContain('$x^2');
  });

  it('$$..$$ 按显示模式渲染', () => {
    expect(renderMarkdown('$$E = mc^2$$')).toContain('katex-display');
  });

  it('「$5 和 $6」不是公式，按原样输出', () => {
    const html = renderMarkdown('预算 $5 和 $6 之间');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 和 $6');
  });

  it('代码块里的 $$ 不会被当成公式', () => {
    const html = renderMarkdown('```\n$$x^2$$\n```');
    expect(html).not.toContain('katex');
    expect(html).toContain('$$x^2$$');
  });

  it('data:image 的截图能进白名单，路径随 alt 属性保留', () => {
    const html = renderMarkdown('![截图](data:image/png;base64,AAAA)');
    expect(html).toContain('<img');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('危险内容照旧被剥掉：script、data:html 图片、javascript: 链接', () => {
    expect(renderMarkdown('<script>alert(1)</script>正文')).not.toContain('<script');
    const badImg = renderMarkdown('![x](data:text/html;base64,AAAA)');
    expect(badImg).not.toContain('data:text/html');
    expect(badImg).not.toContain('src=');
    expect(renderMarkdown('[点我](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('未知标签与坏公式不炸渲染', () => {
    expect(renderMarkdown('$\\badcmd{$')).toContain('katex-error');
    expect(renderMarkdown('普通文字')).toContain('普通文字');
  });
});
