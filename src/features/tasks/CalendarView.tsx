import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WEEK_HEADERS, monthGrid } from '@/domain/calendar';
import { isOverdue } from '@/domain/progress';
import { localToday } from '@/domain/date';
import type { Task } from '@/domain/types';
import { cn } from '@/lib/cx';

/**
 * 月视图：只按截止日摆任务，共用任务页同一组筛选。
 * 点空白处建当天的任务，点任务开详情。
 */
export function CalendarView({
  month,
  tasks,
  onShiftMonth,
  onOpenTask,
  onCreateFor,
}: {
  month: string;
  tasks: Task[];
  onShiftMonth: (delta: number) => void;
  onOpenTask: (task: Task) => void;
  onCreateFor: (date: string) => void;
}) {
  const today = localToday();
  const days = useMemo(() => monthGrid(month), [month]);
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      map.set(t.dueDate, [...(map.get(t.dueDate) ?? []), t]);
    }
    return map;
  }, [tasks]);

  const [y, m] = month.split('-').map(Number);

  return (
    <section className="panel overflow-hidden" aria-label={`${y}年${m}月日历`}>
      <header className="panel-head">
        <h3 className="text-body font-semibold tabular-nums">
          {y}年{m}月
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="iconSm" aria-label="上一月" onClick={() => onShiftMonth(-1)}>
            <ChevronLeft size={15} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onShiftMonth(0)}>
            今天
          </Button>
          <Button variant="ghost" size="iconSm" aria-label="下一月" onClick={() => onShiftMonth(1)}>
            <ChevronRight size={15} />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-line bg-surface-subtle/50" aria-hidden>
        {WEEK_HEADERS.map((h) => (
          <span key={h} className="px-1 py-1.5 text-center text-[13px] text-ink-2">
            {h}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const rows = byDate.get(day.date) ?? [];
          const visible = rows.slice(0, 3);
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={cn(
                'group relative min-h-[84px] border-b border-r border-line p-1 last:border-r-0 sm:min-h-[104px]',
                !day.inMonth && 'bg-surface-subtle/40',
                day.inMonth && 'hover:bg-surface-subtle/60',
              )}
            >
              <div className="mb-0.5 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-grid size-5 place-items-center rounded-full text-[13px] tabular-nums',
                    !day.inMonth ? 'text-ink-2/60' : isToday ? 'bg-brand font-medium text-brand-on' : 'text-ink-2',
                  )}
                >
                  {Number(day.date.slice(8))}
                </span>
                <button
                  type="button"
                  aria-label={`在 ${day.date} 新建任务`}
                  className="rounded p-0.5 text-ink-2 opacity-60 transition-opacity duration-150 hover:bg-surface hover:text-brand-ink focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => onCreateFor(day.date)}
                >
                  <Plus size={12} aria-hidden />
                </button>
              </div>
              <ul className="flex flex-col gap-0.5">
                {visible.map((t) => {
                  const done = t.status === 'done';
                  const cancelled = t.status === 'cancelled';
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(t)}
                        title={t.title}
                        className={cn(
                          'block min-h-6 w-full truncate rounded-[4px] px-1 py-0.5 text-left text-[13px] leading-[20px] transition-colors duration-100',
                          done || cancelled
                            ? 'text-ink-2/70 line-through hover:bg-brand-soft/50'
                            : isOverdue(t, today)
                              ? 'bg-danger-soft text-danger hover:bg-danger-soft'
                              : 'bg-surface-subtle text-ink hover:bg-brand-soft',
                        )}
                      >
                        {t.title}
                      </button>
                    </li>
                  );
                })}
                {rows.length > 3 && (
                  <li className="px-1 text-[12px] tabular-nums text-ink-2" aria-label={`还有 ${rows.length - 3} 条`}>
                    +{rows.length - 3}
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
