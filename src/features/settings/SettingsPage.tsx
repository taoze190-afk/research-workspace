import { useMemo, useRef, useState } from 'react';
import { SectionNav } from '@/components/shared/section-nav';
import { PageHeader } from '@/components/shared/page-header';
import {
  Download,
  RotateCcw,
  Trash2,
  Upload,
  HardDriveDownload,
  SlidersHorizontal,
  Database,
  HardDrive,
  Sparkles,
  Tag,
  UserRoundCog,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { useData } from '@/state/DataContext';
import { useAuth } from '@/state/AuthContext.tsx';
import { flush, pull, useSyncState } from '@/data/sync.ts';
import { api } from '@/data/api.ts';
import { usePrefs, setPrefs } from '@/lib/prefs';
import {
  backupFileName,
  buildBackup,
  downloadJson,
  parseBackupJson,
  planImport,
  applyImport,
  type BackupFile,
  type ImportMode,
  type ImportPlan,
} from '@/lib/backup';

import { emptyRecycleBin, purge, restore, clearDemoData, loadDataset } from '@/data/repo';
import { loadDemoData } from '@/data/demo';
import { entityTypeLabels } from '@/domain/search';
import { formatTimestamp } from '@/domain/date';
import { cn } from '@/lib/cx';
import { useToast } from '@/components/ui/toast';
import { TagManager } from './TagManager';
import { Link } from 'react-router-dom';
import { AiSection } from './AiSection';
import type { Dataset, EntityType } from '@/domain/types';

interface RecycleRow {
  entityType: EntityType;
  id: string;
  title: string;
  deletedAt: number;
}

interface AnyRow {
  id: string;
  deletedAt: number | null;
  isDemo?: boolean;
}

const allRows = (data: Dataset): AnyRow[] => (Object.values(data) as unknown as AnyRow[][]).flat();
const liveCount = (data: Dataset) => allRows(data).filter((r) => r.deletedAt === null).length;
const demoCountOf = (data: Dataset) => allRows(data).filter((r) => r.isDemo).length;

export function SettingsPage() {
  const { data, mutate, refresh } = useData();
  const prefs = usePrefs();
  const auth = useAuth();
  const sync = useSyncState();
  const server = auth.phase === 'signed-in';
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<{
    file: BackupFile;
    plan: ImportPlan;
    mode: ImportMode;
    fileName: string;
  } | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmClearDemo, setConfirmClearDemo] = useState(false);
  const [busy, setBusy] = useState(false);

  const demoCount = useMemo(() => demoCountOf(data), [data]);

  const recycle: RecycleRow[] = useMemo(() => {
    const rows: RecycleRow[] = [];
    const push = (
      entityType: EntityType,
      list: { id: string; title?: string; name?: string; deletedAt: number | null }[],
    ) => {
      for (const r of list)
        if (r.deletedAt !== null)
          rows.push({ entityType, id: r.id, title: r.title || r.name || '未命名', deletedAt: r.deletedAt });
    };
    push('project', data.projects as never);
    push('task', data.tasks as never);
    push('experiment', data.experiments as never);
    push('reference', data.references as never);
    return rows.sort((a, b) => b.deletedAt - a.deletedAt);
  }, [data]);

  const exportBackup = () => {
    const file = buildBackup(data, prefs);
    downloadJson(backupFileName(), JSON.stringify(file, null, 2));
    setPrefs({ lastBackupAt: Date.now() });
    toast({ title: '已导出备份', tone: 'success' });
  };

  // 本地模式才需要人肉提醒备份；服务器模式数据在服务器侧，由 scripts/backup-server.mjs 负责
  const backupDays = prefs.lastBackupAt === null ? null : Math.floor((Date.now() - prefs.lastBackupAt) / 86400000);
  const backupHint = !server
    ? prefs.lastBackupAt === null
      ? '还没有导出过备份'
      : backupDays !== null && backupDays >= 30
        ? `距上次导出已超过 ${backupDays} 天`
        : null
    : null;

  const chooseFile = async (file: File, mode: ImportMode) => {
    setBusy(true);
    const text = await file.text();
    const parsed = parseBackupJson(text);
    if (!parsed.ok || !parsed.file) {
      setParseErrors(parsed.errors);
      setImportPreview(null);
      setBusy(false);
      return;
    }
    const current = await loadDataset();
    const plan = planImport(parsed.file, current, mode);
    setParseErrors([]);
    setImportPreview({ file: parsed.file, plan, mode, fileName: file.name });
    setBusy(false);
  };

  const replan = async (mode: ImportMode) => {
    if (!importPreview) return;
    const current = await loadDataset();
    setImportPreview({ ...importPreview, mode, plan: planImport(importPreview.file, current, mode) });
  };

  const doImport = async () => {
    if (!importPreview) return;
    setBusy(true);
    // 服务器模式下让后端在一条事务里整体替换/合并，比把每一行的增删都排队上传更稳
    if (server) {
      try {
        await api.importBackup(importPreview.mode, importPreview.plan.incoming);
        await pull({ replace: true });
        await refresh();
        setBusy(false);
        setImportPreview(null);
        if (fileRef.current) fileRef.current.value = '';
        toast({
          title: importPreview.mode === 'replace' ? '已按备份替换' : '已合并导入',
          description:
            importPreview.mode === 'replace'
              ? `写入 ${importPreview.plan.toAdd} 条记录。`
              : `新增 ${importPreview.plan.toAdd} 条，更新 ${importPreview.plan.toUpdate} 条。`,
          tone: 'success',
        });
      } catch (error) {
        setBusy(false);
        toast({ title: '导入失败', description: (error as Error).message, tone: 'error', duration: 9000 });
      }
      return;
    }
    const ok = await mutate(
      async () => {
        const outcome = await applyImport(importPreview.file, importPreview.plan);
        return outcome;
      },
      { silent: true },
    );
    setBusy(false);
    if (!ok) {
      toast({ title: '导入失败，已回滚', tone: 'error', duration: 8000 });
      return;
    }
    const { plan } = importPreview;
    toast({
      title: plan.mode === 'replace' ? '已按备份替换' : '已合并导入',
      description:
        plan.mode === 'replace'
          ? `写入 ${plan.toAdd} 条记录，原有数据已被替换。`
          : `新增 ${plan.toAdd} 条，更新 ${plan.toUpdate} 条，跳过 ${plan.unchanged} 条。`,
      tone: 'success',
    });
    setImportPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="settings-page flex flex-col gap-5">
      <PageHeader title="设置" />
      <div className="settings-workspace">
        <SectionNav
          className="settings-nav"
          label="设置分区"
          items={[
            { id: 'settings-appearance', label: '界面偏好' },
            { id: 'settings-sync', label: '数据同步' },
            { id: 'settings-ai', label: 'AI 服务' },
            { id: 'settings-tags', label: '标签管理' },
            { id: 'settings-backup', label: '备份导入' },
            { id: 'settings-recycle', label: '回收站' },
          ]}
        />
        <div className="settings-sections">
          <section id="settings-appearance" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <SlidersHorizontal size={15} className="section-icon" aria-hidden />
                界面偏好
              </h3>
            </header>
            <div className="divide-y divide-line">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <label htmlFor="pref-theme" className="text-body">
                  界面主题
                </label>
                <Select
                  id="pref-theme"
                  className="w-[132px]"
                  value={prefs.theme}
                  onChange={(e) => setPrefs({ theme: e.target.value as 'system' | 'light' | 'dark' })}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </Select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <label htmlFor="pref-bgstyle" className="text-body">
                  页面背景
                </label>
                <div className="seg" role="group" aria-label="页面背景样式">
                  {(
                    [
                      ['nebula', '星云'],
                      ['glass', '透明'],
                      ['plain', '纯净'],
                      ['dots', '网格点'],
                      ['grid', '网格线'],
                      ['aurora', '极光'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={(prefs.bgStyle ?? 'plain') === value}
                      onClick={() => setPrefs({ bgStyle: value })}
                      className="inline-flex h-8 items-center px-3 text-aux"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(
                [
                  ['导航栏默认收起', prefs.navCollapsed, (v: boolean) => setPrefs({ navCollapsed: v })],
                  ['自动保存实验编辑内容', prefs.autoSave, (v: boolean) => setPrefs({ autoSave: v })],
                ] as const
              ).map(([label, value, onChange]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-body">{label}</span>
                  <Switch checked={value} onCheckedChange={onChange} label={label} />
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <label htmlFor="pref-task-view" className="text-body">
                  任务页默认视图
                </label>
                <Select
                  id="pref-task-view"
                  className="w-[132px]"
                  value={prefs.taskView}
                  onChange={(e) => setPrefs({ taskView: e.target.value as 'list' | 'board' | 'calendar' })}
                >
                  <option value="list">列表</option>
                  <option value="board">看板</option>
                  <option value="calendar">日历</option>
                </Select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <label htmlFor="pref-project-view" className="text-body">
                  项目页默认显示
                </label>
                <Select
                  id="pref-project-view"
                  className="w-[132px]"
                  value={prefs.projectView}
                  onChange={(e) => setPrefs({ projectView: e.target.value as 'list' | 'card' })}
                >
                  <option value="card">卡片</option>
                  <option value="list">列表</option>
                </Select>
              </div>
            </div>
          </section>

          <section id="settings-sync" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <Database size={15} className="section-icon" aria-hidden />
                数据与同步
              </h3>
            </header>
            <dl className="divide-y divide-line text-body">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <dt className="text-ink-2">运行模式</dt>
                <dd>{server ? '自建服务器' : '本机浏览器'}</dd>
              </div>
              {server ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <dt className="text-ink-2">当前账号</dt>
                  <dd className="min-w-0 truncate" title={auth.user?.email}>
                    {auth.user?.email ?? '—'}
                  </dd>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <dt className="text-ink-2">当前记录</dt>
                <dd className="text-right tabular-nums text-ink-2">
                  {data.projects.filter((p) => !p.deletedAt).length} 项目 ·{' '}
                  {data.tasks.filter((t) => !t.deletedAt).length} 任务 ·{' '}
                  {data.experiments.filter((e) => !e.deletedAt).length} 实验 ·{' '}
                  {data.references.filter((r) => !r.deletedAt).length} 文献
                </dd>
              </div>
              {server ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <dt className="text-ink-2">同步</dt>
                  <dd className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-aux',
                        sync.pending > 0 ? 'text-warning' : sync.lastError ? 'text-danger' : 'text-ink-2',
                      )}
                      role="status"
                    >
                      {sync.pending > 0
                        ? `${sync.pending} 条待同步`
                        : sync.lastError
                          ? `上传失败：${sync.lastError}`
                          : '已同步'}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        await flush();
                        await refresh();
                      }}
                    >
                      立即同步
                    </Button>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section id="settings-ai" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <Bot size={15} className="section-icon" aria-hidden />
                AI 服务
              </h3>
            </header>
            <AiSection />
          </section>

          {server && (
            <section className="panel overflow-hidden">
              <header className="panel-head">
                <h3 className="section-title section-heading text-[14px]">
                  <UserRoundCog size={15} className="section-icon" aria-hidden />
                  账号
                </h3>
              </header>
              <Link to="/account" className="block px-4 py-4 text-aux text-brand hover:bg-surface-subtle">
                个人资料、密码与登录设备 →
              </Link>
            </section>
          )}

          <section id="settings-tags" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <Tag size={15} className="section-icon" aria-hidden />
                标签
                {data.tags.filter((t) => t.deletedAt === null).length > 0 && (
                  <span className="page-count tabular-nums">
                    {data.tags.filter((t) => t.deletedAt === null).length}
                  </span>
                )}
              </h3>
            </header>
            <TagManager />
          </section>

          <section id="settings-backup" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <HardDrive size={15} className="section-icon" aria-hidden />
                备份与导入
              </h3>
            </header>
            <div className="flex flex-col gap-3 px-3.5 py-3">
              <div className="page-toolbar">
                <Button variant="primary" onClick={exportBackup}>
                  <Download size={15} aria-hidden />
                  导出记录备份
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  aria-label="选择备份文件"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void chooseFile(file, 'merge');
                  }}
                />
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                  <Upload size={15} aria-hidden />
                  选择备份文件
                </Button>
              </div>

              <p className="text-aux text-ink-2">仅含研究记录与界面偏好；科研文件请在文件库下载。</p>

              {!server && backupHint && (
                <p className="text-aux text-warning" role="status">
                  {backupHint}
                </p>
              )}

              {parseErrors.length > 0 && (
                <div className="rounded-control border border-danger-soft bg-danger-soft px-3 py-2" role="alert">
                  <p className="text-aux font-medium text-danger">文件未通过检查：</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-aux text-danger">
                    {parseErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {importPreview && (
                <div className="rounded-panel border border-line bg-surface-subtle/60 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <HardDriveDownload size={15} className="text-ink-2" aria-hidden />
                    <span className="text-body font-medium">{importPreview.fileName}</span>

                    <span className="text-aux text-ink-2">
                      导出于 {formatTimestamp(new Date(importPreview.file.exportedAt).getTime())}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="导入方式">
                    {(
                      [
                        ['merge', '合并'],
                        ['replace', '替换全部'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={importPreview.mode === mode}
                        onClick={() => void replan(mode)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-aux transition-colors duration-150',
                          importPreview.mode === mode
                            ? 'border-brand bg-brand-soft font-medium text-brand-ink'
                            : 'border-line text-ink-2 hover:bg-surface',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {importPreview.mode === 'merge' ? (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-aux text-ink-2">
                      <li>新增 {importPreview.plan.toAdd} 条</li>
                      <li>更新 {importPreview.plan.toUpdate} 条</li>
                      <li>保留 {importPreview.plan.unchanged} 条</li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-aux text-warning">将先清空本地 {liveCount(data)} 条记录，不可撤销。</p>
                  )}

                  {importPreview.plan.detachWarnings.length > 0 && (
                    <ul
                      className="mt-2 flex flex-col gap-0.5 rounded-control border border-warning-soft bg-warning-soft px-3 py-2 text-aux text-warning"
                      role="status"
                    >
                      {importPreview.plan.detachWarnings.slice(0, 4).map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                      {importPreview.plan.detachWarnings.length > 4 && (
                        <li>另有 {importPreview.plan.detachWarnings.length - 4} 处</li>
                      )}
                    </ul>
                  )}

                  {importPreview.plan.blockers.length > 0 && (
                    <div
                      className="mt-2 rounded-control border border-danger-soft bg-danger-soft px-3 py-2 text-aux text-danger"
                      role="alert"
                    >
                      {importPreview.plan.blockers.map((b) => (
                        <p key={b} className="whitespace-pre-wrap">
                          {b}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setImportPreview(null)}>
                      取消
                    </Button>
                    <Button
                      variant={importPreview.mode === 'replace' ? 'danger' : 'primary'}
                      size="sm"
                      disabled={importPreview.plan.blockers.length > 0 || busy}
                      onClick={() => void doImport()}
                    >
                      {busy ? '正在处理…' : importPreview.mode === 'replace' ? '确认替换' : '确认导入'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section id="settings-recycle" className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <Trash2 size={15} className="section-icon" aria-hidden />
                回收站
                {recycle.length > 0 && <span className="page-count tabular-nums">{recycle.length}</span>}
              </h3>
              {recycle.length > 0 && (
                <Button variant="dangerGhost" size="sm" onClick={() => setConfirmEmpty(true)}>
                  清空回收站
                </Button>
              )}
            </header>
            {recycle.length === 0 ? (
              <p className="px-3.5 py-3 text-aux text-ink-2">回收站是空的</p>
            ) : (
              <ul className="divide-y divide-line">
                {recycle.map((row) => (
                  <li
                    key={`${row.entityType}-${row.id}`}
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-3 sm:flex-nowrap"
                  >
                    <div className="flex w-full min-w-0 items-start gap-2.5 sm:w-auto sm:flex-1 sm:items-center">
                      <Badge tone="muted">{entityTypeLabels[row.entityType]}</Badge>
                      <span className="min-w-0 flex-1 break-words text-body sm:truncate" title={row.title}>
                        {row.title}
                      </span>
                    </div>
                    <span className="mr-auto shrink-0 text-[13px] tabular-nums text-ink-2">
                      {formatTimestamp(row.deletedAt)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void mutate(() => restore(row.entityType, row.id), { success: '已恢复' })}
                    >
                      <RotateCcw size={13} aria-hidden />
                      恢复
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`彻底删除「${row.title}」`}
                      onClick={() => void mutate(() => purge(row.entityType, row.id), { success: '已彻底删除' })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel overflow-hidden">
            <header className="panel-head">
              <h3 className="section-title section-heading text-[14px]">
                <Sparkles size={15} className="section-icon" aria-hidden />
                演示数据
              </h3>
            </header>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
              <span className="text-body text-ink-2">
                {demoCount === 0 ? '库里现在没有演示数据' : `${demoCount} 条演示记录`}
              </span>
              {demoCount === 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await mutate(async () => await loadDemoData(), { silent: true });
                    toast({ title: '示例数据已载入', tone: 'success' });
                  }}
                >
                  载入一次示例
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setConfirmClearDemo(true)}>
                  清除演示数据
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        danger
        title="清空回收站？"
        confirmLabel="全部彻底删除"
        body={<p>彻底删除 {recycle.length} 条记录，不可恢复。</p>}
        onConfirm={() => void mutate(() => emptyRecycleBin(), { success: '回收站已清空' })}
      />
      <ConfirmDialog
        open={confirmClearDemo}
        onOpenChange={setConfirmClearDemo}
        danger
        title="清除全部演示数据？"
        confirmLabel="只删演示记录"
        body={<p>只删 {demoCount} 条演示记录，不可恢复。</p>}
        onConfirm={async () => {
          if (server) {
            try {
              await api.clearDemo();
              await pull({ replace: true });
              await refresh();
              toast({ title: '演示数据已清除', tone: 'success' });
            } catch (error) {
              toast({ title: '清除失败', description: (error as Error).message, tone: 'error' });
              return;
            }
          } else {
            await mutate(() => clearDemoData(), { success: '演示数据已清除' });
          }
          setPrefs({ demoLoadedAt: null });
        }}
      />
    </div>
  );
}
