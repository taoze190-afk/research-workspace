import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleCheck, CircleAlert, Undo2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cx';
import './toast.css';

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
  open: boolean;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);

  const push = useCallback((input: ToastInput) => {
    const id = ++seq;
    setItems((prev) => {
      const active = prev.filter((t) => t.open);
      const retained =
        !input.action && input.tone !== 'error' ? active.filter((t) => t.action || t.tone === 'error') : active;
      return [...retained.slice(-2), { ...input, id, open: true }];
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" label="通知">
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            open={t.open}
            onOpenChange={(open) => !open && dismiss(t.id)}
            duration={t.duration ?? (t.action ? 7000 : 3600)}
            type={t.action || t.tone === 'error' ? 'foreground' : 'background'}
            className={cn(
              'toast-item z-[60] flex items-start gap-2.5 rounded-panel border border-line bg-surface px-3.5 py-3',
              'shadow-[var(--shadow-pop)]',
              'data-[state=open]:animate-[fadeIn_150ms_var(--ease-out-quart)]',
            )}
          >
            <span
              className={cn(
                'mt-0.5 shrink-0',
                t.tone === 'error' ? 'text-danger' : t.tone === 'info' ? 'text-info' : 'text-brand',
              )}
              aria-hidden
            >
              {t.tone === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-body font-medium">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="mt-0.5 text-aux text-ink-2">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            {t.action && (
              <button
                type="button"
                className="toast-action btn inline-flex items-center gap-1 rounded-control border border-line px-2 py-1 text-aux font-medium hover:bg-surface-subtle"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                <Undo2 size={13} />
                {t.action.label}
              </button>
            )}
            <ToastPrimitive.Close
              className="toast-close shrink-0 rounded-control p-1 text-ink-2 hover:bg-surface-subtle"
              aria-label="关闭提示"
            >
              <X size={14} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          label="操作通知"
          className="toast-viewport fixed z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 outline-none"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
