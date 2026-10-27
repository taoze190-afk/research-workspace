import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  ClipboardCopy,
  ExternalLink,
  FileDown,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { RowSkeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ReadingStatusBadge } from '@/components/shared/status-badges';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown';
import { DropdownContent, MenuRow } from '@/components/ui/dropdown';
import { ReferenceFormDialog, emptyReferenceDraft, referenceToDraft } from './ReferenceFormDialog';
import { LibraryTree, type TreeState } from './LibraryTree';
import { CslImportDialog } from './CslImportDialog';
import { useData } from '@/state/DataContext';
import { deleteReference, linkReferenceProject, unlinkReferenceProject, updateReference } from '@/data/repo';
import { entityTags } from '@/domain/progress';
import { doiUrl, hostOf } from '@/lib/url';
import { toCslJson } from '@/lib/csl';
import { toBibtex } from '@/lib/bibtex';
import { toGbt7714 } from '@/lib/citation';
import { downloadTextFile, safeFileName } from '@/lib/download';
import { READING_STATUSES, readingStatusLabels, type ReadingStatus, type Reference } from '@/domain/types';
import { useDebouncedSave } from '@/lib/useDebouncedSave';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cx';
import { aiWorkspaceHref } from '@/features/ai/context';

const NOTE_PROMPTS: {
  key: 'noteQuestion' | 'noteMethod' | 'noteFindings' | 'noteLimits' | 'noteRelevance';
  label: string;
  hint: string;
}[] = [
  { key: 'noteQuestion', label: '研究问题', hint: '这篇想回答什么' },
  { key: 'noteMethod', label: '方法', hint: '怎么做的，数据来自哪' },
  { key: 'noteFindings', label: '主要结论', hint: '作者声称的结果' },
  { key: 'noteLimits', label: '局限', hint: '样本、假设、可复现性' },
  { key: 'noteRelevance', label: '与自己研究的关联', hint: '我能借用或需要反驳的点' },
];

