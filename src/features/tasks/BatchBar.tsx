import { Ban, CalendarDays, Check, Circle, CircleDot, FolderKanban, Pause, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuItem, DropdownContent, MenuRow } from '@/components/ui/dropdown';
import { PriorityBadge } from '@/components/shared/status-badges';
import { deleteTask, setTaskStatus, updateTask, spawnNextTask } from '@/data/repo';
import { useData } from '@/state/DataContext';
import { PRIORITIES, TASK_STATUSES, priorityLabels, taskStatusLabels, type Priority, type Project, type Task, type TaskStatus } from '@/domain/types';
import { addDays, localToday } from '@/domain/date';

/**
 * 多选后的批量操作条：所有改动包在一次 mutate 里（一次刷新、一条提示），
 * 逐条调用单条任务的写入入口，保证与看板/列表走的是同一套数据语义。
 */
export function BatchBar({
  selected,
  projects,
  count,
  allCount,
  onSelectAll,
  onClear,
}: {
  selected: Task[];
  projects: Project[];
  count: number;
  /** 当前筛选下的全部条数：全选按钮只在还有没选上的时才有意义 */
  allCount: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { mutate } = useData();
  const today = localToday();

  const run = async (fn: (task: Task) => Promise<unknown>, success: string) => {
    const ok = await mutate(async () => {
      for (const task of selected) await fn(task);
    }, { success });
    if (ok) onClear();
  };

  // 批量完成也要给重复任务排下一期，和单条完成的语义保持一致
  const setStatus = (status: TaskStatus) => {
    if (status === 'done') {
      const recurring = selected.filter((t) => t.recurrence !== 'none');
      return void run(async (t) => {
        await setTaskStatus(t.id, 'done');
        await spawnNextTask(t);
      }, `已更新 ${count} 项${recurring.length ? `，已排 ${recurring.length} 期` : ''}`);
    }
    return void run((t) => setTaskStatus(t.id, status), `已更新 ${count} 项`);
  };
  const setPriority = (priority: Priority) => void run((t) => updateTask(t.id, { priority }), `已更新 ${count} 项`);
  const setDueDate = (dueDate: string | null) => void run((t) => updateTask(t.id, { dueDate }), `已更新 ${count} 项`);
  const setProject = (projectId: string | null) => void run((t) => updateTask(t.id, { projectId }), `已更新 ${count} 项`);
  const remove = () => void run((t) => deleteTask(t.id), `已移到回收站 ${count} 项`);

  const subTrigger = 'flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle data-[state=open]:bg-surface-subtle';
  const subItem = 'flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none focus:bg-surface-subtle';
  const panel = 'z-[60] min-w-[150px] rounded-panel border border-line bg-surface p-1 shadow-[var(--shadow-pop)]';

  return (
    <div className="panel flex flex-wrap items-center gap-2 px-3 py-2" role="toolbar" aria-label="批量操作">
      <span aria-live="polite" className="text-aux tabular-nums text-ink-2">
        已选 {count} 项
      </span>
      <Button variant="ghost" size="sm" onClick={onSelectAll} disabled={selected.length >= allCount}>
        全选
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={count === 0}>
        清除
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              批量操作
            </Button>
          </DropdownMenuTrigger>
          <DropdownContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTrigger}>
                <Check size={14} aria-hidden />
                状态
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={panel}>
                {TASK_STATUSES.map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => setStatus(s)} className={subItem}>
                    {s === 'done' ? <Check size={13} aria-hidden /> : s === 'cancelled' ? <Ban size={13} aria-hidden /> : s === 'doing' ? <CircleDot size={13} aria-hidden /> : <Circle size={13} aria-hidden />}
                    {taskStatusLabels[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTrigger}>
                <Pause size={14} aria-hidden />
                优先级
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={panel}>
                {PRIORITIES.map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => setPriority(p)} className={subItem}>
                    <PriorityBadge priority={p} compact />
                    {priorityLabels[p]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTrigger}>
                <CalendarDays size={14} aria-hidden />
                日期
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={panel}>
                {(
                  [
                    ['今天', today],
                    ['明天', addDays(today, 1)],
                    ['一周后', addDays(today, 7)],
                    ['清除日期', null],
                  ] as const
                ).map(([label, date]) => (
                  <DropdownMenuItem key={label} onSelect={() => setDueDate(date)} className={subItem}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTrigger}>
                <FolderKanban size={14} aria-hidden />
                移动项目
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={panel}>
                <DropdownMenuItem onSelect={() => setProject(null)} className={subItem}>
                  不关联项目
                </DropdownMenuItem>
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setProject(p.id)} className={subItem}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <MenuRow icon={<Trash2 size={14} />} danger onSelect={remove}>
              移到回收站
            </MenuRow>
          </DropdownContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
