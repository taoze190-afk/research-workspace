import { useMemo } from 'react';
import { activityPerDay } from '@/domain/progress';
import { formatShortDate } from '@/domain/date';
import type { Experiment, Task } from '@/domain/types';
import { cn } from '@/lib/cx';

/**
 * 52 周科研贡献热力图（GitHub Activity Graph 风格）：
 * 每天一格，颜色按「完成任务 + 更新实验」的总量分五档，悬浮给出真实拆分。
 * 列 = 周（周一起），行 = 周一到周日，整块窄屏横向滚动。
 */
export function Heatmap({
  tasks,
  experiments,
  weeks = 52,
  today,
}: {
  tasks: Task[];
  experiments: Experiment[];
  weeks?: number;
  today: string;
}) {
  const days = useMemo(() => activityPerDay(tasks, experiments, weeks, today), [tasks, experiments, weeks, today]);

  const columns = useMemo(() => {
    const cols: (typeof days)[] = [];
    for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));
    return cols;
  }, [days]);

  const total = days.reduce((sum, d) => sum + d.tasks + d.experiments, 0);
  const levelOf = (v: number) => (v === 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : 4);
  const OPACITY = [0, 0.3, 0.5, 0.75, 1];

  // 月份标签：每月第一次出现的列上标月份
  const monthMarks = useMemo(() => {
    const marks: { col: number; label: string }[] = [];
    columns.forEach((col, i) => {
      const first = col[0];
      if (!first) return;
      const day = Number(first.date.slice(8));
      if (day <= 7 && marks.every((m) => m.label !== first.date.slice(5, 7))) {
        marks.push({ col: i, label: `${Number(first.date.slice(5, 7))}月` });
      }
    });
    return marks;
  }, [columns]);

  if (total === 0) {
    return <p className="text-aux text-ink-2">最近一年还没有活动记录</p>;
  }

  return (
    <div className="scrollbar-thin overflow-x-auto pb-1" data-allow-x>
      <div className="inline-flex min-w-full flex-col gap-1">
        <div className="flex h-4 gap-[3px] pl-[26px] text-[10px] text-ink-2" aria-hidden>
          {columns.map((_, i) => {
            const mark = monthMarks.find((m) => m.col === i);
            return (
              <span key={i} className="relative w-[11px] shrink-0">
                {mark ? <span className="absolute left-0 top-0 whitespace-nowrap">{mark.label}</span> : ''}
              </span>
            );
          })}
        </div>
        <div className="flex gap-[3px]">
          <div
            className="flex w-[23px] shrink-0 flex-col gap-[3px] text-right text-[9px] leading-[11px] text-ink-2"
            aria-hidden
          >
            {['一', '', '三', '', '五', '', '日'].map((d, i) => (
              <span key={i} className="h-[11px]">
                {i % 2 === 0 ? d : ''}
              </span>
            ))}
          </div>
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]" role="img" aria-label={`第 ${ci + 1} 周`}>
              {col.map((d) => {
                const v = d.tasks + d.experiments;
                const level = levelOf(v);
                return (
                  <span
                    key={d.date}
                    title={`${formatShortDate(d.date)}：${d.tasks} 任务 · ${d.experiments} 实验`}
                    className={cn(
                      'size-[11px] shrink-0 rounded-[2.5px]',
                      level === 0 && 'border border-line bg-surface-subtle',
                    )}
                    style={level > 0 ? { background: 'var(--brand)', opacity: OPACITY[level] } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="flex items-center gap-1.5 pl-[26px] text-aux text-ink-2" aria-hidden>
          少
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="size-[10px] rounded-[2.5px]"
              style={
                l === 0
                  ? { background: 'var(--surface-subtle)', border: '1px solid var(--border)' }
                  : { background: 'var(--brand)', opacity: OPACITY[l] }
              }
            />
          ))}
          多 · 共 {total} 项
        </p>
      </div>
    </div>
  );
}
