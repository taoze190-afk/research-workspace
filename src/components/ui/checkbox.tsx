import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cx';

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'onCheckedChange'> {
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

export function Checkbox({ className, label, onCheckedChange, ...rest }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-[18px] shrink-0 rounded-[5px] border border-line-strong bg-surface',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand',
        'hover:border-brand transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      aria-label={label}
      onCheckedChange={(v) => onCheckedChange?.(v === true)}
      {...rest}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-brand-on">
        {rest.checked === 'indeterminate' ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
