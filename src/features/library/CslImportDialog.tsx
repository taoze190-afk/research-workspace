import { useMemo, useRef, useState } from 'react';
import { CircleAlert, TriangleAlert, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { ReadingStatusBadge } from '@/components/shared/status-badges';
import { useData } from '@/state/DataContext';
import { createReference } from '@/data/repo';
import { parseCslJson, type CslImportPreview } from '@/lib/csl';
import { findDuplicate } from '@/domain/dedupe';
import { cn } from '@/lib/cx';

/** CSL-JSON 导入：先看数量和错误，再落库。 */
export function CslImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, mutate } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<CslImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const duplicates = useMemo(() => {
    if (!preview) return new Map<number, string>();
    const map = new Map<number, string>();
    const seen = new Set<string>();
    const pool = [...data.references];
    preview.items.forEach((item, index) => {
      const match = findDuplicate({ doi: item.reference.doi, title: item.reference.title, year: item.reference.year }, pool.filter((r) => !seen.has(r.id)));
      if (match.existing) {
        map.set(index, `${match.kind === 'doi' ? 'DOI 相同' : '疑似重复'}：${match.existing.title}`);
        seen.add(match.existing.id);
      }
      pool.push(item.reference);
    });
    return map;
  }, [preview, data.references]);

  const reset = () => {
    setPreview(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setPreview(parseCslJson(text));
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    const ok = await mutate(
      async () => {
        for (const item of preview.items) await createReference(item.reference);
      },
      { success: `已导入 ${preview.items.length} 条` }
    );
    setBusy(false);
    if (ok) {
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="导入 CSL-JSON"
        width="lg"
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="选择 CSL-JSON 文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pick(file);
          }}
        />

        {!preview ? (
          <EmptyState
            compact
            icon={<Upload size={22} />}
            title="还没有选择文件"
            action={
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
                选择 JSON 文件
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface-subtle px-3 py-2 text-aux">
              <span className="max-w-[45%] truncate font-medium text-ink">{fileName}</span>
              <Badge tone="brand">可导入 {preview.items.length} 条</Badge>
              {preview.total !== preview.items.length && <Badge tone="warning">跳过 {preview.total - preview.items.length} 项</Badge>}
              {duplicates.size > 0 && <Badge tone="warning">{duplicates.size} 条可能重复</Badge>}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={reset}>
                重新选择
              </Button>
            </div>

            {preview.rejected.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-control border border-danger-soft bg-danger-soft px-3 py-2 text-aux text-danger" role="status">
                {preview.rejected.map((r) => (
                  <li key={r} className="flex items-start gap-1.5">
                    <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            )}

            <ul className="scrollbar-thin max-h-[42vh] divide-y divide-line overflow-y-auto rounded-control border border-line">
              {preview.items.map((item, index) => (
                <li key={`${item.reference.id}-${index}`} className={cn('flex items-start gap-2.5 px-3 py-2', duplicates.has(index) && 'bg-warning-soft/50')}>
                  <span className="w-6 shrink-0 pt-0.5 text-aux tabular-nums text-ink-2">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-body font-medium leading-snug">{item.reference.title || '（缺标题）'}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-aux text-ink-2">
                      {[item.reference.authors, item.reference.year, item.reference.venue].filter(Boolean).join(' · ') || '元数据不全'}
                      {item.warnings.length > 0 && <Badge tone="warning">{item.warnings.join('、')}</Badge>}
                    </span>
                    {duplicates.get(index) && (
                      <span className="mt-1 flex items-center gap-1.5 text-aux text-warning">
                        <TriangleAlert size={12} aria-hidden />
                        {duplicates.get(index)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5">
                    <ReadingStatusBadge status="unread" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="-mx-5 -mb-4 mt-4">
          {preview && (
            <span className="mr-auto text-aux text-ink-2">重复条目不自动合并</span>
          )}
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          {!preview ? (
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              选择文件
            </Button>
          ) : (
            <Button variant="primary" disabled={preview.items.length === 0 || busy} onClick={() => void apply()}>
              {busy ? '正在写入…' : `导入 ${preview.items.length} 条`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
