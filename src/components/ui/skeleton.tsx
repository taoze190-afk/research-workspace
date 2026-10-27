import { cn } from '@/lib/cx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-surface-subtle', className)} aria-hidden />;
}

export function RowSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-panel border border-line bg-surface px-3.5 py-3">
          <Skeleton className="size-4 rounded-[5px]" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}
