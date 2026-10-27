import {
  CalendarDays,
  Circle,
  CircleDot,
  MoreHorizontal,
  Trash2,
  Copy,
  Check,
  Ban,
  Pause,
  AlignLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownContent,
  MenuRow,
} from '@/components/ui/dropdown';
import { PriorityBadge } from '@/components/shared/status-badges';
import { cn } from '@/lib/cx';
import { diffDays, formatShortDate, localToday, relativeDayLabel, addDays } from '@/domain/date';
import { isOverdue } from '@/domain/progress';
import { PRIORITIES, TASK_STATUSES, priorityLabels, taskStatusLabels, type Task } from '@/domain/types';
import { useTaskActions } from './useTaskActions';
import { useData } from '@/state/DataContext';

function DueChip({ task, today }: { task: Task; today: string }) {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task, today);
  const delta = diffDays(today, task.dueDate);
  const isToday = task.dueDate === today;
  const text = isToday ? '今天' : overdue ? `${-delta} 天前` : relativeDayLabel(task.dueDate, today);
  return (
    <span
      className={cn(
        'task-due-chip inline-flex h-6 w-[92px] shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-aux tabular-nums max-sm:w-[76px]',
        overdue
          ? 'border-danger-soft bg-danger-soft text-danger'
          : isToday
            ? 'border-brand-soft bg-brand-soft text-brand-ink'
            : 'border-line text-ink-2',
      )}
      title={formatShortDate(task.dueDate)}
      aria-label={`截止 ${formatShortDate(task.dueDate)}，${text}`}
    >
      {overdue ? <Ban size={11} aria-hidden /> : <CalendarDays size={11} aria-hidden />}
      <span className="hidden truncate sm:inline">{text}</span>
      <span className="truncate sm:hidden">{isToday ? '今天' : formatShortDate(task.dueDate)}</span>
    </span>
  );
}

