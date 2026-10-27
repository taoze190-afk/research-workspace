import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/state/AuthContext';
import { useToast } from '@/components/ui/toast';
import { api, type SessionInfo } from '@/data/api';
import { describeUserAgent } from '@/lib/ua';
import { formatTimestamp } from '@/domain/date';
import { AvatarEditor } from '@/features/account/AvatarEditor';

/**
 * 账号安全与资料（仅服务器登录模式渲染）：昵称、改密码、登录设备管理。
 * 改密码会吊销其他设备的会话，当前设备保持在线。
 */
export function AccountSection() {
  const auth = useAuth();
  const toast = useToast();
  const user = auth.user;

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [editingName, setEditingName] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [confirmKickOthers, setConfirmKickOthers] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.sessions();
      setSessions(res.sessions);
    } catch (error) {
      setSessions([]);
      toast({ title: '读取登录设备失败', description: (error as Error).message, tone: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  if (!user) return null;

  const saveNickname = async () => {
    setNameBusy(true);
    try {
      await api.updateProfile(nickname);
      await auth.refreshMe();
      setEditingName(false);
      toast({ title: '已保存', tone: 'success' });
    } catch (error) {
      toast({ title: '保存失败', description: (error as Error).message, tone: 'error' });
    } finally {
      setNameBusy(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwCurrent || !pwNew) {
      setPwError('先填齐当前密码和新密码');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('两次输入的新密码不一致');
      return;
    }
    setPwError(null);
    setPwBusy(true);
    try {
      const res = await api.changePassword(pwCurrent, pwNew);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      toast({
        title: '已修改密码',
        description: res.revoked > 0 ? `其他 ${res.revoked} 台设备已退出登录` : undefined,
        tone: 'success',
      });
      void loadSessions();
    } catch (error) {
      setPwError((error as Error).message);
    } finally {
      setPwBusy(false);
    }
  };

  const kick = async (id: string) => {
    try {
      await api.revokeSession(id);
      await loadSessions();
      toast({ title: '已踢下线', tone: 'success' });
    } catch (error) {
      toast({ title: '操作失败', description: (error as Error).message, tone: 'error' });
    }
  };

  const kickOthers = async () => {
    try {
      const res = await api.revokeOtherSessions();
      await loadSessions();
      setConfirmKickOthers(false);
      toast({ title: res.revoked > 0 ? `已踢下线 ${res.revoked} 台设备` : '没有其他登录', tone: 'success' });
    } catch (error) {
      toast({ title: '操作失败', description: (error as Error).message, tone: 'error' });
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="divide-y divide-line">
      <AvatarEditor key={user.id} user={user} />
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="text-body text-ink-2">邮箱</span>
        <span className="min-w-0 truncate text-body" title={user.email}>
          {user.email}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="text-body text-ink-2">昵称</span>
        {editingName ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={nickname}
              aria-label="昵称"
              className="h-8 w-[180px]"
              maxLength={24}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveNickname();
                }
                if (e.key === 'Escape') {
                  setEditingName(false);
                  setNickname(user.nickname ?? '');
                }
              }}
            />
            <Button variant="secondary" size="sm" disabled={nameBusy} onClick={() => void saveNickname()}>
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingName(false);
                setNickname(user.nickname ?? '');
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-body" title={user.nickname ?? undefined}>
              {user.nickname?.trim() || '未设置'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNickname(user.nickname ?? '');
                setEditingName(true);
              }}
            >
              <UserRound size={13} aria-hidden />
              修改
            </Button>
          </div>
        )}
      </div>

      <form className="flex flex-col gap-2.5 px-3.5 py-3" onSubmit={(e) => void submitPassword(e)}>
        <p className="text-aux font-medium text-ink-2">修改密码</p>
        <p className="text-aux text-warning">其他设备会退出登录</p>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="当前密码">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label="新密码">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
              />
            )}
          </Field>
          <Field label="再输一遍">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
              />
            )}
          </Field>
        </div>
        {pwError && (
          <p className="text-aux text-danger" role="alert">
            {pwError}
          </p>
        )}
        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={pwBusy}>
            {pwBusy ? '正在提交…' : '确认修改'}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-aux font-medium text-ink-2">
            <MonitorSmartphone size={13} aria-hidden />
            登录设备
          </p>
          {others > 0 && (
            <Button variant="dangerGhost" size="sm" onClick={() => setConfirmKickOthers(true)}>
              踢出其他设备
            </Button>
          )}
        </div>
        {sessions === null ? (
          <p className="text-aux text-ink-2">正在读取…</p>
        ) : sessions.length === 0 ? (
          <p className="text-aux text-ink-2">没有活跃的登录</p>
        ) : (
          <ul className="overflow-hidden rounded-control border border-line">
            {sessions.map((s) => (
              <li key={s.id} className="row-line flex flex-wrap items-center gap-2 bg-surface px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body" title={s.userAgent}>
                  {describeUserAgent(s.userAgent)}
                  {s.current && <span className="ml-1.5 text-aux text-brand-ink">（本机）</span>}
                </span>
                <span className="shrink-0 text-aux tabular-nums text-ink-2">
                  最近活跃 {formatTimestamp(s.lastSeenAt)}
                </span>
                {!s.current && (
                  <Button variant="dangerGhost" size="sm" onClick={() => void kick(s.id)}>
                    踢下线
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmKickOthers}
        onOpenChange={setConfirmKickOthers}
        danger
        title="踢出其他设备？"
        confirmLabel="全部踢下线"
        body={<p>其他 {others} 台设备将退出登录，需要重新登录才能访问。</p>}
        onConfirm={() => void kickOthers()}
      />
    </div>
  );
}
