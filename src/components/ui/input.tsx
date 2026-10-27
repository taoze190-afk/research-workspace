import * as LabelPrimitive from '@radix-ui/react-label';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cx';

const controlBase =
  'rounded-control border border-line bg-surface px-3 text-body text-ink placeholder:text-ink-2/70 ' +
  'transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out-quart)] ' +
  'hover:border-line-strong focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70';

/**
 * 控件默认占满一行；调用方一旦自己写了 w-* / size-*，基础样式就不再带 w-full。
 * Tailwind v4 的工具类同层，后出现的规则会赢，靠 class 顺序压不住。
 */
const widthControlled = (className?: string) => /(^|\s)(w-\S+|size-\S+)/.test(className ?? '');
const base = (className?: string) => (widthControlled(className) ? controlBase : `${controlBase} w-full`);
const controlHeight = (className?: string) => (/(^|\s)(h-\S+|size-\S+)/.test(className ?? '') ? '' : 'h-10');

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base(className), controlHeight(className), className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(base(className), 'min-h-[76px] resize-y py-2 leading-relaxed', className)} {...rest} />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        base(className),
        controlHeight(className),
        'appearance-none bg-[right_0.6rem_center] pr-8',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-aux font-medium text-ink-2">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children(id)}
      {error ? <p className="text-aux text-danger">{error}</p> : null}
    </div>
  );
}

export function Label(props: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className="text-aux font-medium text-ink-2" {...props} />;
}