function TaskMenu({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const actions = useTaskActions();
  const today = localToday();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`「${task.title}」的操作`}
          className="opacity-60 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownContent>
        <MenuRow icon={<CircleDot size={14} />} onSelect={() => onOpen(task)}>
          打开详情
        </MenuRow>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle data-[state=open]:bg-surface-subtle">
            <Check size={14} aria-hidden />
            状态
            <span className="ml-auto text-aux text-ink-2">{taskStatusLabels[task.status]}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-[60] min-w-[150px] rounded-panel border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {TASK_STATUSES.map((s) => (
              <DropdownMenuItem
                key={s}
                onSelect={() => void actions.setStatus(task, s)}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle"
              >
                {s === 'done' ? (
                  <Check size={13} aria-hidden />
                ) : s === 'cancelled' ? (
                  <Ban size={13} aria-hidden />
                ) : s === 'doing' ? (
                  <CircleDot size={13} aria-hidden />
                ) : (
                  <Circle size={13} aria-hidden />
                )}
                {taskStatusLabels[s]}
                {task.status === s && <span className="ml-auto text-aux text-ink-2">当前</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle data-[state=open]:bg-surface-subtle">
            <Pause size={14} aria-hidden />
            优先级
            <span className="ml-auto text-aux text-ink-2">{priorityLabels[task.priority]}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-[60] min-w-[140px] rounded-panel border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {PRIORITIES.map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() => void actions.setPriority(task, p)}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle"
              >
                <PriorityBadge priority={p} compact />
                {priorityLabels[p]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle data-[state=open]:bg-surface-subtle">
            <CalendarDays size={14} aria-hidden />
            日期
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-[60] min-w-[150px] rounded-panel border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {(
              [
                ['今天', today],
                ['明天', addDays(today, 1)],
                ['一周后', addDays(today, 7)],
                ['清除日期', null],
              ] as const
            ).map(([label, date]) => (
              <DropdownMenuItem
                key={label}
                onSelect={() => void actions.setDueDate(task, date)}
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle"
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <MenuRow icon={<Copy size={14} />} onSelect={() => void actions.duplicate(task)}>
          复制为新任务
        </MenuRow>
        <MenuRow icon={<Trash2 size={14} />} danger onSelect={() => void actions.remove(task)}>
          移到回收站
        </MenuRow>
      </DropdownContent>
    </DropdownMenu>
  );
}

export function TaskRow({
  task,
  onOpen,
  showProject = true,
  layout = 'row',
  draggable = false,
  selection,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  showProject?: boolean;
  layout?: 'row' | 'card';
  draggable?: boolean;
  /** 传入即进入多选模式：行首复选框变成选择框，不再承担「标记完成」。 */
  selection?: { checked: boolean; onToggle: (task: Task, shiftKey: boolean) => void };
}) {
  const { data } = useData();
  const actions = useTaskActions();
  const today = localToday();
  const done = task.status === 'done';
  const cancelled = task.status === 'cancelled';
  const project = showProject ? data.projects.find((p) => p.id === task.projectId) : undefined;
  const projectMissing = showProject && !project && task.projectId !== null;

  const dragProps = draggable
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
        },
      }
    : {};

  const check = (
    <Checkbox
      checked={done}
      onCheckedChange={(v) => void actions.setStatus(task, v ? 'done' : 'todo')}
      label={done ? `把「${task.title}」标为未完成` : `完成「${task.title}」`}
      className="tap-expand shrink-0"
    />
  );

  // shift + 点击选区间：默认行为被拦下后 Radix 不会触发状态回调
  const selectCheck = selection ? (
    <Checkbox
      checked={selection.checked}
      onClick={(e) => {
        if (e.shiftKey) {
          e.preventDefault();
          selection.onToggle(task, true);
        }
      }}
      onCheckedChange={() => selection.onToggle(task, false)}
      label={`${selection.checked ? '取消选择' : '选择'}「${task.title}」`}
      className="tap-expand shrink-0"
    />
  ) : null;
  const lead = selection ? selectCheck : check;

  const title = (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        'task-row-title flex min-w-0 flex-1 self-stretch items-center rounded text-left text-body font-medium transition-colors duration-150 hover:text-brand-ink',
        (done || cancelled) && 'text-ink-2 line-through decoration-line-strong',
      )}
      title={task.title}
    >
      {/* flex 容器上的 text-overflow 不生效，必须让文字待在自己的 span 里才会省略号 */}
      <span className="truncate">{task.title}</span>
    </button>
  );

  // 看板卡片：标题独占最多两行，不被右侧控件挤掉
  if (layout === 'card') {
    return (
      <article
        className={cn(
          'group m-2 rounded-panel border border-line bg-surface px-2.5 py-2 transition-colors duration-150 hover:bg-surface-subtle',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
        {...dragProps}
      >
        <div className="flex items-start gap-2">
          {lead}
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-body font-medium leading-snug hover:text-brand-ink"
            title={task.title}
            onClick={() => onOpen(task)}
          >
            <span
              className={cn('line-clamp-2', (done || cancelled) && 'text-ink-2 line-through decoration-line-strong')}
            >
              {task.title}
            </span>
          </button>
          <TaskMenu task={task} onOpen={onOpen} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
          {project && (
            <Link
              to={`/projects/${project.id}`}
              className="max-w-[160px] truncate rounded-full border border-line px-2 py-0.5 text-aux text-ink-2 hover:border-brand hover:text-brand-ink"
              title={project.name}
            >
              {project.name}
            </Link>
          )}
          {projectMissing && <span className="text-aux text-warning">所属项目已在回收站</span>}
          <DueChip task={task} today={today} />
          <PriorityBadge priority={task.priority} />
          {task.description && <AlignLeft size={13} className="text-ink-2" aria-label="这条任务有说明" />}
        </div>
      </article>
    );
  }

  // 宽屏对齐元数据列，窄屏让标题与日期分行。
  return (
    <div
      className={cn(
        'task-row group flex h-12 items-center gap-2 border-b border-line px-3 transition-colors duration-150 last:border-b-0 hover:bg-surface-subtle',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      {...dragProps}
    >
      {lead}
      <div className="task-row-copy flex min-w-0 flex-1 self-stretch items-center gap-2">
        {title}
        {project && (
          <Link
            to={`/projects/${project.id}`}
            className="hidden max-w-[22%] shrink-0 items-center truncate text-aux text-ink-2 hover:text-brand-ink md:flex md:min-h-[44px]"
            title={project.name}
          >
            {project.name}
          </Link>
        )}
        {projectMissing && <span className="hidden shrink-0 text-aux text-warning md:inline">项目已删除</span>}
      </div>
      <DueChip task={task} today={today} />
      <span className="hidden w-[52px] shrink-0 xl:block">
        <PriorityBadge priority={task.priority} />
      </span>
      <span className="hidden w-[20px] shrink-0 sm:block xl:hidden">
        <PriorityBadge priority={task.priority} compact />
      </span>
      <TaskMenu task={task} onOpen={onOpen} />
    </div>
  );
}
