import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cx';

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuItem = DropdownPrimitive.Item;
export const DropdownMenuCheckboxItem = DropdownPrimitive.CheckboxItem;
export const DropdownMenuSeparator = DropdownPrimitive.Separator;
export const DropdownMenuLabel = DropdownPrimitive.Label;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuSubTrigger = DropdownPrimitive.SubTrigger;
export function DropdownMenuSubContent(props: ComponentProps<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent {...props} />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownContent({
  children,
  align = 'end',
  className,
  sideOffset = 6,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
  sideOffset?: number;
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[188px] overflow-hidden rounded-panel border border-line bg-surface-glass backdrop-blur-xl p-1',
          'shadow-[var(--shadow-pop)]',
          'data-[state=open]:animate-[fadeIn_140ms_var(--ease-out-quart)]',
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuRow({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  close = true,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  close?: boolean;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        if (!close) event.preventDefault();
        onSelect?.();
      }}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-control px-2 py-1.5 text-body outline-none',
        'focus:bg-surface-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        danger && 'text-danger focus:bg-danger-soft',
      )}
    >
      {icon && <span className="shrink-0 text-ink-2 [.text-danger_&]:text-danger">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuItem>
  );
}
