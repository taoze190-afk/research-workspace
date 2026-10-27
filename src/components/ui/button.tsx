import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'iconSm';

const variants: Record<ButtonVariant, string> = {
  primary:
    'text-brand-on border border-brand bg-brand hover:brightness-[1.08] active:brightness-[0.95] disabled:hover:brightness-100 shadow-[0_1px_2px_rgba(35,65,100,0.12),inset_0_1px_0_rgba(255,255,255,0.12)]',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-subtle active:bg-surface-subtle shadow-[0_1px_1.5px_rgba(15,23,42,0.06)]',
  ghost:
    'bg-transparent text-ink-2 border border-transparent hover:bg-surface-subtle hover:text-ink active:bg-surface-subtle',
  danger:
    'bg-danger text-white border border-danger hover:brightness-95 active:brightness-90 shadow-[0_1px_2px_rgba(15,23,42,0.25)]',
  dangerGhost: 'bg-transparent text-danger border border-transparent hover:bg-danger-soft active:bg-danger-soft',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-aux gap-1.5',
  md: 'h-10 px-4 text-body gap-2',
  icon: 'h-9 w-9 shrink-0 tap-expand',
  iconSm: 'h-8 w-8 shrink-0 tap-expand',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  asChild = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(
        'btn inline-flex items-center justify-center whitespace-nowrap rounded-control font-medium transition-[background,border-color,color] duration-150 ease-[var(--ease-out-quart)]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
