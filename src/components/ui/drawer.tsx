import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cx';
import { OverlayContent } from './overlay-content';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

/** 右侧详情抽屉：440–520px，小屏退化成全宽。列表上下文由父组件保持，抽屉只负责详情。 */
export function DrawerContent({
  children,
  title,
  subtitle,
  footer,
  label,
  onCloseAutoFocus,
  bodyLayout = 'scroll',
  closeLabel = '关闭',
}: {
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  label: string;
  onCloseAutoFocus?: (event: Event) => void;
  bodyLayout?: 'scroll' | 'flex';
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fadeIn_150ms_var(--ease-out-quart)]" />
      <OverlayContent
        onCloseAutoFocus={onCloseAutoFocus}
        aria-label={label}
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-[min(520px,100vw)] flex-col border-l border-line bg-surface-glass backdrop-blur-xl',
          'shadow-[-24px_0_48px_-32px_rgba(24,34,48,0.35)]',
          'data-[state=open]:animate-[slideInRight_180ms_var(--ease-out-quart)] data-[state=closed]:animate-[slideOutRight_160ms_var(--ease-out-quart)]',
        )}
      >
        <div
          className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="truncate text-section font-semibold">{title}</DialogPrimitive.Title>
            {subtitle && (
              <DialogPrimitive.Description className="mt-0.5 block truncate text-aux text-ink-2">
                {subtitle}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="overlay-close inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-surface-subtle hover:text-ink"
            aria-label={closeLabel}
          >
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div
          className={cn(
            'overlay-scroll scrollbar-thin min-h-0 flex-1',
            bodyLayout === 'flex' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        )}
      </OverlayContent>
    </DialogPrimitive.Portal>
  );
}
