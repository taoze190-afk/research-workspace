import type { Reference } from '@/domain/types';

/**
 * BibTeX 导出：给 LaTeX 用的最小可用集。
 * 条目类型只有 @article 和 @inproceedings（出处里带会议特征词才算后者），
 * 字段缺什么就不写什么，不做任何编造。
 */

const VENUE_CONFERENCE_RE = /proceedings|conference|symposium|congress|workshop|会议|大会|论文集/i;

const stripBraces = (value: string) => value.replace(/[{}]/g, '');

function entryKey(ref: Reference, used: Set<string>): string {
  const firstAuthor = ref.authors.split(/[；;]/)[0]?.trim() ?? '';
  const ascii = firstAuthor.replace(/[^A-Za-z]/g, '').toLowerCase();
  const titleWord = (ref.title.match(/[A-Za-z0-9]+/) ?? [])[0]?.toLowerCase() ?? '';
  let key = `${ascii || 'ref'}${ref.year ?? ''}${titleWord}`.slice(0, 60) || 'ref';
  let suffix = '';
  let index = 0;
  while (used.has(key + suffix)) {
    suffix = String.fromCharCode(97 + (index++ % 26));
  }
  key += suffix;
  used.add(key);
  return key;
}

export function toBibtex(references: Reference[]): string {
  const used = new Set<string>();
  const entries: string[] = [];
  for (const ref of references.filter((r) => r.deletedAt === null)) {
    // 每个作者单独包一层括号（保护名字里的空格），拼好后整体只再包一层，不能再过 stripBraces
    const authors = ref.authors
      .split(/[；;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => `{${stripBraces(name)}}`)
      .join(' and ');
    const isConference = VENUE_CONFERENCE_RE.test(ref.venue);
    const lines: string[] = [];
    const push = (field: string, value: string) => {
      if (value) lines.push(`  ${field} = {${stripBraces(value)}}`);
    };
    if (authors) lines.push(`  author = {${authors}}`);
    push('title', ref.title);
    push(isConference ? 'booktitle' : 'journal', ref.venue);
    if (ref.year) lines.push(`  year = {${ref.year}}`);
    push('doi', ref.doi);
    push('url', ref.url);

    entries.push(`@${isConference ? 'inproceedings' : 'article'}{${entryKey(ref, used)},\n${lines.join(',\n')}\n}`);
  }
  return entries.join('\n\n') + (entries.length ? '\n' : '');
}
