/**
 * 实验记录里粘贴截图：降采样 → PNG（文字清晰）→ 太大退 JPEG → 还大就拒绝。
 * 结果以 data URL 直接写进 Markdown 正文，随记录一起存与备份。
 */

export interface InsertionResult {
  text: string;
  cursor: number;
}

/** 在光标处插入图片标记；上一段没换行就先空一行，别把图黏在段落中间。 */
export function insertImageAtCursor(before: string, markdown: string, start: number, end = start): InsertionResult {
  const head = before.slice(0, Math.max(0, start));
  const tail = before.slice(Math.max(start, end));
  const lead = head && !head.endsWith('\n') ? '\n\n' : '';
  const piece = `${lead}${markdown}`;
  return { text: head + piece + tail, cursor: head.length + piece.length };
}

export function markdownImageToken(dataUrl: string, label: string): string {
  return `![${label}](${dataUrl})`;
}

/** data URL 的字符数约等于字节数的 1.37 倍，用 1.4 做上限判断。 */
const urlOver = (url: string, maxBytes: number) => url.length > maxBytes * 1.4;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

async function compressImage(file: File, maxEdge: number, maxBytes: number): Promise<string | null> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let url = canvas.toDataURL('image/png');
  if (urlOver(url, maxBytes)) url = canvas.toDataURL('image/jpeg', 0.85);
  return urlOver(url, maxBytes) ? null : url;
}

/** 返回可直接插入正文的 Markdown 图片标记；不是图片、读不出来或压不进上限时返回 null。 */
export async function fileToImageMarkdown(file: File, label: string, maxEdge = 1400, maxBytes = 900_000): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const url = await compressImage(file, maxEdge, maxBytes);
    return url ? markdownImageToken(url, label) : null;
  } catch {
    return null;
  }
}
