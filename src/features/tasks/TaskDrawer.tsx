import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BookMarked, Check, FlaskConical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DateField } from '@/components/shared/date-field';
import { PriorityBadge, TaskStatusBadge } from '@/components/shared/status-badges';
import { useData } from '@/state/DataContext';
import { addSubtask, deleteSubtask, updateSubtask, updateTask } from '@/data/repo';
import {
  PRIORITIES,
  RECURRENCES,
  TASK_STATUSES,
  priorityLabels,
  recurrenceLabels,
  taskStatusLabels,
  type Task,
  type TaskStatus,
} from '@/domain/types';
import { formatTimestamp } from '@/domain/date';
import { useTaskActions } from './useTaskActions';
import { cn } from '@/lib/cx';
import { useDebouncedSave } from '@/lib/useDebouncedSave';
import { aiWorkspaceHref } from '@/features/ai/context';

export function TaskDrawer({
  task,
  open,
  onOpenChange,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!task) return null;
  return <TaskDrawerEditor key={task.id} task={task} open={open} onOpenChange={onOpenChange} />;
}

function TaskDrawerEditor({
  task,
  open,
  onOpenChange,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data, mutate } = useData();
  const navigate = useNavigate();
  const actions = useTaskActions();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const draft = useMemo(() => ({ title, description }), [title, description]);
  const { state: saveNote, flush } = useDebouncedSave(
    draft,
    (patch) => mutate(() => updateTask(task.id, patch), { silent: true }),
    { delay: 600, enabled: open },
  );
  useEffect(() => {
    if (!open) void flush();
  }, [open, flush]);

  const subtasks = useMemo(
    () =>
      task
        ? data.subtasks
            .filter((s) => s.taskId === task.id && s.deletedAt === null)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [data.subtasks, task],
  );
  const project = data.projects.find((p) => p.id === task?.projectId);
  const sourceExperiment = data.experiments.find((e) => e.id === task?.sourceExperimentId);
  const linkedReference = data.references.find((r) => r.id === task?.referenceId && r.deletedAt === null);

  const total = subtasks.length;
  const finished = subtasks.filter((s) => s.done).length;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else
          void flush().then((ok) => {
            if (ok) onOpenChange(false);
          });
      }}
    >
      <DrawerContent
        label="任务详情"
        title={
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 -mx-1 text-section font-semibold outline-none hover:border-line focus:border-brand"
            aria-label="任务标题"
          />
        }
        subtitle={
          <span className="flex items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <span
              role="status"
              className={cn(
                'inline-flex min-h-6 min-w-[7em] items-center text-[13px]',
                saveNote === 'saved' ? 'text-brand-ink' : 'text-ink-2',
              )}
            >
              {saveNote === 'saving'
                ? '正在保存…'
                : saveNote === 'dirty'
                  ? '待保存'
                  : saveNote === 'saved'
                    ? '已保存'
                    : ''}
              {saveNote === 'failed' && (
                <button type="button" className="text-danger underline underline-offset-2" onClick={() => void flush()}>
                  保存失败，点此重试
                </button>
              )}
            </span>
          </span>
        }
        footer={
          <>
            <span className="mr-auto text-aux text-ink-2">更新于 {formatTimestamp(task.updatedAt)}</span>
            <Button
              variant="dangerGhost"
              size="sm"
              onClick={() => {
                void actions.remove(task);
                onOpenChange(false);
              }}
            >
              <Trash2 size={14} aria-hidden />
              移到回收站
            </Button>
            <Button
              variant={task.status === 'done' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void actions.setStatus(task, task.status === 'done' ? 'todo' : 'done')}
            >
              <Check size={14} aria-hidden />
              {task.status === 'done' ? '标为未完成' : '完成任务'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              void flush().then((ok) => {
                if (ok)
                  navigate(
                    aiWorkspaceHref(
                      `task:${task.id}`,
                      '请读取这条任务的说明、状态、日期和已有子任务，帮助拆分为可执行步骤；可添加子任务或调整这条任务的属性。',
                      'task-breakdown',
                    ),
                  );
              })
            }
          >
            <Sparkles size={14} aria-hidden />
            AI 协助
          </Button>
          <section className="flex flex-col gap-2.5">
            <h2 className="text-aux font-semibold text-ink">属性</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="状态">
                {(id) => (
                  <Select
                    id={id}
                    value={task.status}
                    onChange={(e) => void actions.setStatus(task, e.target.value as TaskStatus)}
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {taskStatusLabels[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="优先级">
                {(id) => (
                  <Select
                    id={id}
                    value={task.priority}
                    onChange={(e) => void actions.setPriority(task, e.target.value as typeof task.priority)}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {priorityLabels[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <DateField label="截止日期" value={task.dueDate} onChange={(v) => void actions.setDueDate(task, v)} />

            <Field label="重复">
              {(id) => (
                <Select
                  id={id}
                  value={task.recurrence}
                  onChange={(e) =>
                    void mutate(() => updateTask(task.id, { recurrence: e.target.value as typeof task.recurrence }), {
                      success: '已保存',
                    })
                  }
                >
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {recurrenceLabels[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="所属项目">
              {(id) => (
                <Select
                  id={id}
                  value={task.projectId ?? ''}
                  onChange={(e) =>
                    void mutate(() => updateTask(task.id, { projectId: e.target.value || null }), { success: '已保存' })
                  }
                >
                  <option value="">不关联项目</option>
                  {data.projects
                    .filter((p) => p.deletedAt === null)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>

            {project && (
              <Link
                to={`/projects/${project.id}`}
                className="inline-flex items-center gap-1 self-start text-aux text-brand-ink hover:underline"
              >
                到项目「{project.name}」
                <ArrowUpRight size={13} aria-hidden />
              </Link>
            )}

            {sourceExperiment && (
              <Link
                to={`/experiments/${sourceExperiment.id}`}
                className="flex items-center gap-2 rounded-control border border-info-soft bg-info-soft px-3 py-1.5 text-aux text-info hover:brightness-[0.98]"
              >
                <FlaskConical size={14} aria-hidden />
                <span className="min-w-0 flex-1 truncate">来自实验：{sourceExperiment.title || '未命名实验'}</span>
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            )}

            {linkedReference && (
              <Link
                to={`/library?focus=${linkedReference.id}`}
                className="flex items-center gap-2 rounded-control border border-brand-soft bg-brand-soft px-3 py-1.5 text-aux text-brand-ink hover:brightness-[0.98]"
              >
                <BookMarked size={14} aria-hidden />
                <span className="min-w-0 flex-1 truncate">关联文献：{linkedReference.title || '未命名条目'}</span>
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            )}
          </section>

          <section className="flex flex-col gap-2.5">
            <Field label="描述">
              {(id) => (
                <Textarea
                  id={id}
                  value={description}
                  rows={4}
                  placeholder="判据、参数、注意点"
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                />
              )}
            </Field>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-aux font-semibold text-ink">子任务</h2>
              {total > 0 && (
                <span className="text-aux tabular-nums text-ink-2">
                  {finished}/{total}
                </span>
              )}
            </div>

            {total === 0 ? (
              <p className="text-aux text-ink-2">还没有子任务</p>
            ) : (
              <ul className="overflow-hidden rounded-control border border-line">
                {subtasks.map((s) => (
                  <li
                    key={s.id}
                    className="row-line flex items-center gap-2 bg-surface px-2.5 py-1.5 hover:bg-surface-subtle/70"
                  >
                    <Checkbox
                      checked={s.done}
                      label={`子任务：${s.title}`}
                      onCheckedChange={(v) => void mutate(() => updateSubtask(s.id, { done: v }), { silent: true })}
                    />
                    <button
                      type="button"
                      className={cn(
                        'min-w-0 flex-1 truncate rounded text-left text-body hover:text-brand-ink',
                        s.done && 'text-ink-2 line-through',
                      )}
                      onClick={() => setSubtaskDraft(s.title)}
                    >
                      {s.title}
                    </button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`删除子任务 ${s.title}`}
                      onClick={() => void mutate(() => deleteSubtask(s.id), { silent: true })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="flex gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                const clean = subtaskDraft.trim();
                if (!clean) return;
                await mutate(() => addSubtask(task.id, clean), { silent: true });
                setSubtaskDraft('');
              }}
            >
              <Input
                className="min-w-0"
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                placeholder="加一个子任务"
                aria-label="新增子任务"
              />
              <Button type="submit" variant="secondary" disabled={!subtaskDraft.trim()}>
                <Plus size={15} aria-hidden />
                添加
              </Button>
            </form>
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
