import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TagEditor } from '@/components/shared/tag-editor';
import { useData } from '@/state/DataContext';
import { createProject, setEntityTags, updateProject } from '@/data/repo';
import { PROJECT_STATUSES, projectStatusLabels, type Project, type ProjectStatus } from '@/domain/types';
import { DateField } from '@/components/shared/date-field';

export interface ProjectDraft {
  id?: string;
  name: string;
  question: string;
  goal: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  favorite: boolean;
  tags: string[];
}

export const emptyProjectDraft = (defaults: Partial<ProjectDraft> = {}): ProjectDraft => ({
  name: '',
  question: '',
  goal: '',
  status: 'planned',
  startDate: null,
  endDate: null,
  favorite: false,
  tags: [],
  ...defaults,
});

export function projectToDraft(p: Project): ProjectDraft {
  return {
    id: p.id,
    name: p.name,
    question: p.question,
    goal: p.goal,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    favorite: p.favorite,
    tags: [],
  };
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: ProjectDraft;
  onSaved?: (project: Project) => void;
}) {
  const { mutate } = useData();
  const [form, setForm] = useState<ProjectDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (open) {
      setForm(draftRef.current);
      setError(null);
    }
  }, [open]);

  const isEdit = !!draft.id;

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('请填写项目名称');
      return;
    }
    let saved: Project | null = null;
    const ok = await mutate(
      async () => {
        if (isEdit) {
          await updateProject(draft.id!, {
            name,
            question: form.question,
            goal: form.goal,
            status: form.status,
            startDate: form.startDate,
            endDate: form.endDate,
            favorite: form.favorite,
          });
          await setEntityTags('project', draft.id!, form.tags);
        } else {
          const created = await createProject({
            name,
            question: form.question,
            goal: form.goal,
            status: form.status,
            startDate: form.startDate,
            endDate: form.endDate,
            favorite: form.favorite,
          });
          if (form.tags.length) await setEntityTags('project', created.id, form.tags);
          saved = created;
        }
      },
      { success: '已保存' }
    );
    if (!ok) return;
    onOpenChange(false);
    if (!isEdit && saved) onSaved?.(saved);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? '编辑项目' : '新建科研项目'}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="项目名称" required error={error ?? undefined}>
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={form.name}
                placeholder="例如：腕臂式肌电信号采集装置"
                aria-invalid={!!error}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <Field label="研究问题">
            {(id) => <Textarea id={id} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />}
          </Field>
          <Field label="目标">
            {(id) => <Textarea id={id} value={form.goal} placeholder="做到什么程度算完成" onChange={(e) => setForm({ ...form, goal: e.target.value })} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="状态">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {projectStatusLabels[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex items-end gap-2 pb-1.5">
              <Switch checked={form.favorite} onCheckedChange={(v) => setForm({ ...form, favorite: v })} label="收藏" id="project-favorite" />
              <label htmlFor="project-favorite" className="text-body text-ink-2">
                收藏
              </label>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label="开始日期" value={form.startDate} quick={false} onChange={(v) => setForm({ ...form, startDate: v })} />
            <DateField label="预计结束" value={form.endDate} quick={false} onChange={(v) => setForm({ ...form, endDate: v })} />
          </div>
          {isEdit ? (
            <Field label="标签">
              {(id) => <TagEditor key={id} value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />}
            </Field>
          ) : (
            <Field label="标签">
              {(id) => <Input id={id} value={form.tags.join('，')} placeholder="用逗号分隔，例如：采集，标注" onChange={(e) => setForm({ ...form, tags: e.target.value.split(/[，,]/) })} />}
            </Field>
          )}
          <DialogFooter className="-mx-5 -mb-4 mt-2">
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              {isEdit ? '保存修改' : '创建项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
