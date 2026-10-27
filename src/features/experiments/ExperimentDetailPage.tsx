import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  Eye,
  FileDown,
  GitCompare,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
  FlaskConical,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownContent,
  MenuRow,
} from '@/components/ui/dropdown';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { SectionNav } from '@/components/shared/section-nav';
import { DateField } from '@/components/shared/date-field';
import { TagEditor } from '@/components/shared/tag-editor';
import { ExperimentStatusBadge } from '@/components/shared/status-badges';
import { cn } from '@/lib/cx';
import { useData } from '@/state/DataContext';
import { usePrefs } from '@/lib/prefs';
import { deleteExperiment, duplicateExperiment, setEntityTags, updateExperiment } from '@/data/repo';
import { entityTags } from '@/domain/progress';
import {
  EXPERIMENT_STATUSES,
  experimentStatusLabels,
  type DataSource,
  type Experiment,
  type ExperimentStatus,
} from '@/domain/types';
import { createId } from '@/lib/id';
import { formatTimestamp, localToday } from '@/domain/date';
import { renderMarkdown } from '@/lib/markdown';
import { downloadTextFile, safeFileName } from '@/lib/download';
import { fileToImageMarkdown, insertImageAtCursor } from '@/lib/imagePaste';
import { experimentToMarkdown } from './export';
import { SourceDiffDialog } from './SourceDiffDialog';
import { useDebouncedSave } from '@/lib/useDebouncedSave';
import { useToast } from '@/components/ui/toast';
import { TaskFormDialog, emptyTaskDraft } from '@/features/tasks/TaskFormDialog';
import { NotFoundPage } from '@/features/NotFoundPage';
import { aiWorkspaceHref } from '@/features/ai/context';

type Draft = Omit<Experiment, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'isDemo' | 'sourceExperimentId'>;

/** 能贴截图的正文段落（都是纯文本字段）。 */
type TextKey = 'purpose' | 'hypothesis' | 'method' | 'results' | 'observations' | 'conclusion' | 'nextStep';

const toDraft = (e: Experiment): Draft => ({
  title: e.title,
  experimentDate: e.experimentDate,
  projectId: e.projectId,
  status: e.status,
  purpose: e.purpose,
  hypothesis: e.hypothesis,
  dataSources: e.dataSources,
  method: e.method,
  results: e.results,
  observations: e.observations,
  conclusion: e.conclusion,
  nextStep: e.nextStep,
  repoUrl: e.repoUrl,
  commit: e.commit,
});

const SOURCE_KINDS: { value: DataSource['kind']; label: string }[] = [
  { value: 'model', label: '模型' },
  { value: 'param', label: '超参数' },
  { value: 'metric', label: '指标' },
  { value: 'path', label: '本地路径' },
  { value: 'version', label: '数据版本' },
  { value: 'link', label: '来源链接' },
  { value: 'other', label: '其他' },
];

/** 统一的区块头：14px 标题 + 右侧动作 + 下边框。 */
function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="panel-head flex-wrap">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {action}
    </header>
  );
}

export function ExperimentDetailPage() {
  const { experimentId = '' } = useParams();
  const { data } = useData();
  const experiment = data.experiments.find((e) => e.id === experimentId);
  if (!experiment || experiment.deletedAt !== null)
    return <NotFoundPage what="实验记录" backTo="/experiments" backLabel="回到实验记录" />;
  // 记录身份变化时先卸载旧编辑器并提交待保存内容，新记录从自己的草稿初始化。
  return <ExperimentEditor key={experiment.id} experiment={experiment} />;
}

