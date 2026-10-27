import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, FileText, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import type { ResearchContext } from './context';
import type { ResearchTrace } from './provenance';
import { WORKFLOWS } from './workflows';
import { describeAction } from './actions';
import type { StudioConversation } from './conversations';
import {
  formatFileSize,
  listResearchFiles,
  type FileStorageContext,
  type ResearchFileMetadata,
} from '@/features/files/repository';
import { MAX_AI_ATTACHMENTS } from '@/lib/ai-attachments';

const sourceLabels = {
  project: '项目',
  task: '任务',
  experiment: '实验',
  reference: '文献',
  file: '文件',
  milestone: '里程碑',
  subtask: '子任务',
};
export function ResearchSourceList({ trace, snapshot = false }: { trace: ResearchTrace; snapshot?: boolean }) {
  return (
    <div className="studio-resource-section">
      <div className="studio-resource-caption">
        <strong>{snapshot ? '本轮资料' : '当前资料'}</strong>
        <span>{trace.totalSources} 条</span>
      </div>
      {snapshot && (
        <p className="studio-resource-meta">
          {WORKFLOWS[trace.workflow].title} · {new Date(trace.capturedAt).toLocaleString('zh-CN')}
        </p>
      )}
      {trace.sources.length ? (
        <ul className="studio-source-list">
          {trace.sources.map((source) => (
            <li key={source.kind + ':' + source.id}>
              <Link to={source.href}>
                <span className="studio-source-kind">{sourceLabels[source.kind]}</span>
                <span>{source.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-resource-empty">{trace.scope === 'none' ? '不附带研究记录' : '当前没有可用的研究记录'}</p>
      )}
      {trace.truncated && <p className="studio-resource-meta">长内容已精简；清单最多显示 20 条来源。</p>}
      <p className="studio-resource-meta">文件正文仅在明确附带后发送；来源链接用于打开原记录。</p>
    </div>
  );
}

export function RelatedResearchFiles({
  research,
  context,
  attachedIds,
  disabled,
  attachmentError,
  onAttach,
}: {
  research: ResearchContext;
  context: FileStorageContext;
  attachedIds: string[];
  disabled: boolean;
  attachmentError?: string;
  onAttach: (ids: string[]) => Promise<void>;
}) {
  const [files, setFiles] = useState<ResearchFileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const projectIds = useMemo(() => {
    if (research.kind === 'project' && research.id) return [research.id];
    if (research.record && 'projectId' in research.record && research.record.projectId)
      return [research.record.projectId];
    if (research.kind === 'reference' && research.text) {
      try {
        return (JSON.parse(research.text).projects as { id: string }[]).map((p) => p.id);
      } catch {
        return [];
      }
    }
    return [];
  }, [research.kind, research.id, research.text]);
  const projectKey = projectIds.join('|');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void listResearchFiles(context.owner, context.mode)
      .then((result) => {
        if (alive)
          setFiles(
            result.files
              .filter((file) =>
                projectIds.length
                  ? Boolean(file.projectId && projectIds.includes(file.projectId))
                  : research.kind === 'workspace' || research.kind === 'none' || !file.projectId,
              )
              .sort((a, b) => b.updatedAt - a.updatedAt),
          );
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [context.owner, context.mode, projectKey, research.kind, revision]);
  const href = projectIds.length === 1 ? '/files?project=' + encodeURIComponent(projectIds[0]) : '/files';
  return (
    <div className="studio-resource-section">
      <div className="studio-resource-caption">
        <strong>{projectIds.length ? '相关项目文件' : '可选科研文件'}</strong>
        <Link to={href}>文件库</Link>
      </div>
      <p className="studio-resource-meta">
        已附带 {attachedIds.length} / {MAX_AI_ATTACHMENTS} 个
      </p>
      {loading ? (
        <p className="studio-resource-empty" role="status">
          <Loader2 size={16} className="animate-spin" />
          正在读取目录…
        </p>
      ) : error ? (
        <div className="studio-resource-empty">
          <p role="alert">{error}</p>
          <Button size="sm" onClick={() => setRevision((n) => n + 1)}>
            重试
          </Button>
        </div>
      ) : files.length ? (
        <ul className="studio-linked-files">
          {files.slice(0, 12).map((file) => (
            <li key={file.id}>
              <FileText size={17} aria-hidden />
              <Link title={file.name} to={'/files?focus=' + encodeURIComponent(file.id)}>
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </Link>
              <Button
                size="sm"
                disabled={disabled || attachedIds.includes(file.id) || attachedIds.length >= MAX_AI_ATTACHMENTS}
                onClick={() => void onAttach([file.id])}
              >
                {attachedIds.includes(file.id) ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                {attachedIds.includes(file.id) ? '已附带' : '附带'}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-resource-empty">还没有此范围的科研文件</p>
      )}
      {files.length > 12 && (
        <Link className="studio-resource-meta" to={href}>
          在文件库查看全部 {files.length} 个文件
        </Link>
      )}
      {attachmentError && (
        <p className="studio-resource-error" role="alert">
          {attachmentError}
        </p>
      )}
    </div>
  );
}

export function OperationLedger({
  current,
  history,
  disabled,
  onOpenConversation,
}: {
  current: StudioConversation;
  history: StudioConversation[];
  disabled: boolean;
  onOpenConversation: (conversation: StudioConversation) => void;
}) {
  const [range, setRange] = useState('current');
  const conversations = range === 'current' ? [current] : [current, ...history.filter((c) => c.id !== current.id)];
  const rows = conversations.flatMap((conversation) =>
    [...conversation.batches]
      .reverse()
      .flatMap((batch) =>
        batch.actions.map((action, index) => ({ conversation, batch, action, index, result: batch.results[index] })),
      ),
  );
  return (
    <div className="studio-resource-section">
      <div className="studio-resource-caption">
        <strong>操作记录</strong>
        <Select aria-label="操作记录范围" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="current">当前会话</option>
          <option value="all">全部本机会话</option>
        </Select>
      </div>
      {rows.length ? (
        <ol className="studio-operation-ledger">
          {rows.slice(0, 60).map(({ conversation, batch, action, index, result }) => {
            const state = result?.ok ? 'done' : batch.dismissed ? 'dismissed' : result ? 'failed' : 'pending';
            const labels = { done: '已保存', dismissed: '已忽略', failed: '未保存', pending: '待采纳' };
            const safeHref =
              result?.href && /^\/(projects|tasks|experiments|library)([/?]|$)/.test(result.href)
                ? result.href
                : undefined;
            return (
              <li key={conversation.id + ':' + batch.id + ':' + index} data-operation-state={state}>
                <div>
                  <strong>{describeAction(action)}</strong>
                  <span className={'studio-operation-state is-' + state}>{labels[state]}</span>
                </div>
                <p>{result?.message || (batch.dismissed ? '这项提议没有执行' : '尚未修改研究记录')}</p>
                <div className="studio-operation-links">
                  {result?.ok && safeHref && <Link to={safeHref}>查看记录</Link>}
                  <button type="button" disabled={disabled} onClick={() => onOpenConversation(conversation)}>
                    查看对话
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="studio-resource-empty">还没有操作建议或保存记录</p>
      )}
      <p className="studio-resource-meta">对话与操作回执保存在此浏览器，研究记录按当前账号保存。</p>
      {rows.length > 60 && <p className="studio-resource-meta">当前显示最近 60 项操作。</p>}
    </div>
  );
}
