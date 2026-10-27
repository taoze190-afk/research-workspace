import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/shared/user-avatar';
import { useAuth } from '@/state/AuthContext';
import { api, type AuthUser } from '@/data/api';
import { prepareAvatar } from '@/lib/avatar';
import { useToast } from '@/components/ui/toast';

export function AvatarEditor({ user }: { user: AuthUser }) {
  const auth = useAuth();
  const toast = useToast();
  const current = user.avatarDataUrl ?? null;
  const [draft, setDraft] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    setDraft(current);
    setError('');
  }, [current]);
  const dirty = draft !== current;
  const online = auth.phase === 'signed-in';
  const choose = async (file: File) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await prepareAvatar(file);
      if (alive.current && request === generation.current) setDraft(value);
    } catch (err) {
      if (alive.current && request === generation.current) setError((err as Error).message);
    } finally {
      if (alive.current && request === generation.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!online || busy || !dirty) return;
    setBusy(true);
    setError('');
    try {
      await api.updateAvatar(draft);
      if (!alive.current) return;
      await auth.refreshMe();
      if (alive.current) toast({ title: draft ? '头像已保存' : '头像已移除', tone: 'success' });
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="px-4 py-5" aria-label="头像设置">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar user={{ ...user, avatarDataUrl: draft }} size={64} />
        <div className="min-w-0 flex-1">
          <h4 className="text-body font-medium">头像</h4>
          <p className="mt-1 text-[12px] text-ink-2">JPG、PNG、WebP，最大 5 MB</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={busy || !online} onClick={() => fileInput.current?.click()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Camera size={14} aria-hidden />}
              {draft ? '更换头像' : '上传头像'}
            </Button>
            {draft && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !online}
                onClick={() => {
                  setDraft(null);
                  setError('');
                }}
              >
                移除头像
              </Button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择头像图片"
        tabIndex={-1}
        className="sr-only"
        disabled={busy || !online}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void choose(file);
        }}
      />
      {error && (
        <p className="mt-3 text-aux text-danger" role="alert">
          {error}
        </p>
      )}
      {!online && <p className="mt-3 text-aux text-ink-2">联网后可更换头像</p>}
      {dirty && (
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            variant="primary"
            className="min-w-[88px]"
            disabled={busy || !online}
            onClick={() => void save()}
          >
            {busy ? '正在保存…' : '保存头像'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(current);
              setError('');
            }}
          >
            取消
          </Button>
        </div>
      )}
    </section>
  );
}
