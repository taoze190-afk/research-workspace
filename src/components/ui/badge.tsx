import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cx';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'caution' | 'danger' | 'muted';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-subtle text-ink border-line',
  brand: 'bg-brand-soft text-brand-ink border-brand-soft',
  info: 'bg-info-soft text-info border-info-soft',
  success: 'bg-success-soft text-success border-success-soft',
  warning: 'bg-warning-soft text-warning border-warning-soft',
  caution: 'bg-caution-soft text-caution border-caution-soft',
  danger: 'bg-danger-soft text-danger border-danger-soft',
  muted: 'bg-transparent text-ink-2 border-line',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  withDot?: boolean;
  children?: ReactNode;
}

/** 状态一律「文字 + 点或图标」一起表达，不单靠颜色。 */
export function Badge({ tone = 'neutral', withDot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-aux leading-tight font-medium',
        tones[tone],
        className
      )}
      {...rest}
    >
      {withDot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
