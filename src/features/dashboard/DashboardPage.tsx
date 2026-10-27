import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookMarked,
  CalendarDays,
  CalendarRange,
  CircleDashed,
  Clock3,
  FlaskConical,
  FolderKanban,
  ListTodo,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyStateGuide } from '@/components/shared/empty-state-guide';
import { QuickInputBar } from '@/components/shared/quick-input-bar';
import { Heatmap } from '@/components/shared/heatmap';
import { ProgressBar, StackedBar } from '@/components/shared/viz';
import { RowSkeleton } from '@/components/ui/skeleton';
import { TaskRow } from '@/features/tasks/TaskRow';
import { TaskDrawer } from '@/features/tasks/TaskDrawer';
import { NewMenu } from '@/app/NewMenu';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { usePrefs, setPrefs } from '@/lib/prefs';
import { createTask } from '@/data/repo';
import { loadReplicationTemplate, loadSurveyTemplate } from '@/data/demo-templates';
import {
  dashboardSummary,
  isOverdue,
  isOpenTask,
  projectProgress,
  taskStatusSegments,
  tasksDueWithin,
} from '@/domain/progress';
import { formatDate, formatShortDate, localToday, weekdayLabel } from '@/domain/date';
import { readingStatusLabels, type Task } from '@/domain/types';
import { cn } from '@/lib/cx';
import { aiWorkspaceHref } from '@/features/ai/context';

