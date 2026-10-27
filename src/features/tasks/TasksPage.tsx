import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  FolderKanban,
  KanbanSquare,
  List,
  Plus,
  Search,
  CircleDashed,
  CalendarClock,
  CalendarRange,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { QuickInputBar } from '@/components/shared/quick-input-bar';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { RowSkeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown';
import { TaskRow } from './TaskRow';
import { TaskDrawer } from './TaskDrawer';
import { TaskFormDialog, emptyTaskDraft } from './TaskFormDialog';
import { BatchBar } from './BatchBar';
import { CalendarView } from './CalendarView';
import { useTaskActions } from './useTaskActions';
import { useData } from '@/state/DataContext';
import { usePrefs } from '@/lib/prefs';
import { createTask } from '@/data/repo';
import { currentMonth, shiftMonth } from '@/domain/calendar';
import { isOverdue, isOpenTask } from '@/domain/progress';
import { diffDays, localToday } from '@/domain/date';
import { PRIORITIES, priorityLabels, type Task, type TaskStatus } from '@/domain/types';
import { cn } from '@/lib/cx';

/** 「更多」菜单里的勾选项：前置对勾按选中态显隐。 */
const moreItemCls =
  'group flex cursor-pointer select-none items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-45';
const moreCheckCls = 'size-4 shrink-0 opacity-0 transition-opacity group-data-[state=checked]:opacity-100';

const FILTERS = [
  { value: 'today', label: '今日', icon: CircleDashed },
  { value: 'week', label: '未来七天', icon: CalendarRange },
  { value: 'overdue', label: '逾期', icon: CalendarClock },
  { value: 'all', label: '全部', icon: List },
] as const;

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: '待办' },
  { status: 'doing', label: '进行中' },
  { status: 'done', label: '已完成' },
];

const SORTS = [
  { value: 'smart', label: '智能排序' },
  { value: 'due', label: '按截止日' },
  { value: 'updated', label: '按更新时间' },
] as const;

type SortValue = (typeof SORTS)[number]['value'];

