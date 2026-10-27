import { cn } from '@/lib/cx';

/**
 * 数据可视化只用真实计数：完成时间、记录日期、状态分布。
 * 没有外推、没有随机、没有装饰性趋势线；没有数据时直接说没有，不画空坐标轴。
 */

export function ProgressBar({
  ratio,
  label,
  className,
  tone = 'brand',
}: {
  ratio: number | null;
  label?: string;
  className?: string;
  tone?: 'brand' | 'muted';
}) {
  const pct = ratio === null ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-subtle" aria-hidden>
        {pct !== null && (
          <span
            className={cn('block h-full rounded-full transition-[width] duration-200 ease-[var(--ease-out-quart)]', tone === 'brand' ? 'bg-brand' : 'bg-line-strong')}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="shrink-0 text-aux tabular-nums text-ink-2">{pct === null ? '—' : label ? `${pct}% ${label}` : `${pct}%`}</span>
    </div>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** 状态分布条：段宽按真实占比，色块同时带文字图例，不单靠颜色表达。 */
export function StackedBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className={cn('text-aux text-ink-2', className)}>还没有可统计的记录</p>;
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-subtle" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join('，')}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.key} className="block h-full transition-[width] duration-200" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-aux text-ink-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label}
            <span className="tabular-nums text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface WeekBucket {
  label: string;
  value: number;
  from: string;
  to: string;
}

/** 按周分桶的真实完成量；柱高相对最大值，没有数据的一周就是空的。 */
export function ActivityStrip({ weeks, unit = '项' }: { weeks: WeekBucket[]; unit?: string }) {
  const max = Math.max(1, ...weeks.map((w) => w.value));
  const total = weeks.reduce((sum, w) => sum + w.value, 0);
  if (total === 0) {
    return <p className="text-aux text-ink-2">近 {weeks.length} 周还没有完成过任务</p>;
  }
  return (
    <div>
      <div className="flex items-end gap-1" role="img" aria-label={`近 ${weeks.length} 周完成 ${total} ${unit}`}>
        {weeks.map((w) => (
          <span key={w.label} className="group/bar flex min-w-0 flex-1 flex-col items-center justify-end" title={`${w.from} – ${w.to}：${w.value} ${unit}`}>
            <span className="sr-only">{`${w.from} 至 ${w.to} 完成 ${w.value} ${unit}`}</span>
            <span
              className="w-full rounded-[3px] transition-[height,background-color] duration-200 ease-[var(--ease-out-quart)]"
              style={{
                height: `${Math.max(4, Math.round((w.value / max) * 64))}px`,
                background: w.value === 0 ? 'var(--surface-subtle)' : 'var(--brand)',
                opacity: w.value === 0 ? 1 : 0.35 + 0.65 * (w.value / max),
                border: w.value === 0 ? '1px solid var(--border)' : 'none',
              }}
              aria-hidden
            />
          </span>
        ))}
      </div>
      <p className="mt-1.5 flex items-center justify-between text-aux text-ink-2">
        <span>{weeks[0]?.from.slice(5)}</span>
        <span className="tabular-nums text-ink">
          共 {total} {unit}
        </span>
        <span>本周</span>
      </p>
    </div>
  );
}
