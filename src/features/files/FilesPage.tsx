import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Download,
  File,
  FileImage,
  FileText,
  FileArchive,
  FolderOpen,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  ListChecks,
  Link2,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownContent,
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuRow,
} from '@/components/ui/dropdown';
import { useAuth } from '@/state/AuthContext';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { createId } from '@/lib/id';
import { cn } from '@/lib/cx';
import {
  deleteResearchFile,
  downloadResearchFile,
  formatFileSize,
  listResearchFiles,
  MAX_RESEARCH_FILE_BYTES,
  RESEARCH_FILE_QUOTA_BYTES,
  saveResearchFile,
  updateResearchFile,
  type FileStorageContext,
  type FileStorageMode,
  type ResearchFileList,
  type ResearchFileMetadata,
} from './repository';
import { FilePreview } from './FilePreview';
import { FILE_CATEGORIES, fileCategory, filterResearchFiles, filesAiHref } from './presentation';
import { buildResearchArchive, downloadResearchArchive } from './archive';
import { MAX_AI_ATTACHMENTS } from '@/lib/ai-attachments';
import './files.css';

type UploadEntry = {
  id: string;
  file: File;
  state: 'pending' | 'uploading' | 'failed';
  error?: string;
  projectId: string | null;
};
const iconFor = (file: ResearchFileMetadata) =>
  file.mimeType.startsWith('image/') ? FileImage : /text|json|pdf|document/.test(file.mimeType) ? FileText : File;
const hrefForAi = (file: ResearchFileMetadata) => filesAiHref([file]);

