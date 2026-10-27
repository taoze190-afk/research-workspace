import type { Reference } from '@/domain/types';

/**
 * 引用格式导出：GB/T 7714-2015 的简化版（顺序编码制），
 * 只用库里已有的字段，缺什么就少写什么，不做编造。
 */

const CONFERENCE_RE = /proceedings|conference|symposium|congress|workshop|会议|大会|论文集/i;

/** 超过三位作者取前三位加「等」，符合 GB/T 7714 的著录习惯。 */
function formatAuthors(authors: string): string {
  const names = authors
    .split(/[；;、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')}, 等`;
}

export function citationTypeOf(ref: Reference): 'J' | 'C' {
  return CONFERENCE_RE.test(ref.venue) ? 'C' : 'J';
}

export function toGbt7714(ref: Reference): string {
  const parts: string[] = [];
  const authors = formatAuthors(ref.authors);
  if (authors) parts.push(authors);
  parts.push(`${ref.title || '未命名条目'}[${citationTypeOf(ref)}]`);
  const tail: string[] = [];
  if (ref.venue) tail.push(ref.venue);
  if (ref.year) tail.push(String(ref.year));
  if (tail.length) parts.push(tail.join(', '));
  return `${parts.join('. ')}.`;
}

export function toApaLike(ref: Reference): string {
  const authors = formatAuthors(ref.authors);
  const year = ref.year ? `(${ref.year}).` : '';
  const venue = ref.venue ? `. ${ref.venue}` : '';
  return [authors, year, ref.title || '未命名条目', venue].filter(Boolean).join(' ');
}
