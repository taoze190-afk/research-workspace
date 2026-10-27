import { cn } from '@/lib/cx';

/** 品牌标记：直角阶梯向上推进，末端落在一个方块上。纯几何，不含字形。 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = `rw-brand-${size}`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn('block shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4A7CB0" />
          <stop offset="1" stopColor="#2C4E76" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path d="M7 24h6v-6h6v-6h6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="24" r="2.7" fill="#fff" />
      <rect x="22.1" y="9.1" width="5.8" height="5.8" rx="1.8" fill="#fff" />
    </svg>
  );
}
