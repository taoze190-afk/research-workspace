/** 文档阅读与 AI 提取共用本地 worker，不向外部解析服务传文件。 */
export async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  return pdfjs;
}
