import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { ReadingStatusBadge } from '@/components/shared/status-badges';
import { useData } from '@/state/DataContext';
import { linkReferenceProject, unlinkReferenceProject } from '@/data/repo';
import { cn } from '@/lib/cx';

/** 给项目挑选已有文献：同一篇可以属于多个项目，这里只建立关联，不复制条目。 */
export function ReferencePicker({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string }) {
  const { data, mutate } = useData();
  const [query, setQuery] = useState('');
  const linked = useMemo(
    () => new Set(data.projectReferences.filter((l) => l.deletedAt === null && l.projectId === projectId).map((l) => l.referenceId)),
    [data.projectReferences, projectId]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.references
      .filter((r) => r.deletedAt === null)
      .filter((r) => (q ? [r.title, r.authors, r.venue, r.doi].join(' ').toLowerCase().includes(q) : true))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [data.references, query]);

  const toggle = (referenceId: string, on: boolean) =>
    mutate(() => (on ? linkReferenceProject(referenceId, projectId) : unlinkReferenceProject(referenceId, projectId)), { silent: true });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="选择已有文献">
        <div className="relative mb-2.5">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题、作者或 DOI" aria-label="搜索文献" className="pl-9" autoFocus />
        </div>
        {rows.length === 0 ? (
          <EmptyState compact title="文献库里还没有条目" />
        ) : (
          <ul className="overflow-hidden rounded-control border border-line">
            {rows.map((r) => {
              const on = linked.has(r.id);
              return (
                <li key={r.id} className={cn('row-line flex items-start gap-2 bg-surface px-3 py-2', on && 'bg-brand-soft/40')}>
                  <Checkbox checked={on} label={`${on ? '取消关联' : '关联'}：${r.title}`} onCheckedChange={(v) => void toggle(r.id, v)} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-body font-medium leading-snug">{r.title || '未命名条目'}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-aux text-ink-2">
                      {[r.authors, r.year].filter(Boolean).join(' · ')}
                      <ReadingStatusBadge status={r.readingStatus} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter className="-mx-5 -mb-4 mt-4">
          <span className="mr-auto text-aux text-ink-2">已关联 {linked.size} 条</span>
          <DialogClose asChild>
            <Button variant="primary">完成</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
