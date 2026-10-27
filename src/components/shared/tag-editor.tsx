import { Check, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useData } from '@/state/DataContext';
import { cn } from '@/lib/cx';

/** 标签编辑：输入后回车或点「添加」，可一次勾掉多个。落库由调用方负责，写入统一走 repo.setEntityTags。 */
export function TagEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { data } = useData();
  const [draft, setDraft] = useState('');

  const suggestions = useMemo(() => {
    const used = new Set(value.map((v) => v.toLowerCase()));
    return data.tags
      .filter((t) => t.deletedAt === null && !used.has(t.name.toLowerCase()))
      .slice(0, 8)
      .map((t) => t.name);
  }, [data.tags, value]);

  const add = (name: string) => {
    const clean = name.trim().replace(/^#/, '');
    if (!clean) return;
    if (value.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, clean]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-aux text-ink-2">还没有标签</span>}
        {value.map((name) => (
          <Badge key={name} tone="neutral" className="gap-1 pr-1">
            {name}
            <button
              type="button"
              className="rounded-full p-0.5 text-ink-2 hover:bg-surface hover:text-danger"
              aria-label={`移除标签 ${name}`}
              onClick={() => onChange(value.filter((v) => v !== name))}
            >
              <Plus size={11} className="rotate-45" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          className="min-w-0"
          value={draft}
          placeholder="输入标签后回车"
          aria-label="添加标签"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => add(draft)}>
          添加
        </Button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-aux text-ink-2">已有：</span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              className={cn('inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-aux text-ink-2 hover:border-brand hover:text-brand-ink')}
              onClick={() => add(name)}
            >
              <Check size={11} aria-hidden />
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