export function FilesPage({ projectId, embedded = false }: { projectId?: string; embedded?: boolean } = {}) {
  const auth = useAuth();
  const owner = auth.phase === 'local' ? 'local' : auth.user?.id || 'unknown';
  return (
    <FilesWorkspace
      key={owner + ':' + (projectId || '')}
      owner={owner}
      mode={auth.phase === 'local' ? 'local' : 'server'}
      offline={auth.phase === 'offline'}
      scopedProject={projectId}
      embedded={embedded}
    />
  );
}
function FilesWorkspace({
  owner,
  mode,
  offline,
  scopedProject,
  embedded,
}: {
  owner: string;
  mode: FileStorageMode;
  offline: boolean;
  scopedProject?: string;
  embedded: boolean;
}) {
  const { data } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '',
    project = scopedProject || params.get('project') || '',
    selectedId = params.get('focus');
  const category = FILE_CATEGORIES.some((c) => c.value === params.get('type')) ? params.get('type') || '' : '';
  const sort = params.get('sort') || '';
  const [listing, setListing] = useState<ResearchFileList>({
    files: [],
    usedBytes: 0,
    quotaBytes: RESEARCH_FILE_QUOTA_BYTES,
    maxFileBytes: MAX_RESEARCH_FILE_BYTES,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [queue, setQueue] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ResearchFileMetadata | null>(null),
    [deleting, setDeleting] = useState<ResearchFileMetadata | null>(null);
  const [editName, setEditName] = useState(''),
    [editProject, setEditProject] = useState('');
  const [editError, setEditError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignProject, setAssignProject] = useState('');
  const [assignError, setAssignError] = useState('');
  const [batchProgress, setBatchProgress] = useState('');
  const [batchKind, setBatchKind] = useState<'archive' | 'assign' | null>(null);
  const batch = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null),
    mounted = useRef(true),
    uploadLock = useRef(false),
    queueRef = useRef<UploadEntry[]>([]);
  const refreshSequence = useRef(0);
  const projects = data.projects.filter((p) => p.deletedAt === null);
  const context = useMemo<FileStorageContext>(() => ({ owner, mode }), [owner, mode]);
  const selected =
    listing.files.find((file) => file.id === selectedId && (!scopedProject || file.projectId === scopedProject)) ||
    null;
  const rows = useMemo(
    () => filterResearchFiles(listing.files, { query, project, category, sort }),
    [listing.files, query, project, category, sort],
  );
  const categoryCounts = useMemo(() => {
    const scope = filterResearchFiles(listing.files, { query, project });
    return Object.fromEntries(
      FILE_CATEGORIES.map((c) => [
        c.value,
        c.value ? scope.filter((f) => fileCategory(f) === c.value).length : scope.length,
      ]),
    );
  }, [listing.files, query, project]);
  const checked = useMemo(() => rows.filter((file) => checkedIds.has(file.id)), [rows, checkedIds]);
  const allChecked = rows.length > 0 && checked.length === rows.length;
  const hasFilesInScope = scopedProject
    ? listing.files.some((f) => f.projectId === scopedProject)
    : listing.files.length > 0;
  const hasFilters = Boolean(query || category || (!scopedProject && project));
  const clearSelection = () => {
    setCheckedIds(new Set());
    setSelecting(false);
  };
  useEffect(() => {
    setCheckedIds(new Set());
  }, [query, project, category, sort]);
  queueRef.current = queue;
  const patch = (key: string, value: string | null) => {
    if (busy && key !== 'focus') return;
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'focus') next.delete('focus');
    if (key !== 'focus') setCheckedIds(new Set());
    setParams(next, { replace: true });
  };
  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current;
    if (mounted.current) setLoading(true);
    try {
      const next = await listResearchFiles(owner, mode);
      if (mounted.current && request === refreshSequence.current) {
        setListing(next);
        setError('');
      }
    } catch (err) {
      if (mounted.current && request === refreshSequence.current) setError((err as Error).message);
    } finally {
      if (mounted.current && request === refreshSequence.current) setLoading(false);
    }
  }, [owner, mode]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
      batch.current?.abort();
    };
  }, [refresh, offline]);
  const changeQueue = (fn: (rows: UploadEntry[]) => UploadEntry[]) => {
    const next = fn(queueRef.current);
    queueRef.current = next;
    if (mounted.current) setQueue(next);
  };
  const uploadEntries = async (entries: UploadEntry[]) => {
    if (uploadLock.current || offline) return;
    uploadLock.current = true;
    let saved = 0;
    try {
      for (const entry of entries) {
        if (!mounted.current) break;
        if (!queueRef.current.some((row) => row.id === entry.id)) continue;
        changeQueue((rows) =>
          rows.map((row) => (row.id === entry.id ? { ...row, state: 'uploading', error: undefined } : row)),
        );
        try {
          await saveResearchFile(entry.file, { ...context, projectId: entry.projectId });
          saved += 1;
          changeQueue((rows) => rows.filter((row) => row.id !== entry.id));
        } catch (err) {
          changeQueue((rows) =>
            rows.map((row) => (row.id === entry.id ? { ...row, state: 'failed', error: (err as Error).message } : row)),
          );
        }
      }
      if (saved && mounted.current) {
        await refresh();
        toast({ title: '已保存 ' + saved + ' 个文件', tone: 'success' });
      }
    } finally {
      uploadLock.current = false;
      const next = queueRef.current.filter((row) => row.state === 'pending');
      if (mounted.current && next.length) void uploadEntries(next);
    }
  };
  const addFiles = (files: File[]) => {
    if (offline) {
      setError('离线中，连接恢复后可上传文件。');
      return;
    }
    const fresh = files
      .filter(
        (file) =>
          !queueRef.current.some(
            (q) => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified,
          ),
      )
      .map<UploadEntry>((file) => ({
        id: createId(),
        file,
        state: 'pending',
        projectId: project && project !== '__none' ? project : null,
      }));
    if (!fresh.length) return;
    changeQueue((rows) => [...rows, ...fresh]);
    if (!uploadLock.current) void uploadEntries([...queueRef.current.filter((row) => row.state === 'pending')]);
  };
  // 处理上传期间新增的下一批文件，避免选择成功但一直停在等待状态。
  useEffect(() => {
    if (!uploadLock.current && !offline && queue.some((row) => row.state === 'pending'))
      void uploadEntries(queue.filter((row) => row.state === 'pending'));
  }, [queue, offline]);
  const download = async (file: ResearchFileMetadata) => {
    try {
      await downloadResearchFile(file, context);
    } catch (err) {
      setError((err as Error).message);
      toast({ title: '文件下载失败', description: (err as Error).message, tone: 'error' });
    }
  };
  const openEdit = (file: ResearchFileMetadata) => {
    setEditing(file);
    setEditName(file.name);
    setEditProject(file.projectId || '');
    setEditError('');
  };
  const saveEdit = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setEditError('');
    try {
      await updateResearchFile(editing.id, { name: editName, projectId: editProject || null }, context);
      setEditing(null);
      await refresh();
      toast({ title: '文件信息已更新', tone: 'success' });
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const remove = async (file: ResearchFileMetadata) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteResearchFile(file.id, context);
      if (selectedId === file.id) patch('focus', null);
      await refresh();
      toast({ title: '文件已删除', tone: 'success' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const fileMenu = (file: ResearchFileMetadata) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={'文件操作：' + file.name}>
          <MoreHorizontal size={17} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownContent>
        <MenuRow icon={<Download size={14} />} onSelect={() => void download(file)}>
          下载文件
        </MenuRow>
        <MenuRow icon={<Pencil size={14} />} disabled={offline || busy} onSelect={() => openEdit(file)}>
          重命名与关联
        </MenuRow>
        <MenuRow icon={<Sparkles size={14} />} onSelect={() => navigate(hrefForAi(file))}>
          交给 AI
        </MenuRow>
        <DropdownMenuSeparator />
        <MenuRow icon={<Trash2 size={14} />} danger disabled={offline || busy} onSelect={() => setDeleting(file)}>
          删除文件
        </MenuRow>
      </DropdownContent>
    </DropdownMenu>
  );
  const packageFiles = async () => {
    if (busy || batch.current || !checked.length) return;
    const controller = new AbortController();
    batch.current = controller;
    setBusy(true);
    setBatchKind('archive');
    setBatchProgress('正在准备压缩包…');
    setError('');
    try {
      const archive = await buildResearchArchive(checked, context, {
        signal: controller.signal,
        onProgress: (current, total, name) => {
          if (mounted.current) setBatchProgress('正在打包 ' + current + '/' + total + ' · ' + name);
        },
      });
      if (!controller.signal.aborted && mounted.current) {
        downloadResearchArchive(archive);
        toast({ title: '压缩包已准备好', tone: 'success' });
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).name === 'AbortError' ? '已取消打包' : (err as Error).message);
    } finally {
      if (batch.current === controller) {
        batch.current = null;
        if (mounted.current) {
          setBusy(false);
          setBatchProgress('');
          setBatchKind(null);
        }
      }
    }
  };
  const assignFiles = async () => {
    if (busy || batch.current || !checked.length || offline) return;
    if (checked.length > 100) {
      setAssignError('单次最多关联 100 个文件，请分批选择');
      return;
    }
    const controller = new AbortController();
    batch.current = controller;
    setBusy(true);
    setBatchKind('assign');
    setAssignError('');
    const failures: { id: string; name: string; error: string }[] = [];
    let saved = 0;
    const targets = [...checked];
    try {
      for (const [index, file] of targets.entries()) {
        if (controller.signal.aborted) break;
        if (mounted.current) setBatchProgress('正在关联 ' + (index + 1) + '/' + targets.length);
        try {
          await updateResearchFile(file.id, { projectId: assignProject || null }, context);
          saved++;
        } catch (err) {
          failures.push({ id: file.id, name: file.name, error: (err as Error).message });
        }
      }
      if (!controller.signal.aborted && mounted.current) {
        if (saved) toast({ title: '已更新 ' + saved + ' 个文件', tone: 'success' });
        if (failures.length) {
          setCheckedIds(new Set(failures.map((f) => f.id)));
          setAssignError(
            '已更新 ' +
              saved +
              ' 个，' +
              failures.length +
              ' 个失败：' +
              [...new Set(failures.map((f) => f.error))].slice(0, 2).join('；'),
          );
        } else {
          setAssignOpen(false);
          clearSelection();
        }
        await refresh();
      }
    } finally {
      if (batch.current === controller) {
        batch.current = null;
        if (mounted.current) {
          setBusy(false);
          setBatchProgress('');
          setBatchKind(null);
        }
      }
    }
  };
  const headerActions = (
    <>
      {hasFilesInScope && (
        <Button
          size="sm"
          variant={selecting ? 'secondary' : 'ghost'}
          disabled={busy}
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setCheckedIds(new Set());
          }}
        >
          <ListChecks size={15} aria-hidden />
          {selecting ? '退出多选' : '多选'}
        </Button>
      )}
      <Button variant="primary" size="sm" disabled={offline} onClick={() => input.current?.click()}>
        <Upload size={15} aria-hidden />
        上传文件
      </Button>
    </>
  );
  return (
    <div
      className={cn('files-page flex flex-col gap-5', embedded && 'files-embedded')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      {embedded ? (
        <div className="files-section-head">
          <span className="text-aux text-ink-2">
            {listing.files.filter((f) => f.projectId === scopedProject).length} 个文件
          </span>
          <div>{headerActions}</div>
        </div>
      ) : (
        <PageHeader title="科研文件" count={listing.files.length} actions={headerActions} />
      )}
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        aria-label="上传科研文件"
        disabled={offline}
        onChange={(e) => {
          addFiles([...(e.currentTarget.files || [])]);
          e.currentTarget.value = '';
        }}
      />
      <div
        className={cn('files-upload-zone', hasFilesInScope && 'is-compact', dragging && 'is-dragging')}
        data-testid="file-drop-zone"
      >
        <span className="files-upload-symbol" aria-hidden>
          <FolderOpen size={23} strokeWidth={1.5} />
        </span>
        <div>
          <strong>{dragging ? '松开即可上传' : hasFilesInScope ? '拖入文件即可保存' : '把科研资料放在这里'}</strong>
          <span>单个文件不超过 {formatFileSize(listing.maxFileBytes)}</span>
        </div>
        {!hasFilesInScope && (
          <Button variant="secondary" size="sm" disabled={offline} onClick={() => input.current?.click()}>
            <Plus size={14} aria-hidden />
            选择文件
          </Button>
        )}
      </div>
      <div className="files-status-line">
        <span>
          <HardDrive size={14} aria-hidden />
          {mode === 'local' ? '保存在本机浏览器' : '保存在当前账号'}
          {offline ? ' · 离线中' : ''}
        </span>
        <span
          className="files-quota"
          aria-label={'已使用 ' + formatFileSize(listing.usedBytes) + '，配额 ' + formatFileSize(listing.quotaBytes)}
        >
          <span className="files-quota-track" aria-hidden>
            <i style={{ width: Math.min(100, (listing.usedBytes / Math.max(1, listing.quotaBytes)) * 100) + '%' }} />
          </span>
          {formatFileSize(listing.usedBytes)} / {formatFileSize(listing.quotaBytes)}
        </span>
      </div>
      {error && (
        <div className="files-error" role="alert">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden />
            重试
          </Button>
        </div>
      )}
      {queue.length > 0 && (
        <section className="files-upload-queue panel" aria-label="上传队列">
          {queue.map((row) => (
            <div key={row.id} className="files-upload-row">
              <File size={16} aria-hidden />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-body" title={row.file.name}>
                  {row.file.name}
                </span>
                <span className={row.error ? 'block text-[13px] text-danger' : 'block text-[13px] text-ink-2'}>
                  {row.error || (row.state === 'uploading' ? '正在保存…' : '等待保存')}
                </span>
              </div>
              {row.state === 'uploading' ? (
                <Loader2 size={16} className="animate-spin text-brand" aria-label="正在上传" />
              ) : (
                <>
                  <Button variant="secondary" size="sm" disabled={offline} onClick={() => void uploadEntries([row])}>
                    {row.state === 'failed' ? '重试' : '上传'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={'取消上传：' + row.file.name}
                    onClick={() => changeQueue((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <X size={15} />
                  </Button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      <nav className="files-type-tabs" aria-label="文件类型">
        {FILE_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={busy}
            aria-pressed={category === c.value}
            onClick={() => patch('type', c.value)}
          >
            {c.label}
            <span>{categoryCounts[c.value]}</span>
          </button>
        ))}
      </nav>
      <div className="page-toolbar">
        <div className="relative min-w-[180px] flex-1 sm:max-w-[360px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
            aria-hidden
          />
          <Input
            className="pl-9"
            disabled={busy}
            aria-label="搜索科研文件"
            placeholder="搜索文件名"
            value={query}
            onChange={(e) => patch('q', e.target.value)}
          />
        </div>
        {!scopedProject && (
          <Select
            disabled={busy}
            aria-label="按关联项目筛选文件"
            value={project}
            onChange={(e) => patch('project', e.target.value)}
            className="w-[190px]"
          >
            <option value="">全部项目</option>
            <option value="__none">未关联项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          disabled={busy}
          aria-label="文件排序"
          value={sort}
          onChange={(e) => patch('sort', e.target.value)}
          className="files-sort"
        >
          <option value="">最近更新</option>
          <option value="name">文件名称</option>
          <option value="size">文件大小</option>
        </Select>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="刷新文件列表"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      {selecting && (
        <section className="files-selection-bar" aria-label="文件批量操作">
          <div className="files-selection-count">
            <Checkbox
              label="选择当前列表全部文件"
              checked={allChecked ? true : checked.length ? 'indeterminate' : false}
              disabled={busy || rows.length === 0}
              onCheckedChange={(value) => setCheckedIds(value ? new Set(rows.map((f) => f.id)) : new Set())}
            />
            <span aria-live="polite">已选 {checked.length} 个</span>
          </div>
          <div className="files-selection-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || offline || !checked.length || checked.length > MAX_AI_ATTACHMENTS}
              title={'一次最多附带 ' + MAX_AI_ATTACHMENTS + ' 个文件'}
              onClick={() => navigate(filesAiHref(checked))}
            >
              <Sparkles size={14} aria-hidden />
              交给 AI
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || offline || !checked.length || checked.length > 100}
              onClick={() => {
                setAssignProject(
                  checked.every((f) => f.projectId === checked[0].projectId) ? checked[0].projectId || '' : '',
                );
                setAssignError('');
                setAssignOpen(true);
              }}
            >
              <Link2 size={14} aria-hidden />
              关联项目
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || offline || !checked.length}
              onClick={() => void packageFiles()}
            >
              <FileArchive size={14} aria-hidden />
              打包下载
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              disabled={busy}
              aria-label="清空文件选择"
              onClick={() => setCheckedIds(new Set())}
            >
              <X size={14} />
            </Button>
          </div>
          {checked.length > MAX_AI_ATTACHMENTS && (
            <span className="files-selection-hint">AI 最多附带 {MAX_AI_ATTACHMENTS} 个文件</span>
          )}
        </section>
      )}
      {batchProgress && (
        <div className="files-batch-progress" role="status">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          <span title={batchProgress}>{batchProgress}</span>
          {batchKind === 'archive' && (
            <Button variant="ghost" size="sm" onClick={() => batch.current?.abort()}>
              取消打包
            </Button>
          )}
        </div>
      )}
      {selectedId && !loading && !error && !selected && (
        <div className="files-error" role="alert">
          <span>文件已删除、不在当前项目或不可访问。</span>
          <Button variant="ghost" size="sm" onClick={() => patch('focus', null)}>
            关闭提示
          </Button>
        </div>
      )}
      {loading && listing.files.length === 0 ? (
        <div role="status" className="files-empty">
          <Loader2 size={20} className="animate-spin text-brand" />
          <span>正在读取文件…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="files-empty panel">
          <FolderOpen size={30} className="text-brand" strokeWidth={1.3} />
          <strong>
            {error
              ? '文件列表暂不可用'
              : hasFilters
                ? '没有匹配的文件'
                : scopedProject
                  ? '还没有项目文件'
                  : '还没有科研文件'}
          </strong>
          {hasFilters && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const next = new URLSearchParams(params);
                ['q', 'project', 'type', 'focus'].forEach((key) => next.delete(key));
                setParams(next, { replace: true });
              }}
            >
              清除筛选
            </Button>
          )}
        </div>
      ) : (
        <ul className="files-list panel" aria-label="科研文件列表" aria-busy={loading}>
          {rows.map((file) => {
            const Icon = iconFor(file),
              linked = projects.find((p) => p.id === file.projectId);
            return (
              <li
                key={file.id}
                data-file-id={file.id}
                className={cn((selectedId === file.id || checkedIds.has(file.id)) && 'is-selected')}
              >
                {selecting && (
                  <Checkbox
                    label={'选择文件：' + file.name}
                    checked={checkedIds.has(file.id)}
                    disabled={busy}
                    onCheckedChange={(value) =>
                      setCheckedIds((prev) => {
                        const next = new Set(prev);
                        if (value) next.add(file.id);
                        else next.delete(file.id);
                        return next;
                      })
                    }
                  />
                )}
                <span className="file-kind-icon" data-category={fileCategory(file)} aria-hidden>
                  <Icon size={22} strokeWidth={1.5} />
                </span>
                <button
                  type="button"
                  className="file-name-button"
                  disabled={selecting && busy}
                  aria-pressed={selecting ? checkedIds.has(file.id) : undefined}
                  onClick={() => {
                    if (!selecting) {
                      patch('focus', file.id);
                      return;
                    }
                    setCheckedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(file.id)) next.delete(file.id);
                      else next.add(file.id);
                      return next;
                    });
                  }}
                  title={file.name}
                >
                  <strong>{file.name}</strong>
                  <span>
                    {formatFileSize(file.size)} · {new Date(file.updatedAt).toLocaleDateString('zh-CN')}
                  </span>
                </button>
                <span className="file-project" title={linked?.name}>
                  {linked?.name || (file.projectId ? '项目已删除' : '未关联项目')}
                </span>
                <Button
                  className="file-download"
                  variant="ghost"
                  size="iconSm"
                  aria-label={'下载：' + file.name}
                  onClick={() => void download(file)}
                >
                  <Download size={16} />
                </Button>
                {fileMenu(file)}
              </li>
            );
          })}
        </ul>
      )}
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) patch('focus', null);
        }}
      >
        {selected && (
          <DrawerContent
            title={selected.name}
            label="科研文件详情"
            footer={
              <>
                <Button variant="secondary" onClick={() => void download(selected)}>
                  <Download size={15} aria-hidden />
                  下载
                </Button>
                <Button asChild variant="primary">
                  <Link to={hrefForAi(selected)}>
                    <Sparkles size={15} aria-hidden />
                    交给 AI
                    <ArrowUpRight size={13} aria-hidden />
                  </Link>
                </Button>
              </>
            }
          >
            <FilePreview key={selected.id} file={selected} context={context} />
            <dl className="files-details">
              <div>
                <dt>文件大小</dt>
                <dd>{formatFileSize(selected.size)}</dd>
              </div>
              <div>
                <dt>文件类型</dt>
                <dd>
                  {selected.name.includes('.') ? selected.name.split('.').at(-1)?.toUpperCase() : selected.mimeType}
                </dd>
              </div>
              <div>
                <dt>关联项目</dt>
                <dd>
                  {projects.find((p) => p.id === selected.projectId)?.name ||
                    (selected.projectId ? '项目已删除' : '未关联项目')}
                </dd>
              </div>
              <div>
                <dt>保存时间</dt>
                <dd>{new Date(selected.createdAt).toLocaleString('zh-CN')}</dd>
              </div>
            </dl>
            <div className="px-5 pb-5">
              <Button variant="secondary" size="sm" disabled={offline || busy} onClick={() => openEdit(selected)}>
                <Pencil size={14} aria-hidden />
                重命名与关联
              </Button>
            </div>
          </DrawerContent>
        )}
      </Drawer>
      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          if (!busy) setAssignOpen(open);
        }}
      >
        <DialogContent title="批量关联项目" width="sm">
          <p className="mb-3 text-aux text-ink-2">将更新以下 {checked.length} 个文件的关联项目。</p>
          <ul className="files-assignment-list">
            {checked.slice(0, 5).map((file) => (
              <li key={file.id} title={file.name}>
                {file.name}
              </li>
            ))}
            {checked.length > 5 && <li>另 {checked.length - 5} 个文件</li>}
          </ul>
          <Field label="关联到项目">
            {(id) => (
              <Select id={id} value={assignProject} disabled={busy} onChange={(e) => setAssignProject(e.target.value)}>
                <option value="">不关联项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {assignError && (
            <p className="mt-3 text-aux text-danger" role="alert">
              {assignError}
            </p>
          )}
          <DialogFooter className="-mx-5 -mb-4 mt-5">
            <Button disabled={busy} onClick={() => setAssignOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || !checked.length || offline} onClick={() => void assignFiles()}>
              {busy ? batchProgress || '正在保存…' : assignError ? '重试失败项' : '保存关联'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent title="文件信息" width="sm">
          <div className="flex flex-col gap-4">
            <Field label="文件名">
              {(id) => <Input id={id} value={editName} maxLength={240} onChange={(e) => setEditName(e.target.value)} />}
            </Field>
            <Field label="关联项目">
              {(id) => (
                <Select id={id} value={editProject} onChange={(e) => setEditProject(e.target.value)}>
                  <option value="">不关联项目</option>
                  {editProject && !projects.some((p) => p.id === editProject) && (
                    <option value={editProject}>项目已删除</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {editError && (
            <p role="alert" className="mt-3 text-aux text-danger">
              {editError}
            </p>
          )}
          <DialogFooter className="-mx-5 -mb-4 mt-5">
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || !editName.trim()} onClick={() => void saveEdit()}>
              {busy ? '正在保存…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除这个文件？"
        confirmLabel="删除文件"
        danger
        body={deleting?.name}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
    </div>
  );
}
