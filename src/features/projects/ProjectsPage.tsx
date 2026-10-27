import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  CircleDashed,
  FolderKanban,
  LayoutGrid,
  List,
  Milestone,
  Plus,
  Search,
  Star,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { ProjectStatusBadge } from '@/components/shared/status-badges';
import { RowSkeleton } from '@/components/ui/skeleton';
import { entityTags, isOpenTask, projectProgress, progressLabel } from '@/domain/progress';
import { PROJECT_STATUSES, projectStatusLabels, type Project, type ProjectStatus } from '@/domain/types';
import { formatShortDate } from '@/domain/date';
import { useData } from '@/state/DataContext';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/cx';
import { ProjectFormDialog, emptyProjectDraft } from './ProjectFormDialog';

export function ProjectsPage() {
  const { data, status } = useData();
  const prefs = usePrefs();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);

  const query = params.get('q') ?? '';
  const statusFilter = (params.get('status') ?? 'all') as ProjectStatus | 'all' | 'favorite';
  const view = (params.get('view') ?? prefs.projectView) as 'card' | 'list';
  const onlyFavorite = params.get('favorite') === '1';
  const liveProjects = data.projects.filter((p) => p.deletedAt === null);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.projects
      .filter((p) => p.deletedAt === null)
      .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
      .filter((p) => (onlyFavorite ? p.favorite : true))
      .filter((p) => (q ? [p.name, p.question, p.goal].join(' ').toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [data.projects, query, statusFilter, onlyFavorite]);

  return (
    <div className="projects-page flex flex-col gap-5">
      <PageHeader
        title="科研项目"
        count={projects.length || null}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={15} aria-hidden />
            新建项目
          </Button>
        }
      />

      <nav className="project-stage-nav" aria-label="项目阶段">
        {(['all', ...PROJECT_STATUSES] as const).map((stage) => (
          <button
            type="button"
            key={stage}
            aria-pressed={statusFilter === stage}
            onClick={() => patch('status', stage)}
          >
            <span>{stage === 'all' ? '全部项目' : projectStatusLabels[stage]}</span>
            <span className="stage-count">
              {stage === 'all' ? liveProjects.length : liveProjects.filter((p) => p.status === stage).length}
            </span>
          </button>
        ))}
      </nav>

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
            placeholder="按名称或目标搜索"
            aria-label="搜索项目"
            className="pl-9"
          />
        </div>
        <Button
          variant={onlyFavorite ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => patch('favorite', onlyFavorite ? null : '1')}
          aria-pressed={onlyFavorite}
        >
          <Star size={14} aria-hidden />
          只看收藏
        </Button>
        <div
          className="ml-auto flex items-center gap-1 rounded-control border border-line bg-surface p-0.5"
          role="group"
          aria-label="显示方式"
        >
          {(
            [
              ['card', LayoutGrid, '卡片'],
              ['list', List, '列表'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => patch('view', value)}
              aria-pressed={view === value}
              className={cn(
                'inline-flex h-11 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-aux transition-colors duration-150 lg:h-7',
                view === value ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-2 hover:bg-surface-subtle',
              )}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' ? (
        <RowSkeleton rows={4} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Star size={20} />}
          title={query || statusFilter !== 'all' || onlyFavorite ? '没有符合条件的项目' : '还没有项目'}
          action={
            query || statusFilter !== 'all' || onlyFavorite ? (
              <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                清除筛选
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                新建项目
              </Button>
            )
          }
        />
      ) : view === 'card' ? (
        <ul className="project-portfolio grid gap-5 lg:grid-cols-2">
          {projects.map((p, index) => (
            <li key={p.id}>
              <ProjectCard project={p} index={index} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-body">
            <caption className="sr-only">项目列表</caption>
            <thead>
              <tr className="border-b border-line text-aux text-ink-2">
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  名称
                </th>
                <th scope="col" className="hidden px-4 py-2 text-left font-medium sm:table-cell">
                  状态
                </th>
                <th scope="col" className="hidden px-4 py-2 text-left font-medium md:table-cell">
                  起止
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  进度
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((p) => {
                const progress = projectProgress(data.tasks, p.id);
                return (
                  <tr key={p.id} className="transition-colors duration-150 hover:bg-surface-subtle">
                    <td className="px-4 py-2.5">
                      <Link to={`/projects/${p.id}`} className="flex min-w-0 items-center gap-2">
                        {p.favorite && <Star size={12} className="shrink-0 fill-current text-warning" aria-hidden />}
                        <span className="truncate font-medium hover:text-brand-ink" title={p.name}>
                          {p.name}
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <ProjectStatusBadge status={p.status} />
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-aux text-ink-2 md:table-cell">
                      {p.startDate || p.endDate
                        ? `${formatShortDate(p.startDate)} → ${formatShortDate(p.endDate)}`
                        : '未设日期'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{progressLabel(progress)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        draft={emptyProjectDraft()}
        onSaved={(p) => navigate(`/projects/${p.id}`)}
      />
    </div>
  );
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  const { data } = useData();
  const progress = projectProgress(data.tasks, project.id);
  const tags = entityTags(data, 'project', project.id);
  const tasks = data.tasks.filter(
    (t) => t.deletedAt === null && t.projectId === project.id && t.status !== 'cancelled',
  );
  const nextTask = tasks.filter(isOpenTask).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))[0];
  const milestones = data.milestones
    .filter((m) => m.deletedAt === null && m.projectId === project.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const nextMilestone = milestones.find((m) => !m.done);
  const experiments = data.experiments.filter((e) => e.deletedAt === null && e.projectId === project.id).length;
  return (
    <Link to={'/projects/' + project.id} className="project-card portfolio-card group" data-status={project.status}>
      <div className="portfolio-card-top">
        <span className="portfolio-number">
          <FolderKanban size={16} aria-hidden />
          {String(index + 1).padStart(2, '0')}
        </span>
        <ProjectStatusBadge status={project.status} />
        {project.favorite && <Star size={14} className="fill-current text-warning" aria-label="已收藏" />}
        <ArrowUpRight size={19} className="portfolio-open" aria-hidden />
      </div>
      <h3 title={project.name}>{project.name}</h3>
      <p className="portfolio-question">{project.question || project.goal || '尚未填写研究问题'}</p>
      <div className="portfolio-progress">
        <div>
          <span>任务进度</span>
          <strong>{progressLabel(progress)}</strong>
        </div>
        <span className="portfolio-track" aria-hidden>
          <span style={{ width: (progress.kind === 'value' ? Math.round(progress.ratio * 100) : 0) + '%' }} />
        </span>
        <div>
          <span>
            {tasks.filter((t) => t.status === 'done').length} / {tasks.length} 项完成
          </span>
          <span>{experiments} 条实验</span>
        </div>
      </div>
      <div className="portfolio-next">
        <span className="portfolio-next-kind">
          {nextMilestone ? <Milestone size={15} aria-hidden /> : <CircleDashed size={15} aria-hidden />}
          {nextMilestone ? '下一里程碑' : '下一任务'}
        </span>
        <span title={nextMilestone?.title || nextTask?.title}>
          {nextMilestone?.title || nextTask?.title || '暂无待推进事项'}
        </span>
      </div>
      <div className="portfolio-footer">
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {tags.slice(0, 2).map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </span>
        <span>
          <CalendarDays size={13} aria-hidden />
          {project.endDate ? formatShortDate(project.endDate) + ' 截止' : '未设截止日期'}
        </span>
      </div>
    </Link>
  );
}
