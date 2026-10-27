import type { ReactNode } from 'react';
import { cn } from '@/lib/cx';

/** 所有业务页共用标题、简短说明与主要动作的层次。 */
export function PageHeader({
  title,
  count,
  actions,
  className,
  description,
}: {
  title: ReactNode;
  count?: number | null;
  actions?: ReactNode;
  className?: string;
  description?: string;
}) {
  return (
    <div className={cn('page-head', className)}>
      <div className="page-heading-copy">
        <h2 className="page-title">
          <span className="min-w-0 truncate">{title}</span>
          {count != null && <span className="page-count tabular-nums">{count}</span>}
        </h2>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('page-toolbar', className)}>{children}</div>;
}