export function LibraryPage() {
  const { data, status, mutate } = useData();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const query = params.get('q') ?? '';
  const reading = (params.get('status') ?? '') as ReadingStatus | 'pending' | '';
  const projectId = params.get('project') ?? '';
  const tag = params.get('tag') ?? '';
  const onlyFavorite = params.get('favorite') === '1';
  const focusId = params.get('focus');

  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (key !== 'focus') next.delete('focus');
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  /** 分类树一次可能改多个筛选（点项目清标签等），一把写回 URL。 */
  const patchTree = (next: Partial<TreeState>) => {
    const params2 = new URLSearchParams(params);
    params2.delete('focus');
    const write = (key: string, value: string | boolean | undefined) => {
      if (!value) params2.delete(key);
      else params2.set(key, typeof value === 'boolean' ? '1' : value);
    };
    write('project', next.project);
    write('tag', next.tag);
    write('status', next.status);
    write('favorite', next.favorite);
    setParams(params2, { replace: true });
  };

  const allTags = useMemo(() => {
    const names = new Set<string>();
    for (const et of data.entityTags) {
      if (et.deletedAt !== null || et.entityType !== 'reference') continue;
      const name = data.tags.find((t) => t.id === et.tagId)?.name;
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [data.entityTags, data.tags]);

  const linkedIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of data.projectReferences) {
      if (link.deletedAt !== null) continue;
      map.set(link.referenceId, [...(map.get(link.referenceId) ?? []), link.projectId]);
    }
    return map;
  }, [data.projectReferences]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inProject = projectId
      ? new Set(
          data.projectReferences
            .filter((link) => link.deletedAt === null && link.projectId === projectId)
            .map((link) => link.referenceId),
        )
      : null;
    return data.references
      .filter((r) => r.deletedAt === null)
      .filter((r) =>
        reading === 'pending' ? r.readingStatus !== 'read' : reading ? r.readingStatus === reading : true,
      )
      .filter((r) => (onlyFavorite ? r.favorite : true))
      .filter((r) => (inProject ? inProject.has(r.id) : true))
      .filter((r) => {
        if (!tag) return true;
        const names = data.entityTags
          .filter((et) => et.deletedAt === null && et.entityType === 'reference' && et.entityId === r.id)
          .map((et) => data.tags.find((t) => t.id === et.tagId)?.name);
        return names.includes(tag);
      })
      .filter((r) => (q ? [r.title, r.authors, r.venue, r.doi].join(' ').toLowerCase().includes(q) : true))
      .sort((a, b) => (a.title || ' ').localeCompare(b.title || ' ', 'zh-CN'));
  }, [
    data.references,
    data.projectReferences,
    data.entityTags,
    data.tags,
    query,
    reading,
    onlyFavorite,
    projectId,
    tag,
  ]);

  const selected: Reference | null = focusId
    ? (data.references.find((r) => r.id === focusId && r.deletedAt === null) ?? null)
    : null;
  const readingQueue = rows
    .filter((r) => r.readingStatus !== 'read')
    .sort(
      (a, b) =>
        Number(b.readingStatus === 'reading') - Number(a.readingStatus === 'reading') || b.updatedAt - a.updatedAt,
    );
  const spotlight = readingQueue[0] ?? rows[0];

  const exportRows = (format: 'csl' | 'bib') => {
    const scope = selected ? [selected] : rows;
    if (scope.length === 0) return;
    const name = safeFileName(selected ? selected.title : '研序文献库', '文献库导出');
    if (format === 'csl') downloadTextFile(`${name}.json`, toCslJson(scope), 'application/json;charset=utf-8');
    else downloadTextFile(`${name}.bib`, toBibtex(scope), 'text/plain;charset=utf-8');
  };

  return (
    <div className="library-page flex flex-col gap-5">
      <PageHeader
        title="文献库"
        count={rows.length || null}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} aria-hidden />
              导入 CSL-JSON
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={rows.length === 0}>
                  <FileDown size={14} aria-hidden />
                  {selected ? '导出这条' : `导出 ${rows.length} 条`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownContent>
                <MenuRow icon={<FileDown size={14} />} onSelect={() => exportRows('csl')}>
                  CSL-JSON
                </MenuRow>
                <MenuRow icon={<FileText size={14} />} onSelect={() => exportRows('bib')}>
                  BibTeX
                </MenuRow>
              </DropdownContent>
            </DropdownMenu>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} aria-hidden />
              新增条目
            </Button>
          </>
        }
      />

      <div className="page-toolbar">
        <div className="relative min-w-[180px] flex-1 sm:max-w-[300px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => patch('q', e.target.value)}
            placeholder="搜标题、作者或 DOI"
            aria-label="搜索文献"
            className="pl-9"
          />
        </div>
        <Select
          value={reading}
          onChange={(e) => patch('status', e.target.value || null)}
          aria-label="按阅读状态筛选"
          className="w-[140px]"
        >
          <option value="">全部状态</option>
          <option value="pending">待读与阅读中</option>
          {READING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {readingStatusLabels[s]}
            </option>
          ))}
        </Select>
        <Select
          value={projectId}
          onChange={(e) => patch('project', e.target.value || null)}
          aria-label="按关联项目筛选"
          className="w-[160px]"
        >
          <option value="">全部项目</option>
          {data.projects
            .filter((p) => p.deletedAt === null)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        {allTags.length > 0 && (
          <Select
            value={tag}
            onChange={(e) => patch('tag', e.target.value || null)}
            aria-label="按标签筛选"
            className="w-[130px]"
          >
            <option value="">全部标签</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        )}
        <Button
          variant={onlyFavorite ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={onlyFavorite}
          onClick={() => patch('favorite', onlyFavorite ? null : '1')}
        >
          <Star size={14} aria-hidden />
          只看收藏
        </Button>
      </div>

      <div className="library-workspace">
        <aside className="library-tree hidden min-w-0 xl:block">
          <div className="panel p-2">
            <LibraryTree
              state={{ project: projectId, tag, status: reading, favorite: onlyFavorite }}
              projects={data.projects.filter((p) => p.deletedAt === null).map((p) => ({ id: p.id, name: p.name }))}
              tags={allTags}
              onSelect={patchTree}
            />
          </div>
        </aside>

        <div
          role="region"
          aria-label="文献索引"
          className={cn('library-catalog min-w-0', selected && 'hidden lg:block')}
        >
          {status === 'loading' ? (
            <RowSkeleton rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BookMarked size={20} />}
              title={query || reading || projectId || tag || onlyFavorite ? '没有匹配的条目' : '还没有文献条目'}
              action={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  新增条目
                </Button>
              }
            />
          ) : (
            <ul className="panel divide-y divide-line overflow-hidden">
              {rows.map((r) => {
                const projects = (linkedIds.get(r.id) ?? [])
                  .map((id) => data.projects.find((p) => p.id === id))
                  .filter(Boolean);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => patch('focus', r.id)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-subtle',
                        selected?.id === r.id && 'bg-brand-soft/50',
                      )}
                      aria-current={selected?.id === r.id}
                    >
                      <span className="reference-spine" aria-hidden>
                        <FileText size={18} strokeWidth={1.4} />
                        <span>{r.year ?? '—'}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-1.5">
                          {r.favorite && (
                            <Star size={12} className="mt-1 shrink-0 fill-current text-warning" aria-hidden />
                          )}
                          <span className="line-clamp-2 text-body font-medium leading-snug" title={r.title}>
                            {r.title || '未命名条目'}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-aux text-ink-2">
                          {[r.authors, r.year, r.venue].filter(Boolean).join(' · ') || '元数据待补'}
                        </span>
                        {projects.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {projects.slice(0, 3).map((p) => (
                              <Badge key={p!.id} tone="muted">
                                {p!.name}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 pt-0.5">
                        <ReadingStatusBadge status={r.readingStatus} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="library-reader min-w-0">
          {selected ? (
            <ReferenceDetail
              key={selected.id}
              reference={selected}
              onBack={() => patch('focus', null)}
              onEdit={() => setEditOpen(true)}
              onDelete={() => setConfirmDelete(true)}
              mutate={mutate}
              projects={data.projects.filter((p) => p.deletedAt === null)}
              linked={linkedIds.get(selected.id) ?? []}
              tags={entityTags(data, 'reference', selected.id)}
            />
          ) : (
            <section className="reading-desk panel hidden lg:block" aria-label="阅读概览">
              <div className="reading-desk-label">
                <BookMarked size={17} aria-hidden />
                阅读桌
              </div>
              {spotlight ? (
                <>
                  <div className="reading-feature">
                    <span className="reading-feature-status">
                      {spotlight.readingStatus === 'reading'
                        ? '继续阅读'
                        : spotlight.readingStatus === 'unread'
                          ? '下一篇待读'
                          : '重访笔记'}
                    </span>
                    <h3>{spotlight.title || '未命名条目'}</h3>
                    <p className="reading-feature-meta">
                      {[spotlight.authors, spotlight.year, spotlight.venue].filter(Boolean).join(' · ')}
                    </p>
                    {(spotlight.noteQuestion || spotlight.noteFindings || spotlight.noteMethod) && (
                      <blockquote>
                        {(spotlight.noteQuestion || spotlight.noteFindings || spotlight.noteMethod).slice(0, 220)}
                      </blockquote>
                    )}
                    <Button variant="primary" size="sm" onClick={() => patch('focus', spotlight.id)}>
                      打开笔记 <ArrowLeft size={14} className="rotate-180" aria-hidden />
                    </Button>
                  </div>
                  {readingQueue.length > 1 && (
                    <div className="reading-queue">
                      <h4>
                        接下来阅读 <span>{readingQueue.length - 1}</span>
                      </h4>
                      {readingQueue.slice(1, 4).map((r, i) => (
                        <button key={r.id} type="button" onClick={() => patch('focus', r.id)}>
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <strong>{r.title || '未命名条目'}</strong>
                          <ReadingStatusBadge status={r.readingStatus} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="reading-feature">
                  <h3>你的阅读空间</h3>
                  <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                    新增条目
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <ReferenceFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        draft={emptyReferenceDraft()}
        onSaved={(r) => patch('focus', r.id)}
        onOpenExisting={(id) => {
          setCreateOpen(false);
          patch('focus', id);
        }}
      />
      {selected && (
        <ReferenceFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          draft={referenceToDraft(selected)}
          onOpenExisting={(id) => {
            setEditOpen(false);
            patch('focus', id);
          }}
        />
      )}
      <CslImportDialog open={importOpen} onOpenChange={setImportOpen} />
      {selected && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          danger
          title="删除这条文献条目？"
          confirmLabel="移到回收站"
          onConfirm={async () => {
            const ok = await mutate(() => deleteReference(selected.id), { success: '已移到回收站' });
            if (ok) patch('focus', null);
          }}
        />
      )}
    </div>
  );
}

function ReferenceDetail({
  reference,
  onBack,
  onEdit,
  onDelete,
  mutate,
  projects,
  linked,
  tags,
}: {
  reference: Reference;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  mutate: (fn: () => Promise<unknown>, options?: { silent?: boolean; success?: string }) => Promise<boolean>;
  projects: { id: string; name: string; deletedAt: number | null }[];
  linked: string[];
  tags: string[];
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({
    noteQuestion: reference.noteQuestion,
    noteMethod: reference.noteMethod,
    noteFindings: reference.noteFindings,
    noteLimits: reference.noteLimits,
    noteRelevance: reference.noteRelevance,
  });
  const toast = useToast();

  const { state: saveState, flush } = useDebouncedSave(draft, (values) =>
    mutate(() => updateReference(reference.id, values), { silent: true }),
  );
  const doi = doiUrl(reference.doi);

  return (
    <section className="panel flex flex-col" aria-label="文献详情">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <Button variant="ghost" size="iconSm" className="lg:hidden" aria-label="返回列表" onClick={onBack}>
          <ArrowLeft size={15} />
        </Button>
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{reference.title || '未命名条目'}</h3>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="AI 协助整理文献"
          title="AI 协助"
          onClick={() =>
            void flush().then((ok) => {
              if (ok)
                navigate(
                  aiWorkspaceHref(
                    `reference:${reference.id}`,
                    '请根据这篇文献已有资料和笔记，整理研究问题、方法、主要结论、局限及与我研究的关联。只使用已有事实，不补造文章内容；可追加笔记或提出阅读任务。',
                    'reference-note',
                  ),
                );
            })
          }
        >
          <Sparkles size={15} aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="条目操作">
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownContent>
            <MenuRow icon={<BookMarked size={14} />} onSelect={() => window.dispatchEvent(new Event('rw:focus-mode'))}>
              进入沉浸模式
            </MenuRow>
            <MenuRow icon={<Pencil size={14} />} onSelect={onEdit}>
              编辑元数据
            </MenuRow>
            <MenuRow
              icon={<Star size={14} />}
              onSelect={() =>
                void mutate(() => updateReference(reference.id, { favorite: !reference.favorite }), { silent: true })
              }
            >
              {reference.favorite ? '取消收藏' : '收藏'}
            </MenuRow>
            <DropdownMenuSeparator />
            <MenuRow
              icon={<ClipboardCopy size={14} />}
              onSelect={async () => {
                try {
                  await navigator.clipboard.writeText(toGbt7714(reference));
                  toast({ title: 'GB/T 7714 已复制', tone: 'success' });
                } catch {
                  toast({ title: '复制失败', description: '浏览器没有给剪贴板权限', tone: 'error' });
                }
              }}
            >
              复制 GB/T 7714
            </MenuRow>
            <MenuRow
              icon={<ClipboardCopy size={14} />}
              onSelect={async () => {
                try {
                  await navigator.clipboard.writeText(toBibtex([reference]));
                  toast({ title: 'BibTeX 已复制', tone: 'success' });
                } catch {
                  toast({ title: '复制失败', description: '浏览器没有给剪贴板权限', tone: 'error' });
                }
              }}
            >
              复制 BibTeX
            </MenuRow>
            <DropdownMenuSeparator />
            <MenuRow icon={<Trash2 size={14} />} danger onSelect={onDelete}>
              移到回收站
            </MenuRow>
          </DropdownContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-col gap-4 px-4 py-3.5">
        <p className="text-aux text-ink-2">
          {[reference.authors, reference.year, reference.venue].filter(Boolean).join(' · ') || '元数据还没补全'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['unread', '待读'],
              ['reading', '阅读中'],
              ['read', '已读'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={reference.readingStatus === value}
              onClick={() =>
                void mutate(() => updateReference(reference.id, { readingStatus: value }), { silent: true })
              }
              className={cn(
                'rounded-full border px-2.5 py-1 text-aux transition-colors duration-150',
                reference.readingStatus === value
                  ? 'border-brand bg-brand-soft font-medium text-brand-ink'
                  : 'border-line text-ink-2 hover:border-line-strong hover:bg-surface-subtle',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {(reference.doi || reference.url) && (
          <div className="flex flex-col gap-1.5 rounded-control border border-line bg-surface-subtle/60 px-3 py-2.5 text-aux">
            {reference.doi && (
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-ink-2">DOI</span>
                <span className="font-mono">{reference.doi}</span>
                {doi ? (
                  <a
                    href={doi}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                  >
                    打开官方解析
                    <ExternalLink size={11} aria-hidden />
                  </a>
                ) : (
                  <span className="text-warning">格式无法解析</span>
                )}
              </p>
            )}
            {reference.url && (
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-ink-2">链接</span>
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 truncate text-brand-ink hover:underline"
                >
                  {hostOf(reference.url)}
                  <ExternalLink size={11} aria-hidden />
                </a>
              </p>
            )}
          </div>
        )}

        <div>
          <h4 className="mb-1.5 text-aux font-semibold text-ink-2">关联项目</h4>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {linked.length === 0 && <span className="text-aux text-ink-2">还没有关联到项目</span>}
            {linked.map((id) => {
              const project = projects.find((p) => p.id === id);
              if (!project) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-aux"
                >
                  <Link to={`/projects/${id}`} className="hover:text-brand-ink hover:underline">
                    {project.name}
                  </Link>
                  <button
                    type="button"
                    aria-label={`解除与「${project.name}」的关联`}
                    title="只解除关联，条目本身保留"
                    className="rounded-full p-0.5 text-ink-2 hover:bg-danger-soft hover:text-danger"
                    onClick={() =>
                      void mutate(() => unlinkReferenceProject(reference.id, id), {
                        success: '已解除关联，条目仍在文献库',
                      })
                    }
                  >
                    <Plus size={10} className="rotate-45" aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
          <Select
            aria-label="添加关联项目"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) void mutate(() => linkReferenceProject(reference.id, id), { success: '已关联' });
            }}
            className="h-8 text-aux"
          >
            <option value="">添加关联项目…</option>
            {projects
              .filter((p) => !linked.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link2 size={12} className="text-ink-2" aria-hidden />
            {tags.map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-line pt-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-aux font-semibold text-ink-2">阅读笔记</h4>
            <span
              role="status"
              aria-live="polite"
              className={cn(
                'inline-flex min-h-6 min-w-[9em] items-center justify-end text-right text-[13px]',
                saveState === 'failed' ? 'text-danger' : saveState === 'saved' ? 'text-brand-ink' : 'text-ink-2',
              )}
            >
              {saveState === 'failed' ? (
                <button type="button" className="underline underline-offset-2" onClick={() => void flush()}>
                  保存失败，重试
                </button>
              ) : saveState === 'saving' ? (
                '正在保存…'
              ) : saveState === 'saved' ? (
                '已保存'
              ) : saveState === 'dirty' ? (
                '有未保存的改动'
              ) : (
                ''
              )}
            </span>
          </div>
          {NOTE_PROMPTS.map((p) => (
            <Field key={p.key} label={p.label}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  placeholder={p.hint}
                  className="min-h-[76px] text-[15px] max-sm:text-[16px]"
                  value={draft[p.key]}
                  onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      </div>
    </section>
  );
}
