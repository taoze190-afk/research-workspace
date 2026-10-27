import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardCopy, FlaskConical, LayoutList, Plus, Search, Copy, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { RowSkeleton } from '@/components/ui/skeleton';
import { ExperimentStatusBadge } from '@/components/shared/status-badges';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { createExperiment } from '@/data/repo';
import { entityTags } from '@/domain/progress';
import { experimentsToLatexTable } from './export';
import { EXPERIMENT_STATUSES, experimentStatusLabels, type Experiment, type ExperimentStatus } from '@/domain/types';
import { formatDate, localToday } from '@/domain/date';
import { cn } from '@/lib/cx';

const rowFields = (e: Experiment) => ({
  model: e.dataSources.find((d) => d.kind === 'model')?.label ?? '',
  params: e.dataSources
    .filter((d) => d.kind === 'param')
    .map((d) => d.label)
    .join('; '),
  metrics: e.dataSources
    .filter((d) => d.kind === 'metric')
    .map((d) => d.label)
    .join('; '),
});

export function ExperimentsPage() {
  const { data, status, mutate } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const projectId = params.get('project') ?? '';
  const expStatus = (params.get('status') ?? '') as ExperimentStatus | '';
  const view = (params.get('view') ?? 'list') as 'list' | 'matrix';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const liveExperiments = data.experiments.filter((e) => e.deletedAt === null);

  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.experiments
      .filter((e) => e.deletedAt === null)
      .filter((e) => (projectId ? (projectId === '__none' ? e.projectId === null : e.projectId === projectId) : true))
      .filter((e) => (expStatus ? e.status === expStatus : true))
      .filter((e) =>
        q
          ? [e.title, e.purpose, e.hypothesis, e.method, e.results, e.observations, e.conclusion, e.nextStep]
              .join(' ')
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) =>
        a.experimentDate < b.experimentDate ? 1 : a.experimentDate > b.experimentDate ? -1 : b.updatedAt - a.updatedAt,
      );
  }, [data.experiments, query, projectId, expStatus]);

  const newExperiment = async () => {
    if (creating) return;
    setCreating(true);
    let id = '';
    await mutate(
      async () => {
        const row = await createExperiment({
          title: '',
          experimentDate: localToday(),
          projectId: projectId && projectId !== '__none' ? projectId : null,
        });
        id = row.id;
      },
      { silent: true },
    );
    setCreating(false);
    if (id) navigate(`/experiments/${id}`);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Experiment[]>();
    for (const e of rows) {
      const key = e.experimentDate.slice(0, 7) || '未填日期';
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [rows]);

  const selectedRows = rows.filter((e) => selected.has(e.id));
  const exportLatex = async () => {
    const latex = experimentsToLatexTable(
      selectedRows.map((e) => ({
        title: e.title || '未命名实验',
        status: experimentStatusLabels[e.status],
        ...rowFields(e),
      })),
    );
    try {
      await navigator.clipboard.writeText(latex);
      toast({ title: `已复制 ${selectedRows.length} 条的 LaTeX 表格`, tone: 'success' });
    } catch {
      toast({ title: '复制失败', description: '浏览器没有给剪贴板权限', tone: 'error' });
    }
  };

  return (
    <div className="experiments-page flex flex-col gap-5">
      <PageHeader
        title="实验记录"
        count={rows.length || null}
        actions={
          <>
            {view === 'matrix' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedRows.length === 0}
                onClick={() => void exportLatex()}
              >
                <ClipboardCopy size={14} aria-hidden />
                导出 LaTeX{selectedRows.length > 0 ? `（${selectedRows.length}）` : ''}
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={creating} onClick={() => void newExperiment()}>
              <Plus size={15} aria-hidden />
              新建实验
            </Button>
          </>
        }
      />

      <nav className="experiment-status-nav" aria-label="实验状态">
        <button type="button" aria-pressed={!expStatus} onClick={() => patch('status', null)}>
          全部记录 <span>{liveExperiments.length}</span>
        </button>
        {EXPERIMENT_STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={expStatus === s} onClick={() => patch('status', s)}>
            <span className="experiment-status-dot" data-status={s} aria-hidden />
            {experimentStatusLabels[s]}
            <span>{liveExperiments.filter((e) => e.status === s).length}</span>
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
            placeholder="搜标题或正文"
            aria-label="搜索实验"
            className="pl-9"
          />
        </div>
        <Select
          value={projectId}
          onChange={(e) => patch('project', e.target.value || null)}
          aria-label="按项目筛选"
          className="w-[160px]"
        >
          <option value="">全部项目</option>
          <option value="__none">未关联项目</option>
          {data.projects
            .filter((p) => p.deletedAt === null)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        <div className="seg ml-auto flex-wrap" role="group" aria-label="视图">
          {(
            [
              ['list', LayoutList, '列表'],
              ['matrix', Table2, '参数表'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => patch('view', value === 'list' ? null : value)}
              aria-pressed={view === value}
              className={cn(
                'inline-flex h-11 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-aux transition-colors duration-150 lg:h-7',
                view === value ? 'text-ink' : 'text-ink-2 hover:bg-surface-subtle',
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
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={20} />}
          title={query || projectId || expStatus ? '没有匹配的实验记录' : '还没有实验记录'}
          action={
            <Button variant="primary" disabled={creating} onClick={() => void newExperiment()}>
              新建实验
            </Button>
          }
        />
      ) : view === 'matrix' ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-subtle/60 text-aux text-ink-2">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    className="size-[15px] accent-[var(--brand)]"
                    checked={selectedRows.length === rows.length && rows.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2 font-medium">实验</th>
                <th className="px-2 py-2 font-medium">模型</th>
                <th className="px-2 py-2 font-medium">超参数</th>
                <th className="px-2 py-2 font-medium">指标</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2 font-medium">Commit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => {
                const fields = rowFields(e);
                return (
                  <tr
                    key={e.id}
                    className={cn(
                      'transition-colors duration-150 hover:bg-surface-subtle/60',
                      selected.has(e.id) && 'bg-brand-soft/40',
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`选择「${e.title || '未命名实验'}」`}
                        className="size-[15px] accent-[var(--brand)]"
                        checked={selected.has(e.id)}
                        onChange={(ev) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (ev.target.checked) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="max-w-[220px] px-2 py-2">
                      <Link
                        to={`/experiments/${e.id}`}
                        className="block truncate text-body font-medium hover:text-brand-ink"
                        title={e.title}
                      >
                        {e.title || '未命名实验'}
                      </Link>
                      <span className="text-aux tabular-nums text-ink-2">{e.experimentDate}</span>
                    </td>
                    <td className="max-w-[140px] truncate px-2 py-2 font-mono text-aux" title={fields.model}>
                      {fields.model || '—'}
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-2 font-mono text-aux" title={fields.params}>
                      {fields.params || '—'}
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2 font-mono text-aux" title={fields.metrics}>
                      {fields.metrics || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <ExperimentStatusBadge status={e.status} />
                    </td>
                    <td className="max-w-[110px] truncate px-2 py-2 font-mono text-aux" title={e.commit}>
                      {e.commit || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="experiment-notebook flex flex-col gap-5">
          {grouped.map(([month, items]) => (
            <section key={month} aria-label={`${month} 的实验记录`} className="experiment-month">
              <h3 className="experiment-month-label">
                <span>{month.slice(0, 4)}</span>
                <strong>
                  {month.slice(5)}
                  <small>月</small>
                </strong>
                <span>{items.length} 条记录</span>
              </h3>
              <ul className="experiment-timeline">
                {items.map((e) => {
                  const project = data.projects.find((p) => p.id === e.projectId);
                  const tags = entityTags(data, 'experiment', e.id);
                  const preview = [e.results, e.observations, e.method].find((t) => t.trim()) ?? '';
                  return (
                    <li key={e.id}>
                      <Link to={`/experiments/${e.id}`} className="experiment-entry">
                        <time
                          dateTime={e.experimentDate}
                          className="experiment-entry-date"
                          title={formatDate(e.experimentDate)}
                        >
                          <strong>{e.experimentDate.slice(-2) || '—'}</strong>
                          <span>{e.experimentDate.slice(5, 7)} 月</span>
                        </time>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium" title={e.title}>
                            {e.title || '未命名实验'}
                          </span>
                          {preview && (
                            <span className="mt-0.5 line-clamp-2 block text-aux leading-snug text-ink-2">
                              {preview.replace(/[#*`>-]/g, '').slice(0, 160)}
                            </span>
                          )}
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {project && <Badge tone="muted">{project.name}</Badge>}
                            {tags.map((t) => (
                              <Badge key={t} tone="neutral">
                                {t}
                              </Badge>
                            ))}
                            {e.dataSources.length > 0 && (
                              <Badge tone="neutral">
                                <Copy size={10} aria-hidden />
                                {e.dataSources.length} 个来源
                              </Badge>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 pt-0.5">
                          <ExperimentStatusBadge status={e.status} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
