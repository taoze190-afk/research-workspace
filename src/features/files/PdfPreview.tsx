import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist/types/src/display/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { loadPdfJs } from '@/lib/pdf';
import { blobArrayBuffer } from './repository';

export function PdfPreview({ blob, name }: { blob: Blob; name: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(320);
  const [rendering, setRendering] = useState(true);
  const [renderedPage, setRenderedPage] = useState(0);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(160, element.clientWidth - 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setPage(1);
    setError('');
    setRendering(true);
    setRenderedPage(0);
    void (async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([loadPdfJs(), blobArrayBuffer(blob)]);
        if (!alive) return;
        const bytes = new Uint8Array(buffer);
        if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-'))
          throw new Error('PDF 文件格式与内容不符');
        task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useWasm: false, verbosity: 0 });
        const loaded = await task.promise;
        if (alive) setDocument(loaded);
      } catch (err) {
        if (alive)
          setError(
            (err as Error).name === 'PasswordException'
              ? '此 PDF 已加密，请下载后使用密码打开。'
              : 'PDF 预览失败，请重试或下载原文件。',
          );
      }
    })();
    return () => {
      alive = false;
      void task?.destroy().catch(() => {});
    };
  }, [blob, revision]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let alive = true;
    let task: RenderTask | undefined;
    setRendering(true);
    setRenderedPage(0);
    setError('');
    // 每次使用独立画布，快速翻页取消后也不会让两次绘制竞争同一个 canvas。
    const visible = canvas.current;
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!alive) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 2) * zoom;
        const view = pdfPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const scratch = window.document.createElement('canvas');
        // 控制异常页面和高倍缩放的像素开销。
        const outputScale = Math.min(
          ratio,
          Math.sqrt(8_000_000 / (view.width * view.height)),
          12000 / Math.max(view.width, view.height),
        );
        scratch.width = Math.max(1, Math.floor(view.width * outputScale));
        scratch.height = Math.max(1, Math.floor(view.height * outputScale));
        task = pdfPage.render({
          canvas: scratch,
          viewport: view,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
          background: '#ffffff',
        });
        await task.promise;
        if (!alive) return;
        visible.width = scratch.width;
        visible.height = scratch.height;
        visible.style.width = view.width + 'px';
        visible.style.height = view.height + 'px';
        visible.getContext('2d')?.drawImage(scratch, 0, 0);
        setRenderedPage(page);
        setRendering(false);
      } catch (err) {
        if (alive && (err as Error).name !== 'RenderingCancelledException') {
          setError('这一页暂时无法显示，可重试或下载原文件。');
          setRendering(false);
        }
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [document, page, width, zoom]);
  return (
    <section className="pdf-preview" aria-label="PDF 阅读器">
      {document && (
        <div className="pdf-preview-toolbar">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="PDF 上一页"
            disabled={page <= 1}
            onClick={() => setPage((n) => n - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="pdf-page-count" aria-live="polite">
            {page} / {document.numPages}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="PDF 下一页"
            disabled={page >= document.numPages}
            onClick={() => setPage((n) => n + 1)}
          >
            <ChevronRight size={16} />
          </Button>
          <Select aria-label="PDF 缩放" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={1}>适应宽度</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </Select>
        </div>
      )}
      <div className="pdf-preview-viewport" ref={viewport} aria-busy={rendering && !error}>
        {error ? (
          <div className="file-preview-placeholder">
            <p role="alert">{error}</p>
            <Button size="sm" onClick={() => setRevision((n) => n + 1)}>
              重新预览
            </Button>
          </div>
        ) : (
          <>
            {rendering && (
              <div className="pdf-preview-loading" role="status">
                <Loader2 size={18} className="animate-spin" /> 正在绘制页面…
              </div>
            )}
            <canvas
              ref={canvas}
              data-page={renderedPage}
              role="img"
              aria-label={name + '，第 ' + page + ' 页'}
              style={{ visibility: rendering ? 'hidden' : 'visible' }}
            />
          </>
        )}
      </div>
    </section>
  );
}