export function DashboardPage() {
  const { data, status, mutate, refresh } = useData();
  const prefs = usePrefs();
  const toast = useToast();
  const today = localToday();
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const summary = useMemo(() => dashboardSummary(data, today), [data, today]);
  const liveTasks = useMemo(() => data.tasks.filter((t) => t.deletedAt === null), [data.tasks]);
  const liveProjects = useMemo(() => data.projects.filter((p) => p.deletedAt === null), [data.projects]);

  const todayTasks = useMemo(() => {
    const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const sort = (rows: Task[]) =>
      [...rows].sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title, 'zh-CN'));
    return {
      overdue: sort(liveTasks.filter((t) => isOverdue(t, today))),
      dueToday: sort(liveTasks.filter((t) => isOpenTask(t) && t.dueDate === today)),
    };
  }, [liveTasks, today]);

  const activeProjects = useMemo(
    () =>
      data.projects
        .filter((p) => p.deletedAt === null && (p.status === 'active' || p.status === 'paused'))
        .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')),
    [data.projects],
  );

  const upcoming = useMemo(() => tasksDueWithin(data, 7, today), [data, today]);

  const recentExperiments = useMemo(
    () =>
      data.experiments
        .filter((e) => e.deletedAt === null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4),
    [data.experiments],
  );
  const recentReferences = useMemo(
    () =>
      [...data.references.filter((r) => r.deletedAt === null)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [data.references],
  );
  const readingSegments = useMemo(() => {
    const live = data.references.filter((r) => r.deletedAt === null);
    const count = (s: 'unread' | 'reading' | 'read') => live.filter((r) => r.readingStatus === s).length;
    return [
      { key: 'unread', label: '待读', value: count('unread'), color: 'var(--border-strong)' },
      { key: 'reading', label: '阅读中', value: count('reading'), color: 'var(--info)' },
      { key: 'read', label: '已读', value: count('read'), color: 'var(--success)' },
    ];
  }, [data.references]);

  const planned = todayTasks.overdue.length + todayTasks.dueToday.length;

  const loadTemplate = (which: 'replication' | 'survey') => async () => {
    if (templateBusy) return;
    setTemplateBusy(true);
    const ok = await mutate(
      async () => {
        if (which === 'replication') await loadReplicationTemplate();
        else await loadSurveyTemplate();
      },
      { silent: true },
    );
    setTemplateBusy(false);
    if (!ok) return;
    setPrefs({ demoLoadedAt: prefs.demoLoadedAt ?? Date.now() });
    await refresh();
    toast({ title: '示例模板已载入', tone: 'success' });
  };

  const templateActions = (
    <>
      <Button variant="primary" size="sm" disabled={templateBusy} onClick={() => void loadTemplate('survey')}>
        载入调研模板
      </Button>
      <Button variant="secondary" size="sm" disabled={templateBusy} onClick={() => void loadTemplate('replication')}>
        载入复现模板
      </Button>
    </>
  );

  return (
    <div className="dashboard-page flex flex-col gap-5">
      <div className="dashboard-welcome research-day">
        <div>
          <span className="dashboard-date">
            <CalendarDays size={13} aria-hidden />
            {formatDate(today)} · {weekdayLabel(today)}
          </span>
          <h2>工作台</h2>
          <p>{planned > 0 ? `${planned} 项待办，${activeProjects.length} 个课题正在推进` : '今日无到期任务'}</p>
        </div>
        {[...todayTasks.overdue, ...todayTasks.dueToday][0] && (
          <button
            className="day-next"
            type="button"
            onClick={() => setDetailTask([...todayTasks.overdue, ...todayTasks.dueToday][0])}
          >
            <span className="day-next-label">
              <CircleDashed size={14} aria-hidden />
              优先处理
            </span>
            <strong>{[...todayTasks.overdue, ...todayTasks.dueToday][0].title}</strong>
            <span className="day-next-action">
              查看任务 <ArrowRight size={15} aria-hidden />
            </span>
          </button>
        )}
        <div className="day-create flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link
              to={aiWorkspaceHref(
                'workspace',
                '检查当前工作台的逾期、阻塞和近期实验进度，结合已有记录安排下一步；为明确事项提出可采纳的任务建议，不重复已有任务。',
                'progress-review',
              )}
            >
              <Sparkles size={14} aria-hidden />
              AI 检查
            </Link>
          </Button>
          <NewMenu variant="primary" size="sm" />
        </div>
      </div>

      <nav className="research-ledger" aria-label="概览">
        {[
          { label: '进行中项目', value: summary.activeProjects, href: '/projects?status=active', icon: FolderKanban },
          { label: '今日待办', value: summary.todayOpen, href: '/tasks?filter=today', icon: ListTodo },
          { label: '逾期任务', value: summary.overdue, href: '/tasks?filter=overdue', icon: Clock3 },
          { label: '待读文献', value: summary.unreadReferences, href: '/library?status=pending', icon: BookMarked },
        ].map(({ label, value, href, icon: Icon }) => (
          <Link key={href} to={href}>
            <Icon size={17} aria-hidden />
            <span>{label}</span>
            <strong className="stat-value">{value}</strong>
            <ArrowRight size={14} aria-hidden />
          </Link>
        ))}
      </nav>

      <div className="dashboard-columns grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="today-title" className="panel dashboard-panel overflow-hidden">
            <header className="panel-head">
              <h3 id="today-title" className="section-title section-heading text-[14px]">
                <ListTodo size={15} className="section-icon" aria-hidden />
                今日任务
                {todayTasks.overdue.length > 0 && (
                  <span className="ml-1 rounded-full bg-danger-soft px-1.5 py-px text-[13px] font-medium tabular-nums text-danger">
                    逾期 {todayTasks.overdue.length}
                  </span>
                )}
              </h3>
              <Link to="/tasks" className="inline-flex items-center gap-1 text-aux text-ink-2 hover:text-brand-ink">
                全部
                <ArrowRight size={13} aria-hidden />
              </Link>
            </header>
            <QuickInputBar
              className="dashboard-quick-input"
              projects={liveProjects}
              busy={templateBusy}
              onCreate={async (parsed) =>
                mutate(
                  () =>
                    createTask({
                      title: parsed.title,
                      // 工作台的捕获条在「今日任务」面板上方：默认今天到期，创建即可见
                      dueDate: parsed.dueDate ?? today,
                      priority: parsed.priority as 'urgent' | 'high' | 'medium' | 'low',
                      projectId: parsed.projectId,
                    }),
                  {
                    success: '已添加',
                  },
                )
              }
            />

            {status === 'loading' ? (
              <div className="p-3">
                <RowSkeleton rows={3} />
              </div>
            ) : planned === 0 ? (
              <div className="p-2">
                <EmptyStateGuide compact title="今天没有到期任务" actions={templateActions} />
              </div>
            ) : (
              <div>
                {todayTasks.overdue.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setDetailTask} showProject={false} />
                ))}
                {todayTasks.dueToday.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setDetailTask} showProject={false} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="focus-title" className="panel dashboard-panel overflow-hidden">
            <header className="panel-head">
              <h3 id="focus-title" className="section-title section-heading text-[14px]">
                <FolderKanban size={15} className="section-icon" aria-hidden />
                正在推进
              </h3>
              <Link to="/projects" className="inline-flex items-center gap-1 text-aux text-ink-2 hover:text-brand-ink">
                全部
                <ArrowRight size={13} aria-hidden />
              </Link>
            </header>
            {activeProjects.length === 0 ? (
              <div className="p-2">
                <EmptyStateGuide compact title="还没有进行中的课题" actions={templateActions} />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {activeProjects.slice(0, 4).map((p) => {
                  const progress = projectProgress(data.tasks, p.id);
                  const next =
                    liveTasks.find((t) => t.projectId === p.id && isOpenTask(t) && t.dueDate === today) ??
                    liveTasks.find((t) => t.projectId === p.id && isOpenTask(t));
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
                        className="block px-4 py-3 transition-colors duration-150 hover:bg-surface-subtle"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span
                              className="grid size-7 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand-ink"
                              aria-hidden
                            >
                              <FolderKanban size={14} />
                            </span>
                            <span className="min-w-0 truncate text-body font-medium" title={p.name}>
                              {p.name}
                            </span>
                            {p.status === 'paused' && <span className="shrink-0 text-aux text-warning">已暂停</span>}
                          </span>
                          <span className="w-[96px] shrink-0">
                            <ProgressBar ratio={progress.kind === 'value' ? progress.ratio : null} />
                          </span>
                        </div>
                        {next && (
                          <span className="mt-1 flex items-center gap-1.5 pl-9.5 text-aux text-ink-2">
                            <CircleDashed size={12} aria-hidden />
                            <span className="truncate" title={next.title}>
                              {next.title}
                            </span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="rhythm-title" className="panel research-rhythm p-4">
            <h3 id="rhythm-title" className="section-title section-heading mb-3 text-[14px]">
              <Activity size={15} className="section-icon" aria-hidden />
              推进节奏
            </h3>
            <Heatmap tasks={liveTasks} experiments={data.experiments} weeks={52} today={today} />
            <div className="mt-4 border-t border-line pt-3">
              <StackedBar segments={taskStatusSegments(liveTasks)} />
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="ref-title" className="panel dashboard-panel overflow-hidden">
            <header className="panel-head">
              <h3 id="ref-title" className="section-title section-heading text-[14px]">
                <BookMarked size={15} className="section-icon" aria-hidden />
                文献库
              </h3>
              <Link to="/library" className="text-aux text-ink-2 hover:text-brand-ink">
                全部
              </Link>
            </header>
            <div className="px-3.5 py-3">
              <StackedBar segments={readingSegments} />
            </div>
            {recentReferences.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {recentReferences.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/library?focus=${r.id}`}
                      className="flex items-start gap-2 px-3.5 py-2 transition-colors duration-150 hover:bg-surface-subtle"
                    >
                      <BookMarked size={12} className="mt-1 shrink-0 text-ink-2" aria-hidden />
                      <span className="line-clamp-2 min-w-0 flex-1 text-body leading-snug" title={r.title}>
                        {r.title || '未命名条目'}
                      </span>
                      <span className="shrink-0 pt-0.5 text-aux text-ink-2">
                        {readingStatusLabels[r.readingStatus]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="border-t border-line p-2">
                <EmptyStateGuide
                  compact
                  title="文献库还是空的"
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={templateBusy}
                      onClick={() => void loadTemplate('survey')}
                    >
                      载入调研模板
                    </Button>
                  }
                />
              </div>
            )}
          </section>

          <section aria-labelledby="exp-title" className="panel dashboard-panel overflow-hidden">
            <header className="panel-head">
              <h3 id="exp-title" className="section-title section-heading text-[14px]">
                <FlaskConical size={15} className="section-icon" aria-hidden />
                最近实验
              </h3>
              <Link to="/experiments" className="text-aux text-ink-2 hover:text-brand-ink">
                全部
              </Link>
            </header>
            {recentExperiments.length === 0 ? (
              <div className="p-2">
                <EmptyStateGuide
                  compact
                  title="还没有实验记录"
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={templateBusy}
                      onClick={() => void loadTemplate('replication')}
                    >
                      载入复现模板
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {recentExperiments.map((e) => (
                  <li key={e.id}>
                    <Link
                      to={`/experiments/${e.id}`}
                      className="flex items-center gap-2 px-3.5 py-2 transition-colors duration-150 hover:bg-surface-subtle"
                    >
                      <FlaskConical
                        size={12}
                        className={cn('shrink-0', e.status === 'active' ? 'anim-breathe text-info' : 'text-ink-2')}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-body" title={e.title || '未命名实验'}>
                        {e.title || '未命名实验'}
                      </span>
                      <span className="shrink-0 text-aux tabular-nums text-ink-2">
                        {formatShortDate(e.experimentDate)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="week-title" className="panel dashboard-panel overflow-hidden">
            <h3 id="week-title" className="section-title section-heading panel-head">
              <CalendarRange size={15} className="section-icon" aria-hidden />
              未来七天
            </h3>
            {upcoming.length === 0 ? (
              <p className="px-4 py-4 text-aux text-ink-2">这七天没有到期安排</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.slice(0, 6).map((t) => {
                  const project = data.projects.find((p) => p.id === t.projectId);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setDetailTask(t)}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-surface-subtle"
                      >
                        <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[8px] bg-brand-soft text-[13px] font-medium tabular-nums text-brand-ink">
                          {formatShortDate(t.dueDate)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body" title={t.title}>
                            {t.title}
                          </span>
                          {project && <span className="block truncate text-aux text-ink-2">{project.name}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <TaskDrawer task={detailTask} open={detailTask !== null} onOpenChange={(v) => !v && setDetailTask(null)} />
    </div>
  );
}
