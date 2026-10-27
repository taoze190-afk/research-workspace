import { useMemo, useState } from 'react';
import { CornerDownLeft, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { parseQuickAdd } from '@/domain/quickAdd';
import { formatShortDate, localToday } from '@/domain/date';
import { priorityLabels, type Project } from '@/domain/types';
import { cn } from '@/lib/cx';

/**
 * 全局快速捕获条：一句话建任务（日期词 / @项目 / #或!优先级）。
 * 解析结果以草稿芯片实时预览在输入框下方，回车创建，Esc 清空。
 */
export function QuickInputBar({
  projects,
  onCreate,
  busy,
  className,
}: {
  projects: Project[];
  onCreate: (parsed: { title: string; dueDate: string | null; priority: string; projectId: string | null }) => Promise<boolean>;
  busy?: boolean;
  className?: string;
}) {
  const [text, setText] = useState('');
  const today = localToday();
  const parsed = useMemo(() => parseQuickAdd(text, projects, today), [text, projects, today]);
  const project = projects.find((p) => p.id === parsed.projectId);
  const hasHints = !!(parsed.dueDate || parsed.projectId || parsed.priority !== 'medium');

  const submit = async () => {
    if (busy) return;
    if (!parsed.title.trim()) return;
    const ok = await onCreate(parsed);
    if (ok) setText('');
  };

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Plus size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') setText('');
          }}
          placeholder="快速捕获，回车创建"
          aria-label="快速捕获任务"
          className="h-10 pl-9 pr-16"
          disabled={busy}
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-2 sm:inline-flex">
          <CornerDownLeft size={10} aria-hidden /> 创建
        </kbd>
      </div>
      {hasHints && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1" aria-live="polite">
          {parsed.dueDate && (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-brand-soft px-2 py-0.5 text-aux text-brand-ink">
              {formatShortDate(parsed.dueDate)}
            </span>
          )}
          {parsed.priority !== 'medium' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning-soft bg-warning-soft px-2 py-0.5 text-aux text-warning">
              {priorityLabels[parsed.priority as 'urgent' | 'high' | 'low']}
            </span>
          )}
          {project && (
            <span className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-line px-2 py-0.5 text-aux text-ink-2">
              <span className="truncate">{project.name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
