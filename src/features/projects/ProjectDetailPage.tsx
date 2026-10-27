import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  CalendarDays,
  CircleDashed,
  Clock3,
  FlaskConical,
  ListChecks,
  Milestone,
  MoreHorizontal,
  Plus,
  Star,
  Tag,
  Target,
  Trash2,
  Archive,
  Pencil,
  Sparkles,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownContent,
  MenuRow,
} from '@/components/ui/dropdown';
import { ProjectStatusBadge, ReadingStatusBadge, ExperimentStatusBadge } from '@/components/shared/status-badges';
import { TagEditor } from '@/components/shared/tag-editor';
import { TaskRow } from '@/features/tasks/TaskRow';
import { TaskDrawer } from '@/features/tasks/TaskDrawer';
import { TaskFormDialog, emptyTaskDraft } from '@/features/tasks/TaskFormDialog';
import { ReferencePicker } from '@/features/library/ReferencePicker';
import { ReferenceFormDialog, emptyReferenceDraft } from '@/features/library/ReferenceFormDialog';
import { ProjectFormDialog, projectToDraft } from './ProjectFormDialog';
import { NotFoundPage } from '@/features/NotFoundPage';
import { useData } from '@/state/DataContext';
import {
  addMilestone,
  createExperiment,
  deleteMilestone,
  deleteProject,
  updateMilestone,
  updateProject,
  linkReferenceProject,
  unlinkReferenceProject,
  setEntityTags,
} from '@/data/repo';
import {
  entityTags,
  projectExperiments,
  projectMilestones,
  projectProgress,
  projectReferences,
  projectTasks,
  progressLabel,
  isOpenTask,
  byUpdated,
} from '@/domain/progress';
import { formatDate, formatShortDate, formatTimestamp } from '@/domain/date';
import type { Task } from '@/domain/types';
import { cn } from '@/lib/cx';
import { aiWorkspaceHref } from '@/features/ai/context';
import { FilesPage } from '@/features/files/FilesPage';
import { ProjectFilesSummary } from '@/features/files/ProjectFilesSummary';

const TABS = [
  { value: 'overview', label: '概览' },
  { value: 'tasks', label: '任务' },
  { value: 'experiments', label: '实验' },
  { value: 'library', label: '文献' },
  { value: 'files', label: '文件' },
];

/** 区块头：统一 14px 标题 + 右侧动作 + 下边框，四个 Tab 共用一套。 */
function SectionHead({
  icon,
  title,
  count,
  action,
}: {
  icon: ReactNode;
  title: string;
  count?: string;
  action?: ReactNode;
}) {
  return (
    <header className="panel-head flex-wrap">
      <h3 className="section-title section-heading text-[14px]">
        <span className="section-icon" aria-hidden>
          {icon}
        </span>
        {title}
        {count && <span className="page-count tabular-nums">{count}</span>}
      </h3>
      {action}
    </header>
  );
}

