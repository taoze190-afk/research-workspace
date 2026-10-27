import type { ReactNode } from 'react';
import { cn } from '@/lib/cx';

/**
 * Bento 栅格容器：移动端单列，900px 起按 cols 铺开。
 * 子元素想要跨列就自己加 col-span-*。
 */
export function BentoContainer({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const colsCls =
    cols === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : cols === 3
        ? 'grid-cols-1 lg:grid-cols-3'
        : 'grid-cols-2 xl:grid-cols-4';
  return <div className={cn('grid gap-3 lg:gap-4', colsCls, className)}>{children}</div>;
}
