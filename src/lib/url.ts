const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/** 只允许安全协议；其余（javascript:、data: 等）一律拒绝渲染成链接。 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function doiUrl(doi: string): string | null {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!clean) return null;
  // DOI 里的 "/" 是路径的一部分，不能整体转义。
  const encoded = clean.replace(/\s/g, '%20');
  return safeHref(`https://doi.org/${encoded}`);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
