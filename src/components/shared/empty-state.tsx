import { cn } from '@/lib/cx';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  action,
  icon,
  className,
  compact,
}: {
  title: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-line-strong bg-surface text-center',
        compact ? 'px-4 py-7' : 'px-6 py-14',
        className,
      )}
    >
      {icon && (
        <span
          className="mb-1 grid size-12 place-items-center rounded-2xl border border-line bg-brand-soft/50 text-brand"
          aria-hidden
        >
          {icon}
        </span>
      )}
      <p className={cn('font-medium text-ink', compact ? 'text-aux' : 'text-body')}>{title}</p>
      {action && <div className="mt-0.5 flex items-center gap-2">{action}</div>}
    </div>
  );
}
