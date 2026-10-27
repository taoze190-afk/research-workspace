import { normalizeDoi } from '@/domain/dedupe';

/**
 * DOI 元数据补全：只做「输入 DOI → 查 Crossref → 映射进表单字段」这一件事。
 * 联网失败或查不到就返回 null，界面退回手填，绝不阻塞录入。
 */

export interface DoiMetadata {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  url: string;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const hasCJK = (value: string) => CJK.test(value);

const firstText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
};

/** Crossref 的 /works/{doi} 响应体 → 表单字段。没有标题就算失败。 */
export function crossrefToMetadata(message: unknown): DoiMetadata | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const title = firstText(m.title);
  if (!title) return null;

  const authors = Array.isArray(m.author)
    ? (m.author as Record<string, unknown>[])
        .map((a) => {
          const family = typeof a.family === 'string' ? a.family.trim() : '';
          const given = typeof a.given === 'string' ? a.given.trim() : '';
          if (family && given) return hasCJK(family) || hasCJK(given) ? `${family}${given}` : `${given} ${family}`;
          return family || given || firstText(a.name);
        })
        .filter(Boolean)
        .join('；')
    : '';

  const parts = (m.issued as { 'date-parts'?: unknown } | undefined)?.['date-parts'];
  const firstParts = Array.isArray(parts) ? parts[0] : undefined;
  const year = Array.isArray(firstParts) && typeof firstParts[0] === 'number' ? firstParts[0] : null;

  const resource = m.resource as { primary?: { URL?: unknown } } | undefined;
  const url = typeof resource?.primary?.URL === 'string' ? resource.primary.URL : '';

  return { title, authors, year, venue: firstText(m['container-title']), url };
}

export async function fetchDoiMetadata(rawDoi: string, timeoutMs = 8000): Promise<DoiMetadata | null> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) return null;
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { message?: unknown };
  return json.message ? crossrefToMetadata(json.message) : null;
}
