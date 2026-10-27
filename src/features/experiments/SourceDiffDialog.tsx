import { useMemo } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { compactDiff, diffLines } from '@/domain/diff';
import { experimentStatusLabels, type Experiment } from '@/domain/types';
import { cn } from '@/lib/cx';

const TEXT_FIELDS = [
  { key: 'title', label: '标题' },
  { key: 'purpose', label: '目的' },
  { key: 'hypothesis', label: '假设' },
  { key: 'method', label: '方法与步骤' },
  { key: 'results', label: '结果' },
  { key: 'observations', label: '观察与异常' },
  { key: 'conclusion', label: '结论' },
  { key: 'nextStep', label: '下一步' },
] as const;

type TextKey = (typeof TEXT_FIELDS)[number]['key'];

/**
 * 与复制来源逐字段对比：只有差异的字段展开行级 diff，
 * 没动的字段收成一行标签，复制出去改了哪些地方一眼能看完。
 */
export function SourceDiffDialog({
  open,
  onOpenChange,
  source,
  current,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: Experiment;
  current: Experiment;
}) {
  const { changed, same } = useMemo(() => {
    const pairs = TEXT_FIELDS.map((f) => [f.key, source[f.key] ?? '', current[f.key] ?? ''] as const);
    return {
      changed: pairs.filter(([, a, b]) => a.trim() !== b.trim()),
      same: pairs
        .filter(([, a, b]) => a.trim() === b.trim())
        .map(([key]) => TEXT_FIELDS.find((f) => f.key === key)!.label),
    };
  }, [source, current]);

  const statusChanged = source.status !== current.status;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="与来源对比" width="lg">
        <div className="flex flex-col gap-4">
          <p className="text-aux text-ink-2">
            来源：{source.title || '未命名实验'} · {experimentStatusLabels[source.status]}
            {statusChanged && (
              <span className="ml-2 text-warning">
                状态 {experimentStatusLabels[source.status]} → {experimentStatusLabels[current.status]}
              </span>
            )}
          </p>

          {changed.length === 0 ? (
            <p className="text-body text-ink-2">和来源一字不差。</p>
          ) : (
            changed.map(([key, before, after]) => {
              const label = TEXT_FIELDS.find((f) => f.key === key)!.label;
              return (
                <section key={key}>
                  <h3 className="mb-1.5 text-[14px] font-semibold">{label}</h3>
                  <div className="overflow-hidden rounded-panel border border-line font-mono text-[14px] leading-6">
                    {compactDiff(diffLines(before, after)).map((row, i) =>
                      row.type === 'gap' ? (
                        <p
                          key={`gap-${i}`}
                          className="bg-surface-subtle/60 px-3 py-0.5 text-center text-aux text-ink-2"
                        >
                          {row.count} 行未变
                        </p>
                      ) : (
                        <p
                          key={`${row.type}-${i}`}
                          className={cn(
                            'whitespace-pre-wrap break-words px-3 py-0.5',
                            row.type === 'del' && 'bg-danger-soft text-danger line-through decoration-danger/50',
                            row.type === 'add' && 'bg-brand-soft text-brand-ink',
                            row.type === 'same' && 'text-ink-2',
                          )}
                        >
                          {row.text || ' '}
                        </p>
                      ),
                    )}
                  </div>
                </section>
              );
            })
          )}

          {same.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[14px] font-semibold">未改动</h3>
              <div className="flex flex-wrap gap-1.5">
                {same.map((label) => (
                  <Badge key={label} tone="muted">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { TextKey };
