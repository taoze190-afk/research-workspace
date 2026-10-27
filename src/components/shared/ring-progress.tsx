import { cn } from '@/lib/cx';

/** 环形进度微图表：无进度的数据不画环，只画底色。 */
export function RingProgress({ ratio, size = 34, tone = 'var(--brand)', className }: { ratio: number | null; size?: number; tone?: string; className?: string }) {
  const clamped = ratio === null ? null : Math.min(1, Math.max(0, ratio));
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-subtle)" strokeWidth={stroke} />
      {clamped !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * clamped} ${c}`}
          className="transition-[stroke-dasharray] duration-300"
        />
      )}
    </svg>
  );
}
