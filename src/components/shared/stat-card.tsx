import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CornerDownRight } from 'lucide-react';
import { RingProgress } from './ring-progress';
import { cn } from '@/lib/cx';

export interface StatExpandItem {
  label: string;
  meta?: string;
  href?: string;
}

/**
 * Bento 胶囊统计卡：主区域点击跳转到过滤后的页面；
 * 右侧箭头就地展开前几条明细（不过页）。「展开」不传时整块是普通卡片。
 */
export function StatCard({
  label,
  value,
  icon,
  tone = 'var(--brand)',
  ring,
  href,
  expand,
  expandEmpty = '没有符合条件的记录',
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: string;
  /** 环形微图表的占比；null 只画底环 */
  ring?: number | null;
  /** 主区域的跳转地址（过滤后的列表页） */
  href?: string;
  expand?: { items: StatExpandItem[]; moreLabel: string; moreHref: string };
  expandEmpty?: string;
}) {
  const [open, setOpen] = useState(false);
  const danger = tone === 'var(--danger)';
  const lifting = !!(href || expand);
  const body = (
    <>
      <span
        className="hidden size-9 shrink-0 place-items-center rounded-[10px] sm:grid"
        style={{ background: `color-mix(in srgb, ${tone} 9%, var(--surface))`, color: tone }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'stat-label block text-[12px] font-medium',
            danger && value !== 0 ? 'text-danger' : 'text-ink-2',
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'stat-value mt-1 block font-semibold leading-tight tabular-nums',
            danger && value !== 0 && 'text-danger',
          )}
        >
          {value}
        </span>
      </span>
      {ring !== undefined ? (
        <span className="hidden shrink-0 min-[440px]:inline-flex">
          <RingProgress ratio={ring} tone={tone} />
        </span>
      ) : null}
    </>
  );
  const mainCls =
    'flex min-w-0 flex-1 items-center gap-3 rounded-[inherit] text-left transition-opacity duration-150 hover:opacity-90';

  return (
    <div
      className={cn(
        'stat-card group flex min-w-0 flex-col rounded-panel border border-line bg-surface shadow-[var(--shadow-card)] transition-all duration-200',
        lifting && 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]',
      )}
    >
      <div className="stat-card-main flex flex-1 items-center gap-1.5">
        {href ? (
          <Link to={href} className={mainCls}>
            {body}
          </Link>
        ) : (
          <span className={mainCls}>{body}</span>
        )}
        {expand && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${label}明细`}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-control p-1.5 text-ink-2 transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
          >
            <ChevronDown
              size={15}
              aria-hidden
              className={cn('transition-transform duration-200', open && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {expand && open && (
        <div className="border-t border-line px-3 pb-3 pt-2">
          {expand.items.length === 0 ? (
            <p className="px-1 py-1.5 text-aux text-ink-2">{expandEmpty}</p>
          ) : (
            <ul className="flex flex-col">
              {expand.items.slice(0, 4).map((item) => {
                const inner = (
                  <>
                    <CornerDownRight size={12} aria-hidden className="mt-0.5 shrink-0 text-ink-2" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.meta && <span className="shrink-0 text-aux tabular-nums text-ink-2">{item.meta}</span>}
                  </>
                );
                return (
                  <li key={item.label}>
                    {item.href ? (
                      <Link
                        to={item.href}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-1.5 rounded-control px-1 py-1.5 text-aux text-ink transition-colors duration-150 hover:bg-surface-subtle hover:text-brand-ink"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-1.5 px-1 py-1.5 text-aux text-ink">{inner}</div>
                    )}
                  </li>
                );
              })}
              <li>
                <Link
                  to={expand.moreHref}
                  className="mt-0.5 inline-flex items-center gap-1 rounded-control px-1 py-1 text-aux font-medium text-brand-ink hover:underline"
                >
                  {expand.moreLabel}
                </Link>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
