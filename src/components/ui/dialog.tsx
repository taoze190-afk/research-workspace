import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cx';
import { Button } from './button';
import { OverlayContent } from './overlay-content';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  title,
  description,
  className,
  width = 'md',
  onCloseAutoFocus,
  onOpenAutoFocus,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  className?: string;
  width?: 'sm' | 'md' | 'lg';
  onCloseAutoFocus?: (event: Event) => void;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const widths = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]' } as const;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-[fadeIn_150ms_var(--ease-out-quart)]" />
      <OverlayContent
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
          'rounded-panel border border-line bg-surface-glass backdrop-blur-xl shadow-[var(--shadow-pop)]',
          'data-[state=open]:animate-[popIn_160ms_var(--ease-out-quart)]',
          widths[width],
          className,
        )}
      >
        <DialogPrimitive.Title className="shrink-0 border-b border-line px-6 py-5 pr-16 text-section font-semibold">
          {title}
          {description && (
            <DialogPrimitive.Description className="mt-1 block text-aux font-normal text-ink-2">
              {description}
            </DialogPrimitive.Description>
          )}
        </DialogPrimitive.Title>
        {!description && <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        <div className="overlay-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <DialogPrimitive.Close
          className="overlay-close absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-surface-subtle hover:text-ink"
          aria-label="关闭"
        >
          <X size={16} />
        </DialogPrimitive.Close>
      </OverlayContent>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} width="sm" onCloseAutoFocus={onCloseAutoFocus}>
        {body ? <div className="text-body text-ink-2">{body}</div> : null}
        <DialogFooter className="-mx-5 -mb-4 mt-4">
          <DialogClose asChild>
            <Button variant="secondary">{cancelLabel}</Button>
          </DialogClose>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
