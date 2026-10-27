import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { safeHref } from './url';

marked.setOptions({ gfm: true, breaks: false });

// 链接仍走协议白名单；图片额外放行 data:image（粘贴的截图以 data URL 存在正文里）
const URI_SAFE = /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = safeHref(node.getAttribute('href') ?? '');
    if (!href) {
      node.removeAttribute('href');
    } else {
      node.setAttribute('href', href);
      node.setAttribute('rel', 'noreferrer noopener');
      node.setAttribute('target', '_blank');
    }
  }
  // DOMPurify 对 img 的 data: src 默认放行（不限类型），这里自己收口：只留 https 与 data:image
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src');
    if (src !== null && !/^(https?:|data:image\/(?:png|jpe?g|gif|webp);)/i.test(src)) node.removeAttribute('src');
    node.removeAttribute('srcset');
  }
});

/** 公式与代码的占位符：私有区字符，正常输入里不会出现。 */
const token = (kind: string, n: number) => `\uE000${kind}${n}\uE001`;
const MATH_TOKEN_RE = /\uE000k[bi](\d+)\uE001/g;
const CODE_TOKEN_RE = /\uE000c(\d+)\uE001/g;

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function katexHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, trust: false, output: 'html' });
  } catch {
    return escapeHtml(tex);
  }
}

/**
 * Markdown 渲染：先 marked 解析，再 DOMPurify 清洗，最后强制外链 rel/target 与协议白名单。
 * 导入的备份、CSL 字段、用户笔记都算不可信内容，只有这一条渲染路径。
 * 数学公式：代码块先藏起来避免误判，$..$/$$..$$ 的原文 stash 起来，清洗完再注入 KaTeX 生成的受控 HTML。
 */
export function renderMarkdown(source: string): string {
  const stash: { kind: 'kb' | 'ki' | 'c'; value: string }[] = [];
  const park = (kind: 'kb' | 'ki' | 'c', value: string) => {
    stash.push({ kind, value });
    return token(kind, stash.length - 1);
  };

  let masked = (source ?? '')
    // 围栏与行内代码只藏内容，围栏记号本身留给 marked
    .replace(/(```[^\n]*\n|~~~[^\n]*\n)([\s\S]*?)(```|~~~)/g, (_, open: string, body: string, close: string) => `${open}${park('c', body)}${close}`)
    .replace(/`([^`\n]+)`/g, (_, body: string) => `\`${park('c', body)}\``)
    // $$..$$ 块级；行内 $..$ 按 Pandoc 惯例要求两端不贴空白（「$5 和 $6」不算公式）
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => park('kb', tex.trim()))
    .replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, (_, tex: string) => park('ki', tex));

  const raw = marked.parse(masked, { async: false }) as string;
  let html = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'b', 'i', 'u',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'src', 'alt', 'width', 'height'],
    ALLOWED_URI_REGEXP: URI_SAFE,
    ALLOW_DATA_ATTR: false,
  });

  html = html.replace(MATH_TOKEN_RE, (_, index: string) => {
    const item = stash[Number(index)];
    return item ? katexHtml(item.value, item.kind === 'kb') : '';
  });
  html = html.replace(CODE_TOKEN_RE, (_, index: string) => {
    const item = stash[Number(index)];
    return item ? escapeHtml(item.value) : '';
  });
  return html;
}
