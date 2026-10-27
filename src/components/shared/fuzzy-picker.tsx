import { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cx';

export interface PickerItem {
  id: string;
  label: string;
  meta?: string;
}

/**
 * 联想选择器：输入即过滤，方向键移动、Enter 选中、Esc 收起（收起不会冒泡关掉外层对话框）。
 * 选中后显示为可清除的一行。清空搜索框回车即清除选择。
 */
export function FuzzyPicker({
  items,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  items: PickerItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? items.filter((i) => `${i.label} ${i.meta ?? ''}`.toLowerCase().includes(q)) : items;
    return pool.slice(0, 8);
  }, [items, query]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={boxRef} className="relative">
      {selected && !open ? (
        <div className="flex h-10 items-center gap-2 rounded-control border border-brand-soft bg-brand-soft/60 px-2.5">
          <span
            className="min-w-0 flex-1 truncate text-body text-brand-ink"
            title={selected.meta ? `${selected.label}（${selected.meta}）` : selected.label}
          >
            {selected.label}
            {selected.meta && <span className="ml-1.5 text-aux text-ink-2">{selected.meta}</span>}
          </span>
          <button
            type="button"
            aria-label={`清除已选：${selected.label}`}
            className="shrink-0 rounded p-1 text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-danger"
            onClick={() => onChange(null)}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={query}
            role="combobox"
            aria-expanded={open && filtered.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (open && filtered[active]) pick(filtered[active].id);
                else if (!query.trim()) pick(null);
              } else if (e.key === 'Escape') {
                if (open) {
                  e.stopPropagation();
                  setOpen(false);
                }
              }
            }}
          />
          <ChevronsUpDown
            size={13}
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-2"
          />
        </div>
      )}

      {open && !selected && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="scrollbar-thin absolute left-0 right-0 top-full z-[70] mt-1 max-h-[240px] overflow-y-auto rounded-panel border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-3 text-center text-aux text-ink-2">没有匹配的条目</li>
          ) : (
            filtered.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-100',
                    i === active ? 'bg-brand-soft text-brand-ink' : 'hover:bg-surface-subtle',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.meta && <span className="shrink-0 text-aux text-ink-2">{item.meta}</span>}
                  {item.id === value && <Check size={13} aria-hidden className="shrink-0 text-brand-ink" />}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
