import type { Reference } from './types';
import { normalizeText } from './search';

export interface DuplicateMatch {
  kind: 'doi' | 'title-year' | null;
  existing: Reference | null;
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
}

/**
 * 有 DOI 时按规范化 DOI 判重（确定重复）；没有 DOI 时只在标题与年份都吻合时给出「疑似」。
 * 两种情况都不自动合并，交给用户决定。
 */
export function findDuplicate(candidate: { doi?: string; title?: string; year?: number | null }, rows: Reference[]): DuplicateMatch {
  const live = rows.filter((r) => r.deletedAt === null);
  const doi = normalizeDoi(candidate.doi ?? '');
  if (doi) {
    const hit = live.find((r) => normalizeDoi(r.doi) === doi) ?? null;
    if (hit) return { kind: 'doi', existing: hit };
  }
  const title = normalizeText(candidate.title ?? '');
  if (title.length < 3) return { kind: null, existing: null };
  const fuzzy = live.find(
    (r) => r.year === candidate.year && (normalizeText(r.title) === title || normalizeText(r.title).includes(title) || title.includes(normalizeText(r.title)))
  );
  if (fuzzy) return { kind: 'title-year', existing: fuzzy };
  return { kind: null, existing: null };
}

/** 备份内部判重：同一 DOI 的多条目提示但不阻断。 */
export function groupByDoi(rows: Reference[]): Map<string, Reference[]> {
  const map = new Map<string, Reference[]>();
  for (const r of rows) {
    const doi = normalizeDoi(r.doi);
    if (!doi) continue;
    const list = map.get(doi) ?? [];
    list.push(r);
    map.set(doi, list);
  }
  return map;
}