export function TasksPage() {
  const { data, status, mutate } = useData();
  const prefs = usePrefs();
  const actions = useTaskActions();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createDue, setCreateDue] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);

  const today = localToday();
  const view = (params.get('view') ?? prefs.taskView) as 'list' | 'board' | 'calendar';
  const month = params.get('month') ?? currentMonth(today);
  const filter = (params.get('filter') ?? 'today') as (typeof FILTERS)[number]['value'];
  const projectId = params.get('project') ?? '';
  const priority = params.get('priority') ?? '';
  const query = params.get('q') ?? '';
  const showCancelled = params.get('cancelled') === '1';
  const sort = (params.get('sort') ?? 'smart') as SortValue;
  const group = params.get('group') === '1';
  const focusId = params.get('focus');
  const newParam = params.get('new');

  // 从搜索面板、快捷键或别的页面带着 ?new=1 过来：只开一次表单，立刻把参数摘掉
  useEffect(() => {
    if (newParam !== '1') return;
    setCreateDue(null);
    setCreateOpen(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [newParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // 多选模式下 Esc 退出，顺手清空已选
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const doneLast = (a: Task, b: Task) => Number(a.status === 'done') - Number(b.status === 'done');
    const byPriority = (a: Task, b: Task) => rank[a.priority] - rank[b.priority];
    const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title, 'zh-CN');
    const byDue = (a: Task, b: Task) => {
      if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
      if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      return 0;
    };
    const base = data.tasks
      .filter((t) => t.deletedAt === null)
      .filter((t) => {
        if (t.status === 'cancelled') return showCancelled;
        if (filter === 'today') return isOpenTask(t) && (t.dueDate === today || isOverdue(t, today));
        if (filter === 'week')
          return isOpenTask(t) && t.dueDate !== null && !isOverdue(t, today) && diffDays(today, t.dueDate) <= 7;
        if (filter === 'overdue') return isOverdue(t, today);
        return true;
      })
      .filter((t) => (projectId ? (projectId === '__none' ? t.projectId === null : t.projectId === projectId) : true))
      .filter((t) => (priority ? t.priority === priority : true))
      .filter((t) => (q ? [t.title, t.description].join(' ').toLowerCase().includes(q) : true));

    if (sort === 'due') return base.sort((a, b) => doneLast(a, b) || byDue(a, b) || byPriority(a, b) || byTitle(a, b));
    if (sort === 'updated') return base.sort((a, b) => doneLast(a, b) || b.updatedAt - a.updatedAt);
    return base.sort((a, b) => doneLast(a, b) || byPriority(a, b) || byDue(a, b) || byTitle(a, b));
  }, [data.tasks, filter, projectId, priority, query, showCancelled, today, sort]);

  const groups = useMemo(() => {
    if (!group || view !== 'list') return null;
    const map = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.projectId ?? '';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      const nameA = data.projects.find((p) => p.id === a)?.name ?? '';
      const nameB = data.projects.find((p) => p.id === b)?.name ?? '';
      return nameA.localeCompare(nameB, 'zh-CN');
    });
  }, [filtered, group, view, data.projects]);

  const focused = focusId ? (data.tasks.find((t) => t.id === focusId && t.deletedAt === null) ?? null) : null;

  const counts = useMemo(() => {
    const live = data.tasks.filter((t) => t.deletedAt === null);
    return {
      today: live.filter((t) => isOpenTask(t) && (t.dueDate === today || isOverdue(t, today))).length,
      week: live.filter((t) => isOpenTask(t) && t.dueDate && !isOverdue(t, today) && diffDays(today, t.dueDate) <= 7)
        .length,
      overdue: live.filter((t) => isOverdue(t, today)).length,
      all: live.filter((t) => t.status !== 'cancelled' || showCancelled).length,
    };
  }, [data.tasks, today, showCancelled]);

  const [dragColumn, setDragColumn] = useState<TaskStatus | null>(null);

  const drop = async (task: Task, statusValue: TaskStatus) => {
    if (task.status === statusValue) return;
    await actions.setStatus(task, statusValue);
  };

  const selectable = view === 'list' && selectMode && status === 'ready';
  const selectedTasks = useMemo(
    () => data.tasks.filter((t) => selectedIds.has(t.id) && t.deletedAt === null),
    [data.tasks, selectedIds],
  );

  const toggleSelect = (task: Task, shiftKey: boolean) => {
    const ids = filtered.map((t) => t.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorRef.current !== null) {
        const a = ids.indexOf(anchorRef.current);
        const b = ids.indexOf(task.id);
        if (a !== -1 && b !== -1) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
          return next;
        }
      }
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    anchorRef.current = task.id;
  };

  const rowProps = (t: Task) =>
    selectable ? { selection: { checked: selectedIds.has(t.id), onToggle: toggleSelect } } : {};

  const listRows = (rows: Task[]) =>
    rows.map((t) => <TaskRow key={t.id} task={t} onOpen={(task) => patch('focus', task.id)} {...rowProps(t)} />);

  return (
    <div className="tasks-page flex flex-col gap-5">
      <PageHeader
        title="我的任务"
        count={filtered.length || null}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCreateDue(null);
              setCreateOpen(true);
            }}
          >
            <Plus size={15} aria-hidden />
            新建任务
          </Button>
        }
      />

      <div className="tasks-workspace">
        <nav className="task-period-nav" aria-label="筛选">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => patch('filter', f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                'inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-aux transition-colors duration-150 sm:flex-none sm:px-2.5 lg:h-7',
                filter === f.value ? 'text-ink' : 'text-ink-2 hover:bg-surface-subtle',
              )}
            >
              <f.icon size={13} aria-hidden className="hidden sm:block" />
              {f.label}
              <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </nav>
        <div className="task-desk">
          <div className="task-scope-heading">
            <h3>{FILTERS.find((f) => f.value === filter)?.label || '全部任务'}</h3>
            <span>{today}</span>
          </div>
          <div className="page-toolbar">
            <QuickInputBar
              className="min-w-[200px] flex-1 sm:max-w-[380px]"
              projects={data.projects.filter((p) => p.deletedAt === null)}
              onCreate={async (parsed) =>
                mutate(
                  () =>
                    createTask({
                      title: parsed.title,
                      priority: parsed.priority as 'urgent' | 'high' | 'medium' | 'low',
                      // 「今日」筛选下捕获的任务默认今天到期：创建后立刻能在当前视图看到，不会像丢了一样
                      dueDate: parsed.dueDate ?? (filter === 'today' ? today : null),
                      projectId: parsed.projectId,
                    }),
                  { success: '已添加' },
                )
              }
            />

            <div className="seg ml-auto flex-wrap" role="group" aria-label="视图">
              {(
                [
                  ['list', List, '列表'],
                  ['board', KanbanSquare, '看板'],
                  ['calendar', CalendarDays, '日历'],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch('view', value)}
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

          <div className="page-toolbar">
            <div className="relative min-w-[150px] flex-1 sm:max-w-[240px]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => patch('q', e.target.value)}
                placeholder="搜索标题或描述"
                aria-label="搜索任务"
                className="pl-9"
              />
            </div>

            <Select
              value={projectId}
              onChange={(e) => patch('project', e.target.value || null)}
              aria-label="按项目筛选"
              className="w-[150px]"
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

            <Select
              value={priority}
              onChange={(e) => patch('priority', e.target.value || null)}
              aria-label="按优先级筛选"
              className="w-[124px]"
            >
              <option value="">全部优先级</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabels[p]}
                </option>
              ))}
            </Select>

            <Select
              value={sort}
              onChange={(e) => patch('sort', e.target.value === 'smart' ? null : e.target.value)}
              aria-label="排序方式"
              className="w-[112px]"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={selectMode || showCancelled || group ? 'primary' : 'secondary'}
                  size="sm"
                  aria-label="更多显示选项"
                >
                  <SlidersHorizontal size={14} aria-hidden />
                  更多
                  {(selectMode || showCancelled || group) && (
                    <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownContent>
                <DropdownMenuCheckboxItem
                  checked={showCancelled}
                  onCheckedChange={(v) => patch('cancelled', v ? '1' : null)}
                  className={moreItemCls}
                >
                  <Check size={14} className={moreCheckCls} aria-hidden />
                  含已取消
                </DropdownMenuCheckboxItem>
                {view === 'list' && (
                  <>
                    <DropdownMenuCheckboxItem
                      checked={selectMode}
                      onCheckedChange={(v) => {
                        setSelectMode(v);
                        if (!v) {
                          setSelectedIds(new Set());
                          anchorRef.current = null;
                        }
                      }}
                      className={moreItemCls}
                    >
                      <Check size={14} className={moreCheckCls} aria-hidden />
                      多选模式
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={group}
                      onCheckedChange={(v) => patch('group', v ? '1' : null)}
                      className={moreItemCls}
                    >
                      <Check size={14} className={moreCheckCls} aria-hidden />
                      按项目分组
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownContent>
            </DropdownMenu>
          </div>

          {selectable && selectedTasks.length > 0 && (
            <BatchBar
              selected={selectedTasks}
              projects={data.projects.filter((p) => p.deletedAt === null)}
              count={selectedTasks.length}
              allCount={filtered.length}
              onSelectAll={() => setSelectedIds(new Set(filtered.map((t) => t.id)))}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          {status === 'loading' ? (
            <RowSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<CircleDashed size={20} />}
              title={filter === 'today' ? '今天没有排到的任务' : '这个筛选下没有任务'}
              action={
                <>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setCreateDue(null);
                      setCreateOpen(true);
                    }}
                  >
                    <Plus size={15} aria-hidden />
                    新建任务
                  </Button>
                  {(query || projectId || priority) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        ['q', 'project', 'priority'].forEach((k) => next.delete(k));
                        setParams(next, { replace: true });
                      }}
                    >
                      清除条件
                    </Button>
                  )}
                </>
              }
            />
          ) : groups ? (
            <div className="flex flex-col gap-3">
              {groups.map(([groupId, rows]) => {
                const project = data.projects.find((p) => p.id === groupId);
                return (
                  <section
                    key={groupId || 'none'}
                    className="panel overflow-hidden"
                    aria-label={`${project?.name ?? '未关联项目'}，${rows.length} 条`}
                  >
                    <header className="panel-head">
                      <h3 className="flex items-center gap-1.5 text-body font-semibold">
                        <FolderKanban size={14} className="section-icon" aria-hidden />
                        <span className="min-w-0 truncate" title={project?.name}>
                          {project?.name ?? '未关联项目'}
                        </span>
                        <span className="page-count tabular-nums">{rows.length}</span>
                      </h3>
                    </header>
                    {listRows(rows)}
                  </section>
                );
              })}
            </div>
          ) : view === 'list' ? (
            <div className="panel overflow-hidden">{listRows(filtered)}</div>
          ) : view === 'calendar' ? (
            <CalendarView
              month={month}
              tasks={filtered}
              onShiftMonth={(delta) => patch('month', delta === 0 ? null : shiftMonth(month, delta))}
              onOpenTask={(task) => patch('focus', task.id)}
              onCreateFor={(date) => {
                setCreateDue(date);
                setCreateOpen(true);
              }}
            />
          ) : (
            <div className="grid min-w-0 gap-3 md:grid-cols-3">
              {COLUMNS.map((column) => {
                const rows = filtered.filter((t) => t.status === column.status);
                return (
                  <section
                    key={column.status}
                    aria-label={`${column.label}列，${rows.length} 条`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragColumn(column.status);
                    }}
                    onDragLeave={() => setDragColumn((current) => (current === column.status ? null : current))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain');
                      const task = data.tasks.find((t) => t.id === id);
                      if (task) void drop(task, column.status);
                      setDragColumn(null);
                    }}
                    className={cn(
                      'flex min-w-0 flex-col rounded-panel border bg-surface transition-colors duration-150',
                      dragColumn === column.status ? 'border-brand bg-brand-soft/40' : 'border-line',
                    )}
                  >
                    <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
                      <h3 className="text-body font-semibold">{column.label}</h3>
                      <span className="text-aux tabular-nums text-ink-2">{rows.length}</span>
                    </header>
                    <div className="scrollbar-thin flex max-h-[62vh] min-h-[92px] flex-col overflow-y-auto">
                      {rows.length === 0 ? (
                        <p className="px-3 py-6 text-center text-aux text-ink-2">拖卡片到这里</p>
                      ) : (
                        rows.map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            layout="card"
                            draggable
                            onOpen={(task) => patch('focus', task.id)}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
              {showCancelled && (
                <section
                  aria-label="已取消列"
                  className="flex min-w-0 flex-col rounded-panel border border-line bg-surface md:col-span-3"
                >
                  <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
                    <h3 className="text-body font-semibold">已取消</h3>
                    <span className="text-aux tabular-nums text-ink-2">
                      {filtered.filter((t) => t.status === 'cancelled').length}
                    </span>
                  </header>
                  {filtered
                    .filter((t) => t.status === 'cancelled')
                    .map((t) => (
                      <TaskRow key={t.id} task={t} layout="card" onOpen={(task) => patch('focus', task.id)} />
                    ))}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <TaskFormDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) setCreateDue(null);
        }}
        draft={emptyTaskDraft({
          projectId: projectId && projectId !== '__none' ? projectId : null,
          dueDate: createDue ?? (filter === 'today' ? today : null),
        })}
      />
      <TaskDrawer task={focused} open={focused !== null} onOpenChange={(v) => !v && patch('focus', null)} />
    </div>
  );
}