function ExperimentEditor({ experiment }: { experiment: Experiment }) {
  const { data, mutate } = useData();
  const prefs = usePrefs();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(experiment));
  const [tags, setTags] = useState<string[]>(() => entityTags(data, 'experiment', experiment.id));
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const save = useMemo(
    () => async (values: Draft) => {
      return mutate(() => updateExperiment(experiment.id, values), { silent: true });
    },
    [experiment, mutate],
  );

  const { state: saveState, flush } = useDebouncedSave(draft, save, {
    enabled: prefs.autoSave,
  });

  const project = data.projects.find((p) => p.id === draft.projectId);
  const source = data.experiments.find((e) => e.id === experiment.sourceExperimentId);
  const linkedTasks = data.tasks.filter((t) => t.deletedAt === null && t.sourceExperimentId === experiment.id);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // 正文里粘贴截图：压缩成 data URL 插进光标处，随这条实验一起保存与备份
  const pasteInto = (key: TextKey) => async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...(e.clipboardData?.items ?? [])]
      .map((item) => item.getAsFile())
      .find((f) => f && f.type.startsWith('image/'));
    if (!file || !draft) return;
    e.preventDefault();
    const target = e.currentTarget;
    const markdown = await fileToImageMarkdown(file, `截图 ${localToday()}`);
    if (!markdown) {
      toast({
        title: '图片没能收进来',
        description: '压缩后仍超过 1MB，换小一点的截图，或把文件路径记在来源里',
        tone: 'error',
      });
      return;
    }
    const at = target.selectionStart ?? draft[key].length;
    const { text, cursor } = insertImageAtCursor(draft[key], markdown, at);
    set(key, text);
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.setSelectionRange(cursor, cursor);
    });
  };

  const saveTags = async (next: string[]) => {
    setTags(next);
    const ok = await mutate(() => setEntityTags('experiment', experiment.id, next), { silent: true });
    if (!ok) setTags(entityTags(data, 'experiment', experiment.id));
  };

  const exportMarkdown = async () => {
    if (!(await flush())) return;
    downloadTextFile(
      `${safeFileName(draft.title || '实验记录')}.md`,
      experimentToMarkdown({ ...experiment, ...draft }, data),
    );
  };

  const copyExperiment = async () => {
    if (!(await flush())) return;
    let newId = '';
    await mutate(
      async () => {
        const created = await duplicateExperiment({ ...experiment, ...draft });
        newId = created.id;
      },
      { success: '已复制为新实验' },
    );
    if (newId) navigate(`/experiments/${newId}`);
  };

  const statusText =
    saveState === 'saving'
      ? { label: '正在保存…', cls: 'text-ink-2' }
      : saveState === 'saved'
        ? { label: '已保存', cls: 'text-brand-ink' }
        : saveState === 'failed'
          ? { label: '保存失败', cls: 'text-danger' }
          : saveState === 'dirty'
            ? { label: '有未保存的改动', cls: 'text-warning' }
            : { label: `更新于 ${formatTimestamp(experiment.updatedAt)}`, cls: 'text-ink-2' };

  const isEmptyRecord =
    !draft.purpose.trim() &&
    !draft.hypothesis.trim() &&
    !draft.method.trim() &&
    !draft.results.trim() &&
    !draft.observations.trim() &&
    !draft.conclusion.trim() &&
    !draft.nextStep.trim();

  return (
    <div className="experiment-editor flex flex-col gap-3.5">
      <Link
        to="/experiments"
        className="inline-flex w-fit items-center gap-1.5 text-aux text-ink-2 hover:text-brand-ink"
      >
        <ArrowLeft size={13} aria-hidden />
        实验记录
      </Link>

      <div className="page-head">
        {preview ? (
          <h2 className="page-title min-w-0 flex-1">
            <span className="min-w-0 truncate">{draft.title || '未命名实验'}</span>
          </h2>
        ) : (
          <h2 className="page-title min-w-0 flex-1">
            <input
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="例如：台架基线：静息与最大自主收缩"
              aria-label="实验标题"
              className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-1 text-ink placeholder:text-ink-2/60"
            />
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void flush().then((ok) => {
                if (ok)
                  navigate(
                    aiWorkspaceHref(
                      `experiment:${experiment.id}`,
                      '请读取这条实验的目的、方法、来源与结果，区分观察和推断，提出下一次验证步骤。可将建议追加到实验记录或创建后续任务。',
                      'experiment-review',
                    ),
                  );
              })
            }
          >
            <Sparkles size={14} aria-hidden />
            AI 协助
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
            {preview ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            {preview ? '继续编辑' : '预览'}
          </Button>
          {!prefs.autoSave && (
            <Button variant="primary" size="sm" onClick={() => void flush()}>
              <Check size={14} aria-hidden />
              保存
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="iconSm" aria-label="更多操作">
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownContent>
              <MenuRow icon={<Eye size={14} />} onSelect={() => window.dispatchEvent(new Event('rw:focus-mode'))}>
                进入沉浸模式
              </MenuRow>
              <MenuRow icon={<FileDown size={14} />} onSelect={() => void exportMarkdown()}>
                导出 Markdown
              </MenuRow>
              <MenuRow icon={<Copy size={14} />} onSelect={() => void copyExperiment()}>
                复制为新实验
              </MenuRow>
              {source && (
                <MenuRow icon={<GitCompare size={14} />} onSelect={() => setDiffOpen(true)}>
                  与来源对比
                </MenuRow>
              )}
              <DropdownMenuSeparator />
              <MenuRow icon={<Trash2 size={14} />} danger onSelect={() => setConfirmDelete(true)}>
                移到回收站
              </MenuRow>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="page-toolbar text-aux text-ink-2">
        <ExperimentStatusBadge status={draft.status} />
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <CalendarDays size={13} aria-hidden />
          {draft.experimentDate}
        </span>
        {project && (
          <Link
            to={`/projects/${project.id}`}
            className="inline-block max-w-[220px] truncate hover:text-brand-ink"
            title={project.name}
          >
            {project.name}
          </Link>
        )}
        {source && (
          <Link
            to={`/experiments/${source.id}`}
            className="flex max-w-[220px] items-center gap-1.5 hover:text-brand-ink"
            title={source.title}
          >
            <Link2 size={13} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate">复制自：{source.title || '未命名实验'}</span>
          </Link>
        )}
        <span className="tabular-nums">创建 {formatTimestamp(experiment.createdAt)}</span>
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'ml-auto inline-flex min-h-6 min-w-[12em] items-center justify-end text-right text-[13px]',
            statusText.cls,
          )}
        >
          {saveState === 'failed' ? (
            <button type="button" className="underline underline-offset-2" onClick={() => void flush()}>
              保存失败，点此重试
            </button>
          ) : (
            statusText.label
          )}
        </span>
      </div>

      <div className="experiment-document-layout">
        <SectionNav
          className="experiment-outline"
          label="实验目录"
          items={
            preview
              ? [
                  { id: 'experiment-question', label: '研究目的', text: draft.purpose },
                  { id: 'experiment-hypothesis', label: '假设', text: draft.hypothesis },
                  { id: 'experiment-sources', label: '数据来源', text: draft.dataSources.map((s) => s.label).join('') },
                  { id: 'experiment-method', label: '方法与步骤', text: draft.method },
                  { id: 'experiment-results', label: '结果', text: draft.results },
                  { id: 'experiment-observations', label: '观察与异常', text: draft.observations },
                  { id: 'experiment-conclusion', label: '结论', text: draft.conclusion },
                  { id: 'experiment-next', label: '下一步', text: draft.nextStep },
                ].filter((s) => s.text.trim())
              : [
                  { id: 'experiment-info', label: '实验信息' },
                  { id: 'experiment-question', label: '目的与假设' },
                  { id: 'experiment-sources', label: '数据来源' },
                  { id: 'experiment-method', label: '方法与步骤' },
                  { id: 'experiment-results', label: '结果与观察' },
                  { id: 'experiment-conclusion', label: '结论与下一步' },
                ]
          }
        />
        {preview ? (
          <article className="experiment-paper experiment-preview panel px-5 py-4">
            {tags.length > 0 && (
              <p className="mb-4 flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}
                  </Badge>
                ))}
              </p>
            )}
            <div className="flex flex-col gap-5">
              {(
                [
                  ['研究目的', draft.purpose],
                  ['假设', draft.hypothesis],
                  [
                    '数据或样本来源',
                    draft.dataSources
                      .map((d) => `- ${SOURCE_KINDS.find((k) => k.value === d.kind)?.label}：${d.label}`)
                      .join('\n'),
                  ],
                  ['方法与步骤', draft.method],
                  ['结果', draft.results],
                  ['观察与异常', draft.observations],
                  ['结论', draft.conclusion],
                  ['下一步', draft.nextStep],
                ] as const
              )
                .filter(([, text]) => text.trim())
                .map(([label, text]) => (
                  <section
                    key={label}
                    id={
                      'experiment-' +
                      {
                        研究目的: 'question',
                        假设: 'hypothesis',
                        数据或样本来源: 'sources',
                        方法与步骤: 'method',
                        结果: 'results',
                        观察与异常: 'observations',
                        结论: 'conclusion',
                        下一步: 'next',
                      }[label]
                    }
                  >
                    <h3 className="mb-1.5 text-[14px] font-semibold">{label}</h3>
                    <div className="prose-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
                  </section>
                ))}
              {(draft.repoUrl || draft.commit) && (
                <section>
                  <h3 className="mb-1.5 text-[14px] font-semibold">代码</h3>
                  <p className="text-body text-ink-2">
                    {draft.repoUrl || '未填仓库'}
                    {draft.commit && <span className="ml-2 font-mono text-aux">{draft.commit}</span>}
                  </p>
                </section>
              )}
              {isEmptyRecord && <p className="text-body text-ink-2">这条记录还是空的</p>}
            </div>
          </article>
        ) : (
          <div className="experiment-paper experiment-fields flex min-w-0 flex-col gap-3.5">
            <section id="experiment-info" className="panel overflow-hidden">
              <SectionHead title="实验信息" />
              <div className="flex flex-col gap-3.5 px-4 py-3.5">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <DateField
                    label="实验日期"
                    clearable={false}
                    value={draft.experimentDate}
                    quick={false}
                    onChange={(v) => set('experimentDate', v ?? localToday())}
                  />
                  <Field label="记录状态">
                    {(id) => (
                      <Select
                        id={id}
                        value={draft.status}
                        onChange={(e) => set('status', e.target.value as ExperimentStatus)}
                      >
                        {EXPERIMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {experimentStatusLabels[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Field label="所属项目">
                  {(id) => (
                    <Select
                      id={id}
                      value={draft.projectId ?? ''}
                      onChange={(e) => set('projectId', e.target.value || null)}
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
                <Field label="标签">
                  {(id) => <TagEditor key={id} value={tags} onChange={(next) => void saveTags(next)} />}
                </Field>
              </div>
            </section>

            <section id="experiment-question" className="panel overflow-hidden">
              <SectionHead title="研究目的与假设" />
              <div className="flex flex-col gap-3.5 px-4 py-3.5">
                <Field label="目的">
                  {(id) => (
                    <Textarea
                      id={id}
                      value={draft.purpose}
                      onChange={(e) => set('purpose', e.target.value)}
                      onPaste={(e) => void pasteInto('purpose')(e)}
                    />
                  )}
                </Field>
                <Field label="假设">
                  {(id) => (
                    <Textarea
                      id={id}
                      value={draft.hypothesis}
                      onChange={(e) => set('hypothesis', e.target.value)}
                      onPaste={(e) => void pasteInto('hypothesis')(e)}
                    />
                  )}
                </Field>
              </div>
            </section>

            <section id="experiment-sources" className="panel overflow-hidden">
              <SectionHead
                title="数据或样本来源"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      set('dataSources', [...draft.dataSources, { id: createId(), kind: 'path', label: '' }])
                    }
                  >
                    <Plus size={14} aria-hidden />
                    加一行
                  </Button>
                }
              />
              <div className="flex flex-col gap-2 px-4 py-3.5">
                {draft.dataSources.length === 0 && <p className="py-1 text-aux text-ink-2">还没有记录来源</p>}
                <ul className="flex flex-col gap-2">
                  {draft.dataSources.map((row) => (
                    <li key={row.id} className="flex items-center gap-2">
                      <span className="sr-only">来源类型</span>
                      <Select
                        aria-label="来源类型"
                        value={row.kind}
                        className="w-[110px] shrink-0"
                        onChange={(e) =>
                          set(
                            'dataSources',
                            draft.dataSources.map((d) =>
                              d.id === row.id ? { ...d, kind: e.target.value as DataSource['kind'] } : d,
                            ),
                          )
                        }
                      >
                        {SOURCE_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </Select>
                      <Input
                        aria-label="来源内容"
                        className="min-w-0"
                        value={row.label}
                        placeholder="D:/data/squeeze/batch01/ 或 raw-v1"
                        onChange={(e) =>
                          set(
                            'dataSources',
                            draft.dataSources.map((d) => (d.id === row.id ? { ...d, label: e.target.value } : d)),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label="删除这一行来源"
                        onClick={() =>
                          set(
                            'dataSources',
                            draft.dataSources.filter((d) => d.id !== row.id),
                          )
                        }
                      >
                        <X size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="experiment-method" className="panel overflow-hidden">
              <SectionHead title="方法与步骤" />
              <div className="flex flex-col gap-3.5 px-4 py-3.5">
                <Textarea
                  aria-label="方法与步骤"
                  className="min-h-[150px] font-mono text-[15px] max-sm:text-[16px]"
                  value={draft.method}
                  placeholder={
                    '1. 贴 8 通道电极，静息坐位 60s\n2. 采样率 1kHz，带通 20–450Hz\n\n关键参数：阈值 12µV，窗长 200ms'
                  }
                  onChange={(e) => set('method', e.target.value)}
                  onPaste={(e) => void pasteInto('method')(e)}
                />
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="代码仓库">
                    {(id) => (
                      <Input
                        id={id}
                        value={draft.repoUrl}
                        placeholder="内网仓库地址"
                        onChange={(e) => set('repoUrl', e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="commit">
                    {(id) => (
                      <Input
                        id={id}
                        value={draft.commit}
                        placeholder="a19c3f2"
                        className="font-mono"
                        onChange={(e) => set('commit', e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              </div>
            </section>

            <section id="experiment-results" className="panel overflow-hidden">
              <SectionHead title="结果、观察与异常" />
              <div className="flex flex-col gap-3.5 px-4 py-3.5">
                <Field label="结果">
                  {(id) => (
                    <Textarea
                      id={id}
                      className="min-h-[110px]"
                      value={draft.results}
                      onChange={(e) => set('results', e.target.value)}
                      onPaste={(e) => void pasteInto('results')(e)}
                    />
                  )}
                </Field>
                <Field label="观察与异常">
                  {(id) => (
                    <Textarea
                      id={id}
                      className="min-h-[110px]"
                      value={draft.observations}
                      onChange={(e) => set('observations', e.target.value)}
                      onPaste={(e) => void pasteInto('observations')(e)}
                    />
                  )}
                </Field>
              </div>
            </section>

            <section id="experiment-conclusion" className="panel overflow-hidden">
              <SectionHead title="结论与下一步" />
              <div className="flex flex-col gap-3.5 px-4 py-3.5">
                <Field label="结论">
                  {(id) => (
                    <Textarea
                      id={id}
                      value={draft.conclusion}
                      onChange={(e) => set('conclusion', e.target.value)}
                      onPaste={(e) => void pasteInto('conclusion')(e)}
                    />
                  )}
                </Field>
                <Field label="下一步">
                  {(id) => (
                    <Textarea
                      id={id}
                      rows={2}
                      value={draft.nextStep}
                      onChange={(e) => set('nextStep', e.target.value)}
                      onPaste={(e) => void pasteInto('nextStep')(e)}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!draft.nextStep.trim()}
                    onClick={() => setTaskOpen(true)}
                  >
                    <Check size={14} aria-hidden />
                    把下一步变成任务
                  </Button>
                </div>

                {linkedTasks.length > 0 && (
                  <ul className="flex flex-col gap-1 border-t border-line pt-3">
                    {linkedTasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-aux">
                        <FlaskConical size={12} className="text-ink-2" aria-hidden />
                        <Link
                          to={`/tasks?focus=${t.id}`}
                          className="min-w-0 flex-1 truncate hover:text-brand-ink hover:underline"
                        >
                          {t.title}
                        </Link>
                        <Badge tone={t.status === 'done' ? 'brand' : 'muted'}>
                          {t.status === 'done'
                            ? '已完成'
                            : t.status === 'doing'
                              ? '进行中'
                              : t.status === 'cancelled'
                                ? '已取消'
                                : '待办'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {draft.dataSources.length === 0 && isEmptyRecord && !preview && (
        <p className="py-2 text-center text-aux text-ink-2 lg:hidden">这条记录还是空的</p>
      )}

      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        draft={emptyTaskDraft({
          title: draft.nextStep.trim().slice(0, 120),
          projectId: draft.projectId,
          sourceExperimentId: experiment.id,
          dueDate: null,
        })}
        onSaved={() => {
          setTaskOpen(false);
        }}
      />

      {source && <SourceDiffDialog open={diffOpen} onOpenChange={setDiffOpen} source={source} current={experiment} />}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        danger
        title="把这条实验记录移到回收站？"
        confirmLabel="移到回收站"
        body={<p>任务不受影响。</p>}
        onConfirm={async () => {
          const ok = await mutate(() => deleteExperiment(experiment.id), { success: '已移到回收站' });
          if (ok) navigate('/experiments');
        }}
      />
    </div>
  );
}
