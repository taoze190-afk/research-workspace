import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/state/AuthContext';
import { api } from '@/data/api';
import {
  canManagePlatform,
  MODEL_PROVIDERS,
  roleLabels,
  type ManagedUser,
  type PlatformOverview,
} from '@/domain/platform';
import { formatTimestamp } from '@/domain/date';
import { cn } from '@/lib/cx';

const tabs = [
  { id: 'users', title: '用户管理', icon: Users },
  { id: 'models', title: '模型接入', icon: Bot },
  { id: 'permissions', title: '角色与权限', icon: ShieldCheck },
  { id: 'activity', title: '操作记录', icon: Activity },
];

export function AdminPage() {
  const auth = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((item) => item.id === params.get('tab')) ? params.get('tab')! : 'users';
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<ManagedUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const [provider, setProvider] = useState('deepseek');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testResult, setTestResult] = useState('');
  const allowed = auth.phase === 'signed-in' && canManagePlatform(auth.user?.role);
  const load = useCallback(async () => {
    const next = await api.adminOverview();
    setData(next);
    setProvider(next.ai.provider);
    setModel(next.ai.model);
    setEnabled(next.ai.enabled);
  }, []);
  useEffect(() => {
    let alive = true;
    if (allowed)
      void api
        .adminOverview()
        .then((next) => {
          if (!alive) return;
          setData(next);
          setProvider(next.ai.provider);
          setModel(next.ai.model);
          setEnabled(next.ai.enabled);
        })
        .catch((err: Error) => {
          if (alive) setError(err.message);
        });
    return () => {
      alive = false;
    };
  }, [allowed]);
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
      toast({ title: message, tone: 'success' });
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <section className="panel mx-auto mt-12 w-full max-w-[560px] p-8 text-center">
        <LockKeyhole size={30} className="mx-auto mb-4 text-brand" />
        <h2 className="text-section">管理控制台仅向管理员开放</h2>
        <p className="mt-3 text-aux leading-7 text-ink-2">
          {auth.phase === 'local'
            ? '当前为本地模式。连接服务器后，第一个注册的账号将成为平台所有者。'
            : '你的账号没有管理权限。需要调整账号或平台模型时，请联系管理员。'}
        </p>
        <Link to="/" className="mt-5 inline-block text-aux text-brand">
          回到工作台 →
        </Link>
      </section>
    );
  const selectedProvider = MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0];
  const users =
    data?.users.filter((u) => `${u.email} ${u.nickname ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ??
    [];
  const unsaved =
    data && (provider !== data.ai.provider || model.trim() !== data.ai.model || enabled !== data.ai.enabled);
  return (
    <div className="platform-page admin-page">
      <header className="platform-page-heading">
        <div>
          <h2>管理控制台</h2>
        </div>
        <span className="platform-role-pill">
          <ShieldCheck size={13} />
          {roleLabels[auth.user!.role as keyof typeof roleLabels]}
        </span>
      </header>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-control border border-danger/20 bg-danger-soft px-4 py-3 text-aux text-danger"
        >
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setError('');
              void load().catch((err: Error) => setError(err.message));
            }}
          >
            重新读取
          </Button>
        </div>
      )}
      {!data ? (
        <div role="status" className="panel flex items-center gap-3 p-8 text-aux text-ink-2">
          <Loader2 size={16} className="animate-spin" />
          正在读取平台信息…
        </div>
      ) : (
        <>
          <div className="platform-stats">
            {[
              { label: '平台账号', value: data.users.length, icon: Users },
              { label: '正常使用', value: data.users.filter((u) => u.status === 'active').length, icon: ShieldCheck },
              {
                label: '已授权平台 AI',
                value: data.users.filter((u) => u.aiEnabled && u.status === 'active').length,
                icon: Bot,
              },
              { label: '注册方式', value: data.allowSignup ? '开放注册' : '管理员创建', icon: KeyRound },
            ].map((s) => (
              <div className="panel platform-stat" key={s.label}>
                <span className="flex items-center justify-between text-[14px] text-ink-2">
                  {s.label}
                  <s.icon size={15} aria-hidden />
                </span>
                <strong className={typeof s.value === 'number' ? 'font-mono text-[28px]' : 'text-[19px]'}>
                  {s.value}
                </strong>
              </div>
            ))}
          </div>
          <div
            className="platform-tabs"
            role="tablist"
            aria-label="管理设置"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const current = tabs.findIndex((item) => item.id === tab);
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              const next = tabs[nextIndex].id;
              setParams({ tab: next });
              setError('');
              requestAnimationFrame(() => document.getElementById(`admin-tab-${next}`)?.focus());
            }}
          >
            {tabs.map((t) => (
              <button
                id={`admin-tab-${t.id}`}
                aria-controls={`admin-panel-${t.id}`}
                type="button"
                role="tab"
                tabIndex={tab === t.id ? 0 : -1}
                aria-selected={tab === t.id}
                key={t.id}
                onClick={() => {
                  setParams({ tab: t.id });
                  setError('');
                }}
                className={cn('platform-tab', tab === t.id && 'is-active')}
              >
                <t.icon size={15} />
                {t.title}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
            {tab === 'users' && (
              <section className="panel overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div>
                    <h3 className="platform-card-title">
                      全部账号 <span className="ml-1 text-[13px] font-normal text-ink-2">{data.users.length}</span>
                    </h3>
                    <p className="mt-1 text-[13px] text-ink-2">账号管理不会授予其他用户科研记录的访问权。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="搜索账号"
                        placeholder="搜索姓名或邮箱"
                        className="w-[210px] pl-8"
                      />
                    </div>
                    <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus size={14} />
                      创建账号
                    </Button>
                  </div>
                </header>
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="platform-users-table">
                    <caption className="sr-only">平台账号与权限</caption>
                    <thead>
                      <tr>
                        {['用户', '角色', '状态', '平台 AI', '创建时间', '操作'].map((h) => (
                          <th scope="col" key={h}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const protectedUser =
                          u.id === auth.user?.id ||
                          u.role === 'owner' ||
                          (auth.user?.role !== 'owner' && u.role !== 'member');
                        return (
                          <tr key={u.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                <span className="platform-avatar" aria-hidden>
                                  {(u.nickname || u.email)[0].toUpperCase()}
                                </span>
                                <div>
                                  <span className="block text-[13px] font-medium">
                                    {u.nickname || u.email.split('@')[0]}
                                    {u.id === auth.user?.id && (
                                      <small className="ml-2 font-normal text-ink-2">你</small>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block text-[13px] text-ink-2">{u.email}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              {auth.user?.role === 'owner' && !protectedUser ? (
                                <Select
                                  aria-label={`修改 ${u.email} 的角色`}
                                  className="h-8 w-[112px] text-[14px]"
                                  value={u.role}
                                  disabled={busy}
                                  onChange={(e) =>
                                    void perform(
                                      () => api.updateUser({ id: u.id, role: e.target.value }),
                                      '角色已更新，用户需重新登录',
                                    )
                                  }
                                >
                                  <option value="member">普通用户</option>
                                  <option value="admin">管理员</option>
                                </Select>
                              ) : (
                                <span className="text-[14px]">{roleLabels[u.role]}</span>
                              )}
                            </td>
                            <td>
                              <span className={cn('platform-status', u.status === 'disabled' && 'is-disabled')}>
                                <span aria-hidden />
                                {u.status === 'active' ? '正常' : '已停用'}
                              </span>
                            </td>
                            <td>
                              <Switch
                                checked={u.aiEnabled}
                                disabled={busy || protectedUser}
                                label={`${u.email} 的平台 AI 权限`}
                                onCheckedChange={(value) =>
                                  void perform(
                                    () => api.updateUser({ id: u.id, aiEnabled: value }),
                                    '平台 AI 权限已更新',
                                  )
                                }
                              />
                            </td>
                            <td className="whitespace-nowrap text-[13px] text-ink-2">
                              {formatTimestamp(u.createdAt).split(' ')[0]}
                            </td>
                            <td>
                              {protectedUser ? (
                                <span className="text-[13px] text-ink-2">受保护</span>
                              ) : (
                                <Button
                                  variant={u.status === 'active' ? 'ghost' : 'secondary'}
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    u.status === 'active'
                                      ? setDisableTarget(u)
                                      : void perform(() => api.updateUser({ id: u.id, status: 'active' }), '账号已启用')
                                  }
                                >
                                  {u.status === 'active' ? '停用' : '重新启用'}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {users.length === 0 && <p className="p-8 text-center text-aux text-ink-2">没有找到匹配的账号。</p>}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-subtle/40 px-5 py-4">
                  <span className="text-[14px] text-ink-2">允许用户自行注册</span>
                  <Switch
                    checked={data.allowSignup}
                    disabled={busy}
                    label="允许用户自行注册"
                    onCheckedChange={(value) =>
                      void perform(() => api.updatePlatform({ allowSignup: value }), '注册设置已更新')
                    }
                  />
                </footer>
              </section>
            )}
            {tab === 'models' && (
              <div className="admin-model-grid">
                <section className="panel overflow-hidden">
                  <header className="border-b border-line px-6 py-5">
                    <h3 className="platform-card-title">
                      <Bot size={17} />
                      平台模型连接
                    </h3>
                    <p className="mt-2 text-aux text-ink-2">统一配置一次，已授权用户即可使用。</p>
                  </header>
                  <form
                    className="flex flex-col gap-5 p-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setTestResult('');
                      void perform(
                        () => api.updatePlatform({ ai: { provider, model: model.trim(), enabled } }),
                        '模型设置已保存',
                      );
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="模型服务商">
                        {(id) => (
                          <Select
                            id={id}
                            value={provider}
                            onChange={(e) => {
                              setProvider(e.target.value);
                              setTestResult('');
                            }}
                          >
                            {MODEL_PROVIDERS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label="模型标识">
                        {(id) => (
                          <Input
                            id={id}
                            maxLength={120}
                            value={model}
                            required={enabled}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder="填写服务商提供的模型名称"
                          />
                        )}
                      </Field>
                    </div>
                    <div className="rounded-control border border-line bg-surface-subtle/60 p-4">
                      <span className="flex items-center gap-2 text-[14px] font-medium">
                        <KeyRound size={14} />
                        服务端密钥
                      </span>
                      <p className="mt-2 text-[14px] leading-6 text-ink-2">
                        在服务器环境变量中设置{' '}
                        <code className="font-mono text-ink">{selectedProvider.keyVariable}</code>
                        。密钥不会发送给浏览器。
                      </p>
                      {provider === 'custom' && (
                        <p className="mt-2 text-[14px] text-ink-2">自定义地址由服务器的 AI_BASE_URL 指定。</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium">启用平台 AI</p>
                        <p className="mt-1 text-[13px] text-ink-2">只向已授权且正常的账号开放</p>
                      </div>
                      <Switch checked={enabled} onCheckedChange={setEnabled} label="启用平台 AI" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
                      <Button type="submit" variant="primary" size="sm" disabled={busy}>
                        保存设置
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || Boolean(unsaved) || !data.ai.configured || !data.ai.enabled}
                        onClick={async () => {
                          setBusy(true);
                          setTestResult('');
                          try {
                            const reply = await api.testPlatformAi();
                            setTestResult(reply.content);
                          } catch (err) {
                            setError((err as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        测试连接
                      </Button>
                      {unsaved && <span className="text-[13px] text-warning">有未保存的修改</span>}
                    </div>
                    {testResult && (
                      <p role="status" className="flex items-center gap-2 text-aux text-brand">
                        <Check size={14} />
                        {testResult}
                      </p>
                    )}
                  </form>
                </section>
                <aside className="flex flex-col gap-4">
                  <section className="platform-blue-note">
                    <h3 className="mt-4 text-[20px] font-semibold">
                      {data.ai.configured && data.ai.enabled ? '模型已就绪' : '等待接入'}
                    </h3>
                    <p className="mt-2 text-aux leading-7 text-ink-2">
                      {data.ai.configured
                        ? data.ai.enabled
                          ? '成员可在 AI 工作室使用平台模型。'
                          : '配置已保存，启用后成员即可使用。'
                        : '选择服务商、填写模型名称，并在服务器配置密钥。'}
                    </p>
                    <div className="mt-6 border-t border-line pt-4 text-[14px] text-ink-2">
                      已保存模型：<span className="break-all text-ink">{data.ai.model || '未设置'}</span>
                    </div>
                  </section>
                  <div className="px-1 text-[14px] leading-7 text-ink-2">
                    <p className="flex items-center gap-2 font-medium text-ink">
                      <CircleHelp size={15} />
                      这次会发送什么？
                    </p>
                    <p className="mt-2">仅发送用户提交的问题与明确选中的资料。生成结果需由用户审阅后采用。</p>
                    <Link to="/ai" className="mt-3 inline-flex items-center gap-1 text-brand">
                      前往 AI 工作室
                      <ArrowUpRight size={13} />
                    </Link>
                  </div>
                </aside>
              </div>
            )}
            {tab === 'permissions' && (
              <section className="panel overflow-hidden">
                <header className="border-b border-line p-5">
                  <h3 className="platform-card-title">
                    <ShieldCheck size={16} />
                    清晰的职责边界
                  </h3>
                  <p className="mt-2 text-aux text-ink-2">
                    平台管理权限与科研数据访问权分开；所有账号只能访问自己的科研记录。
                  </p>
                </header>
                <div className="grid gap-4 p-5 lg:grid-cols-3">
                  {[
                    {
                      title: '平台所有者',
                      hint: '第一个注册的账号',
                      permissions: [
                        '创建与管理管理员',
                        '创建、停用普通用户',
                        '设置平台 AI 与注册方式',
                        '管理自己的科研记录',
                      ],
                    },
                    {
                      title: '管理员',
                      hint: '由平台所有者授权',
                      permissions: [
                        '创建与停用普通用户',
                        '调整普通用户平台 AI 权限',
                        '设置平台 AI 与注册方式',
                        '管理自己的科研记录',
                      ],
                    },
                    {
                      title: '普通用户',
                      hint: '专注自己的研究',
                      permissions: [
                        '使用项目、任务、实验与文献',
                        '管理个人资料和登录设备',
                        '使用已授权的平台 AI',
                        '不能访问管理控制台',
                      ],
                    },
                  ].map((r) => (
                    <article key={r.title} className="rounded-panel border border-line p-5">
                      <span className="grid size-9 place-items-center rounded-control bg-brand-soft text-brand">
                        <ShieldCheck size={18} />
                      </span>
                      <h4 className="mt-4 text-[15px] font-semibold">{r.title}</h4>
                      <p className="mt-1 text-[13px] text-ink-2">{r.hint}</p>
                      <ul className="mt-5 space-y-3">
                        {r.permissions.map((p) => (
                          <li key={p} className="flex items-start gap-2 text-[14px] leading-6">
                            <Check size={13} className="mt-1 shrink-0 text-brand" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
                <p className="border-t border-line px-5 py-4 text-[14px] leading-7 text-ink-2">
                  课题组共享尚未启用。若需要负责人、成员与只读访客，应另外加入项目成员关系与项目级授权。
                </p>
              </section>
            )}
            {tab === 'activity' && (
              <section className="panel overflow-hidden">
                <header className="border-b border-line p-5">
                  <h3 className="platform-card-title">
                    <Activity size={16} />
                    最近操作
                  </h3>
                  <p className="mt-2 text-[14px] text-ink-2">记录账号与平台设置变更，不记录 AI 提问正文或密钥。</p>
                </header>
                {data.audit.length === 0 ? (
                  <p className="p-8 text-center text-aux text-ink-2">还没有管理操作。</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.audit.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                        <div className="min-w-0">
                          <p className="break-words text-[13px] font-medium">{a.action}</p>
                          <p className="mt-1 break-all text-[13px] text-ink-2">
                            {a.actorEmail}
                            <ChevronRight size={11} className="mx-1 inline" aria-hidden />
                            {a.target}
                          </p>
                        </div>
                        <span className="text-[13px] tabular-nums text-ink-2">{formatTimestamp(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setCreateOpen(open);
          if (!open) setPassword('');
        }}
      >
        <DialogContent title="创建新账号" description="账号创建后由用户使用此邮箱和初始密码登录。" width="sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await perform(() => api.createUser({ email, password, role }), '账号已创建');
              if (ok) {
                setCreateOpen(false);
                setEmail('');
                setPassword('');
                setRole('member');
              }
            }}
          >
            <Field label="邮箱">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="初始密码">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={200}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <p className="text-[13px] text-ink-2">至少 10 个字符，包含大小写、数字、符号中的两类。</p>
            <Field label="角色">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="member">普通用户</option>
                  {auth.user?.role === 'owner' && <option value="admin">管理员</option>}
                </Select>
              )}
            </Field>
            {error && (
              <p role="alert" className="text-aux text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? '正在创建…' : '创建账号'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        danger
        title="停用这个账号？"
        body={<p>{disableTarget?.email} 将无法登录，已有会话会立即失效，科研记录会保留。</p>}
        confirmLabel={busy ? '正在停用…' : '确认停用'}
        onConfirm={() => {
          if (!disableTarget || busy) return;
          void perform(() => api.updateUser({ id: disableTarget.id, status: 'disabled' }), '账号已停用').then((ok) => {
            if (ok) setDisableTarget(null);
          });
        }}
      />
    </div>
  );
}
