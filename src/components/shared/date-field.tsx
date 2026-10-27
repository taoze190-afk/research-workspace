import { CalendarDays, X } from 'lucide-react';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { addDays, localToday } from '@/domain/date';
import { cn } from '@/lib/cx';

/**
 * 截止日期用原生 date input：语义就是本地日期，不经过时区换算。
 * 快捷键一律由调用方在输入框之外处理，输入法组合中（isComposing）不响应。
 */
export function DateField({
  label,
  value,
  onChange,
  quick = true,
  clearable = true,
  className,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  quick?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const today = localToday();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Field label={label}>
        {(id) => (
          // 用 minmax(0,1fr) 而不是 flex-1：日期输入框有 intrinsic 宽度，
          // 在窄列里不锁死轨道就会被它自己顶出容器。
          <div className="relative grid grid-cols-[minmax(0,1fr)] items-center">
            <Input
              id={id}
              type="date"
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value || null)}
              className="min-w-0"
            />
            {value && clearable && (
              // 贴在原生日历指示器左边，读起来是字段自己的清除按钮，而不是旁边多了一个控件。
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                aria-label="清除日期"
                onClick={(event) => {
                  event.currentTarget.parentElement?.querySelector('input')?.focus({ preventScroll: true });
                  onChange(null);
                }}
                className="date-clear-control absolute right-7 top-1/2 size-5 -translate-y-1/2 rounded-full !min-h-0 !min-w-0 text-ink-2 hover:text-danger"
              >
                <X size={13} />
              </Button>
            )}
          </div>
        )}
      </Field>
      {quick && (
        <div className="flex flex-wrap items-center gap-1">
          <CalendarDays size={13} className="mr-0.5 text-ink-2" aria-hidden />
          {(
            [
              ['今天', today],
              ['明天', addDays(today, 1)],
              ['本周内', addDays(today, 6)],
              ['下周', addDays(today, 7)],
            ] as const
          ).map(([text, date]) => (
            <button
              key={text}
              type="button"
              className={cn(
                'rounded-full border px-2 py-0.5 text-aux transition-colors duration-150',
                value === date
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-line text-ink-2 hover:border-line-strong hover:bg-surface-subtle',
              )}
              onClick={() => onChange(date)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
