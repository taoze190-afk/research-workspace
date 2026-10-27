import { useMemo, useState } from 'react';
import { Check, Pencil, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { deleteTag, renameTag } from '@/data/repo';
import type { Dataset } from '@/domain/types';

/** 每个标签当前挂在多少条活着的记录上（实体进了回收站的不算）。 */
function useTagCounts(data: Dataset): Map<string, number> {
  return useMemo(() => {
    const alive = new Set<string>();
    for (const [type, rows] of [
      ['project', data.projects],
      ['task', data.tasks],
      ['experiment', data.experiments],
      ['reference', data.references],
    ] as const) {
      for (const row of rows) if (row.deletedAt === null) alive.add(`${type}:${row.id}`);
    }
    const counts = new Map<string, number>();
    for (const et of data.entityTags) {
      if (et.deletedAt !== null || !alive.has(`${et.entityType}:${et.entityId}`)) continue;
      counts.set(et.tagId, (counts.get(et.tagId) ?? 0) + 1);
    }
    return counts;
  }, [data]);
}

export function TagManager() {
  const { data, mutate } = useData();
  const toast = useToast();
  const counts = useTagCounts(data);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmTag, setConfirmTag] = useState<{ id: string; name: string; count: number } | null>(null);

  const tags = useMemo(
    () => data.tags.filter((t) => t.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [data.tags]
  );

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setDraft(name);
  };

  const save = async () => {
    if (!editingId) return;
    const target = data.tags.find((t) => t.id !== editingId && t.deletedAt === null && t.name.toLowerCase() === draft.trim().toLowerCase());
    const ok = await mutate(() => renameTag(editingId, draft), { silent: true });
    setEditingId(null);
    if (!ok) return;
    toast({ title: target ? `已合并到「${target.name}」` : '已重命名', tone: 'success' });
  };

  return (
    <div className="flex flex-col divide-y divide-line">
      {tags.length === 0 && <p className="px-3.5 py-3 text-aux text-ink-2">还没有标签</p>}
      {tags.map((tag) => {
        const count = counts.get(tag.id) ?? 0;
        const editing = editingId === tag.id;
        return (
          <div key={tag.id} className="flex items-center gap-2 px-3.5 py-2">
            {editing ? (
              <>
                <Input
                  autoFocus
                  value={draft}
                  aria-label="新标签名"
                  className="h-8 max-w-[200px]"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void save();
                    }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => void save()}>
                  <Check size={13} aria-hidden />
                  保存
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                  <X size={13} aria-hidden />
                  取消
                </Button>
              </>
            ) : (
              <>
                <Tag size={13} className="shrink-0 text-ink-2" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{tag.name}</span>
                <span className="shrink-0 text-aux tabular-nums text-ink-2">{count} 条</span>
                <Button variant="ghost" size="iconSm" aria-label={`重命名标签「${tag.name}」`} onClick={() => startEdit(tag.id, tag.name)}>
                  <Pencil size={14} />
                </Button>
                <Button variant="dangerGhost" size="iconSm" aria-label={`删除标签「${tag.name}」`} onClick={() => setConfirmTag({ id: tag.id, name: tag.name, count })}>
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={confirmTag !== null}
        onOpenChange={(v) => !v && setConfirmTag(null)}
        danger
        title={confirmTag ? `删除标签「${confirmTag.name}」？` : ''}
        confirmLabel="删除标签"
        body={<p>{confirmTag?.count ?? 0} 条记录会失去这个标签，记录本身保留。</p>}
        onConfirm={() => {
          if (!confirmTag) return;
          void mutate(() => deleteTag(confirmTag.id), { success: '已删除标签' });
        }}
      />
    </div>
  );
}
