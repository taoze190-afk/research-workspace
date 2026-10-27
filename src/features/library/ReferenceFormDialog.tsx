import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { TagEditor } from '@/components/shared/tag-editor';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { createReference, setEntityTags, updateReference } from '@/data/repo';
import { fetchDoiMetadata } from '@/lib/doi';
import { findDuplicate, normalizeDoi, type DuplicateMatch } from '@/domain/dedupe';
import { READING_STATUSES, readingStatusLabels, type ReadingStatus, type Reference } from '@/domain/types';

export interface ReferenceDraft {
  id?: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
  readingStatus: ReadingStatus;
  tags: string[];
}

export const emptyReferenceDraft = (defaults: Partial<ReferenceDraft> = {}): ReferenceDraft => ({
  title: '',
  authors: '',
  year: '',
  venue: '',
  doi: '',
  url: '',
  readingStatus: 'unread',
  tags: [],
  ...defaults,
});

export function referenceToDraft(r: Reference): ReferenceDraft {
  return {
    id: r.id,
    title: r.title,
    authors: r.authors,
    year: r.year ? String(r.year) : '',
    venue: r.venue,
    doi: r.doi,
    url: r.url,
    readingStatus: r.readingStatus,
    tags: [],
  };
}

export function ReferenceFormDialog({
  open,
  onOpenChange,
  draft,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: ReferenceDraft;
  onSaved?: (reference: Reference) => void;
  onOpenExisting?: (id: string) => void;
}) {
  const { data, mutate } = useData();
  const toast = useToast();
  const [form, setForm] = useState<ReferenceDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch>({ kind: null, existing: null });
  const [fetching, setFetching] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** 按 DOI 联网补全：只填空字段，绝不覆盖已经写进去的内容；失败就退回手填。 */
  const completeFromDoi = async () => {
    setFetching(true);
    try {
      const meta = await fetchDoiMetadata(form.doi);
      if (!meta) {
        toast({ title: '没有查到这条 DOI', tone: 'error' });
        return;
      }
      setForm((f) => ({
        ...f,
        title: f.title.trim() ? f.title : meta.title,
        authors: f.authors.trim() ? f.authors : meta.authors,
        year: f.year.trim() ? f.year : meta.year ? String(meta.year) : f.year,
        venue: f.venue.trim() ? f.venue : meta.venue,
        url: f.url.trim() ? f.url : meta.url,
      }));
      toast({ title: '已填入元数据', tone: 'success' });
    } catch {
      toast({ title: '补全失败', description: '连不上 Crossref，稍后再试或手填', tone: 'error' });
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (open) {
      setForm(draftRef.current);
      setError(null);
      setDuplicate({ kind: null, existing: null });
    }
  }, [open]);

  const isEdit = !!draft.id;

  const checked = useMemo(
    () =>
      findDuplicate(
        { doi: form.doi, title: form.title, year: form.year ? Number(form.year) : null },
        data.references.filter((r) => r.id !== draft.id)
      ),
    [form.doi, form.title, form.year, data.references, draft.id]
  );

  useEffect(() => {
    if (!open) return;
    // 编辑原条目时不该把自己算成重复，也不在刚打开时就弹提示。
    if (form.title.length < 4) {
      setDuplicate({ kind: null, existing: null });
      return;
    }
    if (checked.existing && checked.existing.id !== draft.id) setDuplicate(checked);
    else setDuplicate({ kind: null, existing: null });
  }, [checked, open, form.title, draft.id]);

  const submit = async () => {
    const title = form.title.trim();
    if (!title) {
      setError('请填写标题');
      return;
    }
    const yearValue = form.year.trim();
    if (yearValue && !/^\d{4}$/.test(yearValue)) {
      setError('年份写成四位数字，或者先留空');
      return;
    }
    let created: Reference | null = null;
    const ok = await mutate(
      async () => {
        const payload = {
          title,
          authors: form.authors.trim(),
          year: yearValue ? Number(yearValue) : null,
          venue: form.venue.trim(),
          doi: normalizeDoi(form.doi),
          url: form.url.trim(),
          readingStatus: form.readingStatus,
        };
        if (isEdit) {
          await updateReference(draft.id!, payload);
          await setEntityTags('reference', draft.id!, form.tags);
        } else {
          const row = await createReference(payload);
          if (form.tags.length) await setEntityTags('reference', row.id, form.tags);
          created = row;
        }
      },
      { success: '已保存' }
    );
    if (!ok) return;
    onOpenChange(false);
    if (!isEdit && created) onSaved?.(created);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? '编辑文献条目' : '新增文献条目'}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2.5">
            <Field label="标题" required error={error ?? undefined}>
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  value={form.title}
                  aria-invalid={!!error}
                  onChange={(e) => {
                    setForm({ ...form, title: e.target.value });
                    if (error) setError(null);
                  }}
                />
              )}
            </Field>
            <div className="grid gap-2.5 sm:grid-cols-[1fr_110px]">
              <Field label="作者">
                {(id) => <Input id={id} value={form.authors} placeholder="张三；李四" onChange={(e) => setForm({ ...form, authors: e.target.value })} />}
              </Field>
              <Field label="年份">
                {(id) => <Input id={id} inputMode="numeric" value={form.year} placeholder="2026" onChange={(e) => setForm({ ...form, year: e.target.value })} />}
              </Field>
            </div>
            <Field label="期刊或会议">
              {(id) => <Input id={id} value={form.venue} placeholder="期刊或会议全称" onChange={(e) => setForm({ ...form, venue: e.target.value })} />}
            </Field>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="DOI">
                {(id) => (
                  <div className="flex gap-1.5">
                    <Input id={id} value={form.doi} placeholder="10.xxxx/yyyy" onChange={(e) => setForm({ ...form, doi: e.target.value })} />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={fetching || !normalizeDoi(form.doi)}
                      onClick={() => void completeFromDoi()}
                    >
                      <Sparkles size={13} aria-hidden />
                      {fetching ? '查询中…' : '补全'}
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="链接">
                {(id) => <Input id={id} type="url" value={form.url} placeholder="https://" onChange={(e) => setForm({ ...form, url: e.target.value })} />}
              </Field>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="阅读状态">
                {(id) => (
                  <Select id={id} value={form.readingStatus} onChange={(e) => setForm({ ...form, readingStatus: e.target.value as ReadingStatus })}>
                    {READING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {readingStatusLabels[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {isEdit && (
                <Field label="标签">
                  {(id) => <TagEditor key={id} value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />}
                </Field>
              )}
            </div>
          </div>

          {duplicate.existing && (
            <div className="flex items-start gap-2 rounded-control border border-warning-soft bg-warning-soft px-3 py-2 text-aux text-warning" role="status">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  {duplicate.kind === 'doi' ? 'DOI 相同：' : '疑似重复：'}「{duplicate.existing.title}」
                </p>
                {onOpenExisting && (
                  <button type="button" className="mt-1 font-medium underline underline-offset-2" onClick={() => onOpenExisting(duplicate.existing!.id)}>
                    查看已有条目
                  </button>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="-mx-5 -mb-4">
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              {isEdit ? '保存修改' : '保存条目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
