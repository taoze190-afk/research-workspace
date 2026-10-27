import { blobArrayBuffer, readResearchFile, type FileStorageContext, type ResearchFileMetadata } from './repository';

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 100;
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('已取消打包', 'AbortError');
};

/** 防止 ZIP 路径逃逸，也避免解压到 Windows 时同名覆盖或特殊文件名失败。 */
function archiveName(name: string, used: Set<string>) {
  let safe =
    name
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/^[. ]+|[. ]+$/g, '') || '未命名文件';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = '_' + safe;
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : '';
  let candidate = safe,
    n = 2;
  while (used.has(candidate.toLocaleLowerCase())) candidate = base + ' (' + n++ + ')' + extension;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

export async function buildResearchArchive(
  files: ResearchFileMetadata[],
  context: FileStorageContext,
  options: {
    signal?: AbortSignal;
    onProgress?: (current: number, total: number, name: string) => void;
  } = {},
): Promise<Blob> {
  const unique = [...new Map(files.map((f) => [f.id, f])).values()];
  if (!unique.length) throw new Error('请先选择文件');
  if (unique.length > MAX_ARCHIVE_FILES || unique.reduce((n, f) => n + f.size, 0) > MAX_ARCHIVE_BYTES)
    throw new Error('单次打包最多 100 个文件、合计 100 MB，请分批下载');
  checkAbort(options.signal);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const [index, file] of unique.entries()) {
    checkAbort(options.signal);
    options.onProgress?.(index + 1, unique.length, file.name);
    checkAbort(options.signal);
    const bytes = await blobArrayBuffer(await readResearchFile(file.id, context, options.signal));
    checkAbort(options.signal);
    if (bytes.byteLength !== file.size) throw new Error('「' + file.name + '」内容不完整，未生成压缩包，请刷新后重试');
    zip.file(archiveName(file.name, used), bytes, { date: new Date(file.createdAt), binary: true });
  }
  checkAbort(options.signal);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  checkAbort(options.signal);
  return blob;
}

export function downloadResearchArchive(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '科研文件-' + new Date().toISOString().slice(0, 10) + '.zip';
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
