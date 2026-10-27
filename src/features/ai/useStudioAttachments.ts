import { useEffect, useRef, useState } from 'react';
import type { AiMessage } from '@/lib/ai';
import { MAX_AI_ATTACHMENTS, prepareAiAttachment, type AiAttachment } from '@/lib/ai-attachments';
import {
  listResearchFiles,
  readResearchFile,
  saveResearchFile,
  type FileStorageContext,
  type ResearchFileMetadata,
} from '@/features/files/repository';

const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
};
const storedOnly = (file: Pick<AiAttachment, 'id' | 'name' | 'mimeType' | 'size'>, message: string): AiAttachment => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  size: file.size,
  kind: 'stored',
  warning: message,
});
export function useStudioAttachments({
  context,
  sessionId,
  initial,
  canUpload,
}: {
  context: FileStorageContext;
  sessionId: string;
  initial?: AiAttachment[];
  canUpload: boolean;
}) {
  const [attachments, setAttachments] = useState<AiAttachment[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [progress, setProgress] = useState('');
  const failedRef = useRef<File[]>([]);
  const [files, setFiles] = useState<ResearchFileMetadata[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const active = useRef<AbortController | null>(null);
  const session = useRef(sessionId);
  session.current = sessionId;
  const mounted = useRef(true);
  const current = useRef(attachments);
  current.current = attachments;
  const fileListRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      fileListRevision.current++;
    };
  }, []);
  const prepare = async (file: File, id: string, signal: AbortSignal) => {
    try {
      return await prepareAiAttachment(file, { id, signal });
    } catch (err) {
      checkAbort(signal);
      return storedOnly(
        { id, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size },
        (err as Error).message || '文件已保存，但未能读取内容',
      );
    }
  };
  const start = (count: number) => {
    if (active.current) return null;
    if (!canUpload) {
      setError('离线中，恢复连接后可添加服务器文件');
      return null;
    }
    if (count + current.current.length > MAX_AI_ATTACHMENTS) {
      setError('每次最多附带 ' + MAX_AI_ATTACHMENTS + ' 个文件');
      return null;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    return { controller, sessionId: session.current };
  };
  const finish = (controller: AbortController) => {
    if (active.current === controller) {
      active.current = null;
      if (mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  };
  const push = (attachment: AiAttachment, id: string, signal: AbortSignal) => {
    checkAbort(signal);
    if (!mounted.current || session.current !== id) return;
    current.current = [...current.current.filter((a) => a.id !== attachment.id), attachment];
    setAttachments(current.current);
  };
  const addFiles = async (selected: File[]) => {
    if (!selected.length) return;
    const run = start(selected.length);
    if (!run) return;
    const { controller, sessionId: requestSession } = run;
    const failures: string[] = [];
    const failed: File[] = [];
    const fileKey = (file: File) => file.name + ':' + file.size + ':' + file.lastModified;
    const selectedKeys = new Set(selected.map(fileKey));
    failedRef.current = failedRef.current.filter((file) => !selectedKeys.has(fileKey(file)));
    setFailedUploads(failedRef.current);
    const alive = () => mounted.current && active.current === controller && session.current === requestSession;
    try {
      for (const [index, file] of selected.entries()) {
        checkAbort(controller.signal);
        if (alive()) setProgress('正在保存 ' + (index + 1) + '/' + selected.length + ' · ' + file.name);
        try {
          const meta = await saveResearchFile(file, context);
          checkAbort(controller.signal);
          if (alive()) setProgress('正在读取 ' + (index + 1) + '/' + selected.length + ' · ' + file.name);
          const attachment = await prepare(file, meta.id, controller.signal);
          push(attachment, requestSession, controller.signal);
        } catch (err) {
          checkAbort(controller.signal);
          failures.push(file.name + '：' + (err as Error).message);
          failed.push(file);
        }
      }
      if (alive()) {
        failedRef.current = [...failedRef.current, ...failed];
        setFailedUploads(failedRef.current);
        if (failures.length) setError(failures.join('；'));
      }
    } catch (err) {
      if (alive())
        setError(
          (err as Error).name === 'AbortError'
            ? '已取消读取；已保存的原文件可在科研文件中查看。'
            : (err as Error).message,
        );
    } finally {
      finish(controller);
    }
  };
  const addExisting = async (ids: string[]) => {
    const unique = [...new Set(ids)].filter((id) => !current.current.some((a) => a.id === id));
    if (!unique.length) return;
    const run = start(unique.length);
    if (!run) return;
    const { controller, sessionId: requestSession } = run;
    try {
      const listing = await listResearchFiles(context.owner, context.mode);
      const prepared: AiAttachment[] = [];
      for (const id of unique) {
        checkAbort(controller.signal);
        const meta = listing.files.find((f) => f.id === id);
        if (!meta) throw new Error('文件已删除或不可用');
        if (mounted.current && active.current === controller) setProgress('正在读取 · ' + meta.name);
        const blob = await readResearchFile(id, context, controller.signal);
        checkAbort(controller.signal);
        const attachment = await prepare(new File([blob], meta.name, { type: meta.mimeType }), id, controller.signal);
        prepared.push(attachment);
      }
      checkAbort(controller.signal);
      // 多文件入口全部读取成功再附带，避免拿到一半资料就进行对比。
      prepared.forEach((attachment) => push(attachment, requestSession, controller.signal));
    } catch (err) {
      if (mounted.current && active.current === controller && session.current === requestSession)
        setError((err as Error).name === 'AbortError' ? '已取消读取' : (err as Error).message);
    } finally {
      finish(controller);
    }
  };
  const loadFiles = async () => {
    const revision = ++fileListRevision.current;
    setLoadingFiles(true);
    setError('');
    try {
      const result = await listResearchFiles(context.owner, context.mode);
      if (mounted.current && revision === fileListRevision.current) setFiles(result.files);
    } catch (err) {
      if (mounted.current && revision === fileListRevision.current) setError((err as Error).message);
    } finally {
      if (mounted.current && revision === fileListRevision.current) setLoadingFiles(false);
    }
  };
  const reset = (next: AiAttachment[] = []) => {
    active.current?.abort();
    active.current = null;
    current.current = next;
    setAttachments(next);
    setBusy(false);
    setError('');
    failedRef.current = [];
    setFailedUploads([]);
    setProgress('');
  };
  /** 只读取将发出的有限附件。历史原件已删除时明确降级，当前附件读取失败不冒充已读。 */
  const hydrateMessages = async (messages: AiMessage[], signal: AbortSignal): Promise<AiMessage[]> => {
    const result = messages.map((m) => ({ ...m, attachments: m.attachments ? [...m.attachments] : undefined }));
    const chosen = new Set<string>();
    const cache = new Map<string, AiAttachment>();
    for (let i = result.length - 1; i >= 0; i--) {
      const row = result[i];
      if (!row.attachments) continue;
      for (let n = 0; n < row.attachments.length; n++) {
        checkAbort(signal);
        const attachment = row.attachments[n];
        if (attachment.kind === 'stored') continue;
        if (!chosen.has(attachment.id) && chosen.size >= MAX_AI_ATTACHMENTS) {
          row.attachments[n] = storedOnly(attachment, '此历史附件本轮未再次附带，需要时请重新选择。');
          continue;
        }
        chosen.add(attachment.id);
        if (cache.has(attachment.id)) {
          row.attachments[n] = cache.get(attachment.id)!;
          continue;
        }
        if ((attachment.kind === 'image' && attachment.dataUrl) || (attachment.kind === 'text' && attachment.text)) {
          cache.set(attachment.id, attachment);
          continue;
        }
        try {
          const blob = await readResearchFile(attachment.id, context, signal);
          checkAbort(signal);
          const value = await prepare(
            new File([blob], attachment.name, { type: attachment.mimeType }),
            attachment.id,
            signal,
          );
          row.attachments[n] = value;
          cache.set(attachment.id, value);
        } catch (err) {
          checkAbort(signal);
          if (i === result.length - 1) throw new Error('无法读取附件「' + attachment.name + '」，请重新上传。');
          row.attachments[n] = storedOnly(attachment, '历史附件已无法读取，本轮仅保留文件名。');
        }
      }
    }
    return result;
  };
  return {
    attachments,
    busy,
    error,
    failedUploads,
    progress,
    files,
    loadingFiles,
    addFiles,
    retryUploads: () => addFiles([...failedRef.current]),
    dismissUploadFailures: () => {
      failedRef.current = [];
      setFailedUploads([]);
      setError('');
    },
    addExisting,
    loadFiles,
    reset,
    hydrateMessages,
    remove: (id: string) => {
      if (!active.current) {
        current.current = current.current.filter((a) => a.id !== id);
        setAttachments(current.current);
      }
    },
    cancel: () => active.current?.abort(),
    clearError: () => setError(''),
  };
}
