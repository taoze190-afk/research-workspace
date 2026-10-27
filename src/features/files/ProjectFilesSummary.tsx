import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Loader2, Paperclip, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/state/AuthContext';
import { filesAiHref, filterResearchFiles } from './presentation';
import { formatFileSize, listResearchFiles, type FileStorageMode, type ResearchFileMetadata } from './repository';

export function ProjectFilesSummary({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const owner = auth.phase === 'local' ? 'local' : auth.user?.id || 'unknown';
  return (
    <ScopedSummary
      key={owner + ':' + projectId}
      owner={owner}
      mode={auth.phase === 'local' ? 'local' : 'server'}
      projectId={projectId}
    />
  );
}
function ScopedSummary({ owner, mode, projectId }: { owner: string; mode: FileStorageMode; projectId: string }) {
  const [files, setFiles] = useState<ResearchFileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const href = '/projects/' + encodeURIComponent(projectId) + '?tab=files';
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void listResearchFiles(owner, mode)
      .then((result) => {
        if (alive) setFiles(filterResearchFiles(result.files, { project: projectId }));
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
  }, [owner, mode, projectId, revision]);
  return (
    <section className="panel project-files-summary" aria-label="项目科研文件">
      <header className="panel-head">
        <h3 className="section-title section-heading text-[14px]">
          <Paperclip size={15} className="section-icon" aria-hidden />
          科研文件{!loading && !error && <span className="page-count">{files.length}</span>}
        </h3>
        <Link className="text-aux text-ink-2 hover:text-brand-ink" to={href}>
          管理
        </Link>
      </header>
      {loading ? (
        <div className="project-files-summary-state" role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          正在读取…
        </div>
      ) : error ? (
        <div className="project-files-summary-state">
          <p role="alert">{error}</p>
          <Button size="sm" variant="ghost" onClick={() => setRevision((n) => n + 1)}>
            <RefreshCw size={14} aria-hidden />
            重试
          </Button>
        </div>
      ) : files.length ? (
        <ul>
          {files.slice(0, 3).map((file) => (
            <li key={file.id}>
              <Link
                className="project-file-summary-link"
                to={href + '&focus=' + encodeURIComponent(file.id)}
                title={file.name}
              >
                <FileText size={16} aria-hidden />
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)}</small>
                </span>
              </Link>
              <Button asChild variant="ghost" size="iconSm">
                <Link aria-label={'让 AI 读取：' + file.name} to={filesAiHref([file])}>
                  <Sparkles size={14} aria-hidden />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="project-files-summary-state">
          <span>还没有项目文件</span>
          <Button asChild size="sm">
            <Link to={href}>添加文件</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
