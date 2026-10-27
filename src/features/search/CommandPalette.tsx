import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, FolderPlus, ListPlus, Search, Settings, Sparkles, Wand2 } from 'lucide-react';
import { searchAll, entityTypeLabels, type SearchHit } from '@/domain/search';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { createTask } from '@/data/repo';
import { parseQuickAdd } from '@/domain/quickAdd';
import { localToday } from '@/domain/date';
import { ENTITY_TYPES, type EntityType } from '@/domain/types';
import { cn } from '@/lib/cx';
import { OverlayContent } from '@/components/ui/overlay-content';

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  icon: typeof ListPlus;
  to: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'task', label: '新建任务', hint: 'N', icon: ListPlus, to: '/tasks?new=1' },
  { key: 'project', label: '新建项目', hint: '', icon: FolderPlus, to: '/projects?new=1' },
  { key: 'settings', label: '设置与数据', hint: '', icon: Settings, to: '/settings' },
];

export function CommandPalette({
  open,
  onOpenChange,
  onAsk,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAsk?: (question: string) => void;
}) {
  const { data, mutate } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<EntityType | ''>('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const hits = searchAll(data, query).filter((h) => !typeFilter || h.entityType === typeFilter);
    const order: Record<SearchHit['entityType'], number> = { project: 0, task: 1, experiment: 2, reference: 3 };
    return hits
      .sort((a, b) => order[a.entityType] - order[b.entityType] || a.title.localeCompare(b.title, 'zh-CN'))
      .slice(0, 40);
  }, [data, query, typeFilter]);

  useEffect(() => {
    if (open) {
      setActive(0);
      return;
    }
    setQuery('');
    setTypeFilter('');
    return undefined;
  }, [open]);

  useEffect(() => setActive(0), [query, typeFilter]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    const list = listRef.current;
    if (!el || !list) return;
    const rowRect = el.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
  }, [active]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpenChange(false);
    navigate(hit.href);
  };

  const jump = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[55] bg-overlay" />
        <OverlayContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
          className={cn(
            'fixed left-1/2 top-[12vh] z-[56] w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-panel border border-line bg-surface-glass backdrop-blur-xl',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">全局搜索</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <Search size={16} className="shrink-0 text-ink-2" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const raw = query.trim();
                  if (raw.startsWith('/ask ')) {
                    const q = raw.slice(5).trim();
                    if (q && onAsk) {
                      onOpenChange(false);
                      onAsk(q);
                    }
                    return;
                  }
                  if (raw.startsWith('/new-task ')) {
                    const parsed = parseQuickAdd(raw.slice(10), data.projects, localToday());
                    if (!parsed.title.trim()) {
                      toast({ title: '先写点标题', tone: 'error' });
                      return;
                    }
                    onOpenChange(false);
                    void mutate(
                      () =>
                        createTask({
                          title: parsed.title,
                          dueDate: parsed.dueDate,
                          priority: parsed.priority as 'urgent' | 'high' | 'medium' | 'low',
                          projectId: parsed.projectId,
                        }),
                      { success: '已添加' },
                    );
                    return;
                  }
                  go(results[active]);
                }
              }}
              placeholder="搜索"
              aria-label="搜索内容"
              aria-controls="search-results"
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
              className="h-8 w-full border-0 bg-transparent text-body outline-none placeholder:text-ink-2/70"
            />
            <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-2">Esc</kbd>
          </div>

          <div
            className="flex items-center gap-1 border-b border-line px-3 py-1.5"
            role="group"
            aria-label="按类型过滤"
          >
            {(['', ...ENTITY_TYPES] as const).map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={typeFilter === value}
                onClick={() => setTypeFilter(value)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-aux transition-colors duration-150',
                  typeFilter === value
                    ? 'bg-brand-soft font-medium text-brand-ink'
                    : 'text-ink-2 hover:bg-surface-subtle',
                )}
              >
                {value ? entityTypeLabels[value] : '全部'}
              </button>
            ))}
          </div>

          {query.trim().startsWith('/') && (
            <div
              className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5 text-aux text-ink-2"
              aria-label="可用指令"
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand-ink">
                <Sparkles size={10} aria-hidden />
                /ask 问题 → AI 全库问答
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand-ink">
                <Wand2 size={10} aria-hidden />
                /new-task 描述 → 智能建任务
              </span>
            </div>
          )}

          <div
            id="search-results"
            ref={listRef}
            className="overlay-scroll scrollbar-thin max-h-[52vh] min-h-[88px] overflow-y-auto p-1.5"
            role="listbox"
            aria-label="搜索结果"
          >
            {query.trim() === '' ? null : results.length === 0 ? (
              <p className="px-3 py-5 text-center text-aux text-ink-2">没有匹配「{query.trim()}」的记录</p>
            ) : (
              results.map((hit, i) => (
                <button
                  key={`${hit.entityType}-${hit.id}`}
                  type="button"
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-control px-3 py-2 text-left transition-colors duration-100',
                    i === active ? 'bg-brand-soft' : 'hover:bg-surface-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                      i === active ? 'bg-brand text-white' : 'bg-surface-subtle text-ink-2',
                    )}
                  >
                    {entityTypeLabels[hit.entityType]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{hit.title}</span>
                    {hit.context && <span className="mt-0.5 block truncate text-aux text-ink-2">{hit.context}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={14} className="mt-1 shrink-0 text-ink-2" aria-hidden />}
                </button>
              ))
            )}
          </div>

          {query.trim() === '' && (
            <div className="border-t border-line p-1.5" aria-label="快捷动作">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => jump(action.to)}
                  className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors duration-100 hover:bg-surface-subtle"
                >
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface-subtle text-ink-2"
                    aria-hidden
                  >
                    <action.icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1 text-body font-medium">{action.label}</span>
                  {action.hint && (
                    <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-2">
                      {action.hint}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}
        </OverlayContent>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
