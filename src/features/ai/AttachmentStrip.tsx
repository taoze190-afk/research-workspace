import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, ImageIcon, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  downloadResearchFile,
  formatFileSize,
  listResearchFiles,
  readResearchFile,
  type FileStorageContext,
} from '@/features/files/repository';
import { FilePreview } from '@/features/files/FilePreview';
import { prepareAiAttachment, type AiAttachment } from '@/lib/ai-attachments';

/** 原文件在文件库；这里仅持有模型需要的预览，历史记录不会塞入整张图片。 */
export function AttachmentStrip({
  attachments,
  context,
  onRemove,
  disabled = false,
}: {
  attachments: AiAttachment[];
  context: FileStorageContext;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<AiAttachment | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const previewCache = useRef(new Set<string>());
  const [thumbnailRevision, setThumbnailRevision] = useState(0);
  const identity = attachments.map((a) => a.id + ':' + a.kind).join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    if (!strip.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(strip.current);
    return () => observer.disconnect();
  }, [identity]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    for (const attachment of attachments) {
      if (attachment.kind !== 'image' || attachment.dataUrl || previewCache.current.has(attachment.id)) continue;
      void readResearchFile(attachment.id, context, controller.signal)
        .then(async (blob) => {
          if (controller.signal.aborted) return;
          const file = new File([blob], attachment.name, { type: attachment.mimeType });
          const prepared = await prepareAiAttachment(file, { id: attachment.id, signal: controller.signal });
          if (!controller.signal.aborted && prepared.dataUrl) {
            previewCache.current.add(attachment.id);
            setFailed((prev) => prev.filter((id) => id !== attachment.id));
            setPreviews((prev) => ({ ...prev, [attachment.id]: prepared.dataUrl! }));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setFailed((prev) => (prev.includes(attachment.id) ? prev : [...prev, attachment.id]));
        });
    }
    return () => controller.abort();
  }, [identity, context.owner, context.mode, visible, thumbnailRevision]);
  const download = async (attachment: AiAttachment) => {
    setDownloading(true);
    setDownloadError('');
    try {
      const listing = await listResearchFiles(context.owner, context.mode);
      const original = listing.files.find((f) => f.id === attachment.id);
      if (!original) throw new Error('原文件已删除或不可用');
      await downloadResearchFile(original, context);
    } catch (err) {
      setDownloadError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  if (!attachments.length) return null;
  return (
    <>
      <div ref={strip} className="studio-attachment-strip" aria-label={onRemove ? '待发送附件' : '已发送附件'}>
        {attachments.map((attachment) => {
          const preview = attachment.dataUrl || previews[attachment.id];
          return (
            <div className="studio-attachment" key={attachment.id} data-kind={attachment.kind}>
              <button
                type="button"
                className="studio-attachment-main"
                title={attachment.warning || attachment.name}
                onClick={() => {
                  setDownloadError('');
                  setSelected(attachment);
                }}
              >
                {preview ? (
                  <img src={preview} alt="" />
                ) : attachment.kind === 'image' ? (
                  <ImageIcon size={20} aria-hidden />
                ) : (
                  <FileText size={20} aria-hidden />
                )}
                <span>
                  <strong>{attachment.name}</strong>
                  <small>
                    {failed.includes(attachment.id)
                      ? '原文件不可用'
                      : attachment.kind === 'stored'
                        ? '已保存 · 暂不支持 AI 读取'
                        : attachment.truncated
                          ? '已保存 · 部分内容'
                          : attachment.kind === 'image'
                            ? '已保存 · 图片'
                            : '已保存 · 可读取'}
                  </small>
                </span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="studio-attachment-remove"
                  aria-label={'移除附件：' + attachment.name}
                  disabled={disabled}
                  onClick={() => onRemove(attachment.id)}
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            if (failed.length) setThumbnailRevision((n) => n + 1);
          }
        }}
      >
        <DialogContent
          title={selected?.name || '附件'}
          description={selected ? formatFileSize(selected.size) : undefined}
          width="lg"
          className="studio-attachment-dialog"
        >
          {selected && (
            <>
              <FilePreview key={selected.id} file={selected} context={context} />
              {downloadError && (
                <p role="alert" className="text-aux text-danger">
                  {downloadError}
                </p>
              )}
              <div className="studio-attachment-dialog-actions">
                <Link className="studio-attachment-file-link" to={'/files?focus=' + encodeURIComponent(selected.id)}>
                  查看原文件
                </Link>
                <Button size="sm" disabled={downloading} onClick={() => void download(selected)}>
                  <Download size={14} aria-hidden />
                  {downloading ? '正在下载…' : '下载原文件'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
