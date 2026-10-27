import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cx';

export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  id,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      disabled={disabled}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border border-line bg-surface-subtle transition-colors duration-150',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-1 rounded-full bg-surface shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  );
}
