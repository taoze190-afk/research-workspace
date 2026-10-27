import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DateField } from '@/components/shared/date-field';
import { FuzzyPicker } from '@/components/shared/fuzzy-picker';
import { useData } from '@/state/DataContext';
import { createTask, updateTask } from '@/data/repo';
import { PRIORITIES, RECURRENCES, TASK_STATUSES, priorityLabels, recurrenceLabels, taskStatusLabels, type Priority, type Recurrence, type Task, type TaskStatus } from '@/domain/types';

export interface TaskDraft {
  id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  projectId: string | null;
  recurrence: Recurrence;
  sourceExperimentId?: string | null;
  referenceId?: string | null;
}

export const emptyTaskDraft = (defaults: Partial<TaskDraft> = {}): TaskDraft => ({
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  projectId: null,
  recurrence: 'none',
  ...defaults,
});

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);

export function TaskFormDialog({
  open,
  onOpenChange,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: TaskDraft;
  onSaved?: (task: Task) => void;
}) {
  const { data, mutate } = useData();
  const [form, setForm] = useState<TaskDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 只在打开的瞬间取一次草稿：draft 每次渲染都是新对象，直接进依赖会反复重置表单。
  useEffect(() => {
    if (open) {
      setForm(draftRef.current);
      setError(null);
    }
  }, [open]);

  const projects = useMemo(() => data.projects.filter((p) => p.deletedAt === null), [data.projects]);
  const experimentItems = useMemo(
    () =>
      data.experiments
        .filter((e) => e.deletedAt === null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((e) => ({ id: e.id, label: e.title || '未命名实验', meta: e.experimentDate })),
    [data.experiments]
  );
  const referenceItems = useMemo(
    () =>
      data.references
        .filter((r) => r.deletedAt === null)
        .map((r) => ({ id: r.id, label: r.title || '未命名条目', meta: r.year ? String(r.year) : undefined })),
    [data.references]
  );
  const isEdit = !!draft.id;

  const submit = async () => {
    const title = form.title.trim();
    if (!title) {
      setError('请填写任务标题');
      return;
    }
      const ok = await mutate(
        () =>
          isEdit
            ? updateTask(draft.id!, {
                title,
                description: form.description,
                status: form.status,
                priority: form.priority,
                dueDate: form.dueDate,
                projectId: form.projectId,
                recurrence: form.recurrence,
                sourceExperimentId: form.sourceExperimentId ?? null,
                referenceId: form.referenceId ?? null,
              })
            : createTask({
                title,
                description: form.description,
                status: form.status,
                priority: form.priority,
                dueDate: form.dueDate,
                projectId: form.projectId,
                recurrence: form.recurrence,
                sourceExperimentId: form.sourceExperimentId ?? null,
                referenceId: form.referenceId ?? null,
              }),
        { success: '已保存' }
      );
    if (!ok) return;
    onOpenChange(false);
    onSaved?.({ id: draft.id ?? '', title } as Task);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? '编辑任务' : '新建任务'}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="flex flex-col gap-2.5">
            <Field label="标题" required error={error ?? undefined}>
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  value={form.title}
                  placeholder="例如：重跑 5 号受试者缺失的两段数据"
                  aria-invalid={!!error}
                  onChange={(e) => {
                    setForm({ ...form, title: e.target.value });
                    if (error) setError(null);
                  }}
                />
              )}
            </Field>
            <Field label="描述">
              {(id) => <Textarea id={id} value={form.description} placeholder="判据、参数、注意点" onChange={(e) => setForm({ ...form, description: e.target.value })} />}
            </Field>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="所属项目">
                {(id) => (
                  <Select id={id} value={form.projectId ?? ''} onChange={(e) => setForm({ ...form, projectId: e.target.value || null })}>
                    <option value="">不关联项目</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="优先级">
                {(id) => (
                  <Select id={id} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {priorityLabels[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <DateField label="截止日期" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
            <Field label="重复">
              {(id) => (
                <Select id={id} value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as Recurrence })}>
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {recurrenceLabels[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {isEdit && (
              <Field label="状态">
                {(id) => (
                  <Select id={id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {taskStatusLabels[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="关联实验">
              {() => <FuzzyPicker items={experimentItems} value={form.sourceExperimentId ?? null} onChange={(id) => setForm({ ...form, sourceExperimentId: id })} placeholder="搜索实验…" ariaLabel="关联实验" />}
            </Field>
            <Field label="关联文献">
              {() => <FuzzyPicker items={referenceItems} value={form.referenceId ?? null} onChange={(id) => setForm({ ...form, referenceId: id })} placeholder="搜索文献…" ariaLabel="关联文献" />}
            </Field>
          </div>

          <DialogFooter className="-mx-5 -mb-4">
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              {isEdit ? '保存修改' : '创建任务'}
              <kbd className="ml-1 hidden rounded border border-white/40 px-1 text-[10px] font-normal sm:inline">{isMac ? '⌘⏎' : 'Ctrl+⏎'}</kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
