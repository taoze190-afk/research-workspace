import { useEffect, useState } from 'react';
import { File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { prepareAiAttachment } from '@/lib/ai-attachments';
import { readResearchFile, type FileStorageContext } from './repository';
import { PdfPreview } from './PdfPreview';
import './files.css';

export interface PreviewFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/** 文件详情和聊天附件共用预览；仅在打开时读取当前账号原件。 */
export function FilePreview({ file, context }: { file: PreviewFile; context: FileStorageContext }) {
  const [value, setValue] = useState<{ url?: string; text?: string; pdf?: Blob; notice?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setValue({});
    setError('');
    void (async () => {
      try {
        const original = await readResearchFile(file.id, context, controller.signal);
        if (controller.signal.aborted) return;
        const source = new window.File([original], file.name, { type: file.mimeType });
        if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          setValue({ pdf: source });
        } else {
          // 共用解码和像素上限，预览副本不改动文件库原件。
          const prepared = await prepareAiAttachment(source, { id: file.id, signal: controller.signal });
          if (!controller.signal.aborted)
            setValue({
              text: prepared.text,
              url: prepared.dataUrl,
              notice:
                prepared.text || prepared.dataUrl
                  ? prepared.truncated
                    ? '当前显示部分正文，完整内容请下载原文件。'
                    : undefined
                  : '此格式暂不支持预览，可下载原文件查看。',
            });
        }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message || '预览读取失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [file.id, file.name, file.mimeType, context.owner, context.mode, revision]);
  return (
    <div className="file-preview">
      {loading ? (
        <div className="file-preview-placeholder" role="status">
          <Loader2 size={20} className="animate-spin" />
          <span>正在读取预览…</span>
        </div>
      ) : error ? (
        <div className="file-preview-placeholder">
          <p role="alert">{error}</p>
          <Button size="sm" onClick={() => setRevision((n) => n + 1)}>
            重试预览
          </Button>
        </div>
      ) : value.pdf ? (
        <PdfPreview blob={value.pdf} name={file.name} />
      ) : value.url ? (
        <img src={value.url} alt={file.name} onError={() => setError('图片无法显示，请重试或下载原文件。')} />
      ) : value.text ? (
        <>
          {value.notice && <p className="file-preview-notice">{value.notice}</p>}
          <pre tabIndex={0}>{value.text}</pre>
        </>
      ) : (
        <div className="file-preview-placeholder">
          <File size={32} strokeWidth={1.2} />
          <span>{value.notice || '下载文件查看完整内容'}</span>
        </div>
      )}
    </div>
  );
}