/** 空列表只留一行浅色文字，必要时配一个动作按钮。 */
function EmptyRow({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p className="text-aux text-ink-2">{title}</p>
      {action}
    </div>
  );
}

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const { data, mutate } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') ?? 'overview';
  const tab = TABS.some((t) => t.value === requestedTab) ? requestedTab : 'overview';

  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [milestoneDraft, setMilestoneDraft] = useState('');
  const [tagDraft, setTagDraft] = useState<string[] | null>(null);

  const project = data.projects.find((p) => p.id === projectId);

  const tasks = useMemo(() => projectTasks(data, projectId), [data, projectId]);
  const experiments = useMemo(() => projectExperiments(data, projectId), [data, projectId]);
  const references = useMemo(() => projectReferences(data, projectId), [data, projectId]);
  const milestones = useMemo(() => projectMilestones(data, projectId), [data, projectId]);
  const tags = useMemo(() => entityTags(data, 'project', projectId), [data, projectId]);
  const progress = projectProgress(data.tasks, projectId);
  const openTasks = tasks.filter(isOpenTask);
  const milestoneDone = milestones.filter((m) => m.done).length;

  if (!project || project.deletedAt !== null) {
    return <NotFoundPage what="项目" backTo="/projects" backLabel="回到项目列表" />;
  }

  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <div className="project-detail flex flex-col gap-3.5">
      <Link to="/projects" className="inline-flex w-fit items-center gap-1.5 text-aux text-ink-2 hover:text-brand-ink">
        <ArrowLeft size={13} aria-hidden />
        科研项目
      </Link>

      <div className={cn('project-identity', tab === 'files' && 'project-identity-files')}>
        <div className="page-head">
          <h2 className="page-title min-w-0 flex-1">
            <span className="min-w-0 truncate" title={project.name}>
              {project.name}
            </span>
          </h2>
          <div className="project-create-actions flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link
                to={aiWorkspaceHref(
                  `project:${project.id}`,
                  '请读取这个项目的目标、任务、里程碑、实验和关联文献，检查进展并给出可执行的下一步计划。需要新增或调整记录时，请提供可采纳的操作。',
                  'next-steps',
                )}
              >
                <Sparkles size={14} aria-hidden />
                AI 协助
              </Link>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setTaskOpen(true)}>
              <Plus size={14} aria-hidden />
              新建任务
            </Button>
          </div>
        </div>

        {project.question && <p className="project-question">{project.question}</p>}
        <div className="page-toolbar text-aux text-ink-2">
          <ProjectStatusBadge status={project.status} />
          <Button asChild variant="ghost" size="sm" className="project-file-shortcut">
            <Link to={'/projects/' + encodeURIComponent(project.id) + '?tab=files'}>
              <Paperclip size={14} aria-hidden />
              科研文件
            </Link>
          </Button>
          <span className="project-metadata inline-flex items-center gap-1.5 tabular-nums">
            <CalendarDays size={13} aria-hidden />
            {project.startDate || project.endDate
              ? `${formatShortDate(project.startDate)} → ${formatShortDate(project.endDate)}`
              : '未设日期'}
          </span>
          <span className="project-metadata inline-flex items-center gap-1.5 tabular-nums">
            <Clock3 size={13} aria-hidden />
            更新于 {formatTimestamp(project.updatedAt)}
          </span>
          {progress.kind === 'value' && (
            <span className="project-metadata inline-flex items-center gap-1.5">
              <span className="h-1 w-[72px] overflow-hidden rounded-full bg-surface-subtle" aria-hidden>
                <span
                  className="block h-full rounded-full bg-brand"
                  style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                />
              </span>
              <span className="tabular-nums">
                {progressLabel(progress)} · {progress.done}/{progress.total}
              </span>
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={project.favorite ? '取消收藏' : '收藏'}
              aria-pressed={project.favorite}
              onClick={() =>
                void mutate(() => updateProject(project.id, { favorite: !project.favorite }), { silent: true })
              }
            >
              <Star size={15} aria-hidden className={project.favorite ? 'fill-current text-warning' : ''} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="iconSm" aria-label="更多操作">
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownContent>
                <MenuRow icon={<Pencil size={14} />} onSelect={() => setEditOpen(true)}>
                  编辑信息
                </MenuRow>
                <MenuRow
                  icon={<Archive size={14} />}
                  onSelect={() =>
                    void mutate(() => updateProject(project.id, { status: 'archived' }), { success: '已归档' })
                  }
                >
                  归档项目
                </MenuRow>
                <DropdownMenuSeparator />
                <MenuRow icon={<Trash2 size={14} />} danger onSelect={() => setDeleteOpen(true)}>
                  移到回收站
                </MenuRow>
              </DropdownContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          className="flex w-full gap-1 overflow-x-auto border-b border-line bg-transparent p-0"
          aria-label="项目内容"
        >
          {TABS.map((t) => {
            const counts: Record<string, number> = {
              tasks: tasks.length,
              experiments: experiments.length,
              library: references.length,
            };
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="relative rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-aux text-ink-2 transition-colors duration-150 hover:text-ink data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-brand-ink"
              >
                {t.label}
                {counts[t.value] > 0 && <span className="ml-1.5 tabular-nums">{counts[t.value]}</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="overview" className="mt-3.5">
          <div className="grid min-w-0 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3.5">
              <section className="project-goal panel px-4 py-3.5">
                <h3 className="section-title section-heading text-[14px]">
                  <Target size={15} className="section-icon" aria-hidden />
                  研究目标
                </h3>
                <p className={cn('mt-2 whitespace-pre-wrap text-body', !project.goal && 'text-ink-2')}>
                  {project.goal || '还没有写目标'}
                </p>
              </section>

              <section className="panel overflow-hidden">
                <SectionHead
                  icon={<Milestone size={15} />}
                  title="里程碑"
                  count={`${milestoneDone}/${milestones.length}`}
                />
                {milestones.length > 0 && (
                  <ul className="divide-y divide-line">
                    {milestones.map((m) => (
                      <li key={m.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                        <Checkbox
                          checked={m.done}
                          label={`完成里程碑：${m.title}`}
                          onCheckedChange={(v) =>
                            void mutate(() => updateMilestone(m.id, { done: v }), { silent: true })
                          }
                        />
                        <span className={cn('min-w-0 flex-1 truncate text-body', m.done && 'text-ink-2 line-through')}>
                          {m.title}
                        </span>
                        {m.dueDate && (
                          <span className="shrink-0 text-aux tabular-nums text-ink-2">
                            {formatShortDate(m.dueDate)}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="iconSm"
                          aria-label={`删除里程碑 ${m.title}`}
                          onClick={() => void mutate(() => deleteMilestone(m.id), { silent: true })}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="flex gap-1.5 border-t border-line px-3.5 py-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const clean = milestoneDraft.trim();
                    if (!clean) return;
                    await mutate(() => addMilestone({ projectId: project.id, title: clean }), { silent: true });
                    setMilestoneDraft('');
                  }}
                >
                  <Input
                    className="min-w-0"
                    value={milestoneDraft}
                    onChange={(e) => setMilestoneDraft(e.target.value)}
                    placeholder="加一个里程碑"
                    aria-label="新增里程碑"
                  />
                  <Button type="submit" variant="secondary" disabled={!milestoneDraft.trim()}>
                    <Plus size={15} aria-hidden />
                    添加
                  </Button>
                </form>
              </section>

              <section className="panel overflow-hidden">
                <SectionHead
                  icon={<ListChecks size={15} />}
                  title="未完成任务"
                  count={openTasks.length ? String(openTasks.length) : undefined}
                  action={
                    <button
                      type="button"
                      onClick={() => setTab('tasks')}
                      className="text-aux text-ink-2 hover:text-brand-ink"
                    >
                      看全部
                    </button>
                  }
                />
                {openTasks.length === 0 ? (
                  <EmptyRow
                    title="这个项目没有待办"
                    action={
                      <Button variant="primary" size="sm" onClick={() => setTaskOpen(true)}>
                        新建任务
                      </Button>
                    }
                  />
                ) : (
                  openTasks
                    .slice(0, 6)
                    .map((t) => <TaskRow key={t.id} task={t} showProject={false} onOpen={setDetailTask} />)
                )}
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-3.5">
              <ProjectFilesSummary projectId={project.id} />
              <section className="panel px-4 py-3.5">
                <h3 className="section-title section-heading mb-2 text-[14px]">
                  <Tag size={15} className="section-icon" aria-hidden />
                  标签
                </h3>
                <TagEditor
                  value={tagDraft ?? tags}
                  onChange={(next) => {
                    setTagDraft(next);
                    void mutate(() => setEntityTags('project', project.id, next), { silent: true }).then((ok) => {
                      if (ok) setTagDraft(null);
                    });
                  }}
                />
              </section>

              <section className="panel px-4 py-3.5">
                <h3 className="section-title section-heading mb-2 text-[14px]">
                  <Clock3 size={15} className="section-icon" aria-hidden />
                  最近更新
                </h3>
                <ul className="flex flex-col gap-2 text-body">
                  {(() => {
                    const rows = [
                      ...experiments.map((e) => ({
                        id: e.id,
                        title: e.title || '未命名实验',
                        href: `/experiments/${e.id}`,
                        kind: 'experiment' as const,
                        updatedAt: e.updatedAt,
                      })),
                      ...tasks.map((t) => ({
                        id: t.id,
                        title: t.title || '未命名任务',
                        href: `/tasks?focus=${t.id}`,
                        kind: 'task' as const,
                        updatedAt: t.updatedAt,
                      })),
                    ];
                    return byUpdated(rows, 4).map((r) => (
                      <li key={r.href}>
                        <Link to={r.href} className="flex items-center gap-2 text-ink-2 hover:text-brand-ink">
                          {r.kind === 'task' ? (
                            <CircleDashed size={13} aria-hidden />
                          ) : (
                            <FlaskConical size={13} aria-hidden />
                          )}
                          <span className="min-w-0 flex-1 truncate" title={r.title}>
                            {r.title}
                          </span>
                        </Link>
                      </li>
                    ));
                  })()}
                  {experiments.length + tasks.length === 0 && <li className="text-aux text-ink-2">还没有实验或任务</li>}
                </ul>
              </section>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-3.5">
          <FilesPage projectId={project.id} embedded />
        </TabsContent>
        <TabsContent value="tasks" className="mt-3.5">
          <section className="panel overflow-hidden">
            <SectionHead
              icon={<ListChecks size={15} />}
              title="任务"
              count={tasks.length ? String(tasks.length) : undefined}
              action={
                <Button variant="secondary" size="sm" onClick={() => setTaskOpen(true)}>
                  <Plus size={14} aria-hidden />
                  新建任务
                </Button>
              }
            />
            {tasks.length === 0 ? (
              <EmptyRow
                title="还没有任务"
                action={
                  <Button variant="primary" size="sm" onClick={() => setTaskOpen(true)}>
                    新建任务
                  </Button>
                }
              />
            ) : (
              tasks.map((t) => <TaskRow key={t.id} task={t} showProject={false} onOpen={setDetailTask} />)
            )}
          </section>
        </TabsContent>

        <TabsContent value="experiments" className="mt-3.5">
          <section className="panel overflow-hidden">
            <SectionHead
              icon={<FlaskConical size={15} />}
              title="实验记录"
              count={experiments.length ? String(experiments.length) : undefined}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    let id = '';
                    await mutate(
                      async () => {
                        const row = await createExperiment({ projectId: project.id });
                        id = row.id;
                      },
                      { silent: true },
                    );
                    if (id) navigate(`/experiments/${id}`);
                  }}
                >
                  <Plus size={14} aria-hidden />
                  新建实验
                </Button>
              }
            />
            {experiments.length === 0 ? (
              <EmptyRow
                title="还没有实验记录"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      let id = '';
                      await mutate(
                        async () => {
                          const row = await createExperiment({ projectId: project.id });
                          id = row.id;
                        },
                        { silent: true },
                      );
                      if (id) navigate(`/experiments/${id}`);
                    }}
                  >
                    新建实验
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {byUpdated(experiments).map((e) => (
                  <li key={e.id}>
                    <Link
                      to={`/experiments/${e.id}`}
                      className="flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-surface-subtle"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium">{e.title || '未命名实验'}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-aux text-ink-2">
                          <span className="tabular-nums">{formatDate(e.experimentDate)}</span>
                          {e.nextStep && <span className="truncate">下一步：{e.nextStep}</span>}
                        </span>
                      </span>
                      <ExperimentStatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="library" className="mt-3.5">
          <section className="panel overflow-hidden">
            <SectionHead
              icon={<BookMarked size={15} />}
              title="关联文献"
              count={references.length ? String(references.length) : undefined}
              action={
                <div className="flex gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                    <BookMarked size={14} aria-hidden />
                    选择已有文献
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setReferenceOpen(true)}>
                    <Plus size={14} aria-hidden />
                    新增条目
                  </Button>
                </div>
              }
            />
            {references.length === 0 ? (
              <EmptyRow
                title="还没有关联文献"
                action={
                  <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                    选择已有文献
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {references.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-3.5 py-3">
                    <span className="min-w-0 flex-1">
                      <Link
                        to={`/library?focus=${r.id}`}
                        className="line-clamp-2 text-body font-medium leading-snug hover:text-brand-ink"
                        title={r.title}
                      >
                        {r.title || '未命名条目'}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-aux text-ink-2">
                        {[r.authors, r.year, r.venue].filter(Boolean).join(' · ')}
                        <ReadingStatusBadge status={r.readingStatus} />
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`从本项目移除关联：${r.title}`}
                      onClick={() =>
                        void mutate(() => unlinkReferenceProject(r.id, project.id), { success: '已解除关联' })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} draft={emptyTaskDraft({ projectId: project.id })} />
      <TaskDrawer task={detailTask} open={detailTask !== null} onOpenChange={(v) => !v && setDetailTask(null)} />
      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        draft={projectToDraft(project)}
        onSaved={() => setEditOpen(false)}
      />
      <ReferencePicker open={pickerOpen} onOpenChange={setPickerOpen} projectId={project.id} />
      <ReferenceFormDialog
        open={referenceOpen}
        onOpenChange={setReferenceOpen}
        draft={emptyReferenceDraft()}
        onSaved={async (ref) => {
          await mutate(() => linkReferenceProject(ref.id, project.id), { silent: true });
          setTab('library');
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        danger
        title="把项目移到回收站？"
        confirmLabel="移到回收站"
        body={
          <div className="flex flex-col gap-1.5">
            <p>{milestones.length} 个里程碑一起进回收站。</p>
            <p>
              {tasks.length} 条任务与 {experiments.length} 条实验不受影响。
            </p>
          </div>
        }
        onConfirm={() => {
          void mutate(() => deleteProject(project.id), { success: '已移到回收站' });
          navigate('/projects');
        }}
      />
    </div>
  );
}
