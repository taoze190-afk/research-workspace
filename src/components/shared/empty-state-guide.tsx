import type { ReactNode } from 'react';
import { cn } from '@/lib/cx';

/** 几何插画：与 BrandMark 同语言的阶梯 + 圆点，浅深两主题都用 token 取色。 */
function GuideArt() {
  return (
    <svg width="88" height="56" viewBox="0 0 88 56" fill="none" aria-hidden className="opacity-90">
      <rect x="4" y="36" width="18" height="16" rx="4" className="fill-brand-soft" />
      <rect x="26" y="24" width="18" height="28" rx="4" className="fill-brand-soft" />
      <rect x="48" y="12" width="18" height="40" rx="4" className="fill-brand/20" />
      <rect x="70" y="0" width="18" height="52" rx="4" className="fill-brand/35" />
      <circle cx="13" cy="14" r="5" className="fill-warning/70" />
      <circle cx="35" cy="8" r="3.5" className="fill-success/70" />
      <path d="M8 44h10M30 34h10" className="stroke-brand-ink/50" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 带插画的引导空态：不只说「没有」，还给出下一步（常见动作是载入一份示例模板）。
 */
export function EmptyStateGuide({
  title,
  detail,
  actions,
  className,
  compact,
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong bg-surface-subtle/40 text-center',
        compact ? 'px-4 py-5' : 'px-6 py-8',
        className
      )}
    >
      <GuideArt />
      <p className={cn('font-medium text-ink', compact ? 'text-aux' : 'text-body')}>{title}</p>
      {detail && <p className="max-w-[320px] text-aux text-ink-2">{detail}</p>}
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
