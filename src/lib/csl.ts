import type { Reference } from '@/domain/types';
import { emptyReference } from '@/data/repo';
import { safeHref } from './url';
import { normalizeDoi } from '@/domain/dedupe';

export interface CslItem {
  id?: string;
  type?: string;
  title?: string;
  author?: { family?: string; given?: string; literal?: string }[];
  issued?: { 'date-parts'?: number[][] };
  containerTitle?: string;
  'container-title'?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
}

export interface CslDocument {
  type?: string;
  title?: string;
  issued?: { 'date-parts'?: number[][] };
  items?: CslItem[];
}

const authorsToText = (item: CslItem): string =>
  (item.author ?? [])
    .map((a) => a.literal ?? [a.family, a.given].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('；');

const yearOf = (item: CslItem): number | null => {
  const parts = item.issued?.['date-parts']?.[0];
  const y = Array.isArray(parts) ? parts[0] : undefined;
  return typeof y === 'number' && y > 0 ? y : null;
};

function itemFromReference(ref: Reference): CslItem {
  const families = ref.authors
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const item: CslItem = {
    id: ref.id,
    type: 'article-journal',
    title: ref.title,
    'container-title': ref.venue || undefined,
    DOI: ref.doi || undefined,
    URL: safeHref(ref.url) ?? undefined,
  };
  if (families.length) item.author = families.map((name) => ({ literal: name }));
  if (ref.year) item.issued = { 'date-parts': [[ref.year]] };
  return item;
}

/** CSL-JSON 导出：只导出条目元数据，个人笔记属于用户，默认不外发。 */
export function toCslJson(references: Reference[]): string {
  const doc: CslDocument = {
    type: 'document',
    title: '研序文献库导出',
    issued: { 'date-parts': [[new Date().getFullYear()]] },
    items: references.filter((r) => r.deletedAt === null).map(itemFromReference),
  };
  return JSON.stringify(doc, null, 2);
}

export interface CslImportPreview {
  items: { reference: Reference; warnings: string[] }[];
  rejected: string[];
  total: number;
}

export function parseCslJson(text: string): CslImportPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { items: [], rejected: [`不是合法 JSON：${(e as Error).message}`], total: 0 };
  }
  const list = Array.isArray(raw) ? (raw as CslItem[]) : Array.isArray((raw as CslDocument)?.items) ? ((raw as CslDocument).items as CslItem[]) : null;
  if (!list) return { items: [], rejected: ['文件里找不到条目数组（应为 CSL-JSON 数组或 { items: [...] }）'], total: 0 };

  const items: CslImportPreview['items'] = [];
  const rejected: string[] = [];
  list.forEach((item, index) => {
    if (item === null || typeof item !== 'object') {
      rejected.push(`第 ${index + 1} 项不是对象，已跳过`);
      return;
    }
    const reference = emptyReference(false);
    reference.title = typeof item.title === 'string' ? item.title.trim() : '';
    reference.authors = authorsToText(item);
    reference.year = yearOf(item);
    reference.venue = (item['container-title'] ?? item.containerTitle ?? '').toString().trim();
    reference.doi = normalizeDoi(String(item.DOI ?? ''));
    reference.url = safeHref(String(item.URL ?? '')) ?? '';
    if (!reference.title) reference.title = '';
    const warnings: string[] = [];
    if (!reference.title) warnings.push('缺标题');
    if (!reference.authors) warnings.push('缺作者');
    if (!reference.year) warnings.push('缺年份');
    items.push({ reference, warnings });
  });

  return { items, rejected, total: list.length };
}
