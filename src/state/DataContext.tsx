import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadDataset } from '@/data/repo';
import { flush, getSyncState, rememberedAccount } from '@/data/sync.ts';
import { emptyDataset, type Dataset } from '@/domain/types';
import { useToast } from '@/components/ui/toast';
import { useAuth } from './AuthContext';

export type DataStatus = 'loading' | 'ready' | 'error';

interface DataCtx {
  data: Dataset;
  status: DataStatus;
  error: string | null;
  refresh: () => Promise<void>;
  /** 所有写操作都经过这里：写库 → 重新读取 → 失败时提示并保留原数据。 */
  mutate: (fn: () => Promise<unknown>, options?: { silent?: boolean; success?: string }) => Promise<boolean>;
  retry: () => void;
}

const Ctx = createContext<DataCtx | null>(null);

// 同一浏览器开了两个标签页写同一份本地库时，写完广播一声，别的标签页立刻重读，
// 不用再靠手动刷新（BroadcastChannel 不送达发送方自己，不会成环）。
const tabChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rw.data.v1') : null;

export function describeStorageError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'QuotaExceededError' || name === 'NotAllowedError') {
    return name === 'QuotaExceededError'
      ? '浏览器存储空间不足，这次改动没有保存。请先清理旧的备份文件或浏览器其他站点的数据，再点重试。'
      : '浏览器拒绝了本地存储访问（可能是隐私模式）。数据暂时只在内存里，请退出隐私模式后重新打开。';
  }
  return `本地数据库写入失败：${(error as Error)?.message ?? '未知原因'}。你的输入内容仍然保留在页面上，可以点重试。`;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const owner =
    auth.phase === 'local'
      ? 'local'
      : auth.phase === 'signed-in' || auth.phase === 'offline'
        ? (auth.user?.id ?? rememberedAccount())
        : null;
  const [data, setData] = useState<Dataset>(emptyDataset);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loadedOwner = useRef<string | null>(null);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const alive = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    if (!owner) return;
    try {
      const next = await loadDataset();
      if (!alive.current || currentOwner.current !== owner || request !== revision.current) return;
      setData(next);
      loadedOwner.current = owner;
      setLoadedFor(owner);
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (!alive.current || currentOwner.current !== owner || request !== revision.current) return;
      if (loadedOwner.current !== owner) setData(emptyDataset);
      loadedOwner.current = owner;
      setLoadedFor(owner);
      setStatus('error');
      setError(describeStorageError(e));
    }
  }, [owner]);

  useEffect(() => {
    alive.current = true;
    if (!owner) {
      setData(emptyDataset);
      setLoadedFor(null);
      loadedOwner.current = null;
      setStatus('loading');
      setError(null);
    }
    void refresh();
    if (tabChannel) tabChannel.onmessage = () => void refresh();
    return () => {
      alive.current = false;
      revision.current += 1;
      if (tabChannel) tabChannel.onmessage = null;
    };
  }, [refresh, owner, auth.dataVersion]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, options?: { silent?: boolean; success?: string }) => {
      // 编辑器卸载会补交防抖草稿；退出或换账号触发的旧 cleanup 不能写进新账号镜像。
      const ownsSession = () => alive.current && owner !== null && currentOwner.current === owner;
      if (!ownsSession()) return false;
      let localOk = false;
      try {
        await fn();
        if (!ownsSession()) return false;
        localOk = true;
      } catch (e) {
        if (!ownsSession()) return false;
        const message = describeStorageError(e);
        setError(message);
        if (!options?.silent) toast({ title: '保存失败', description: message, tone: 'error', duration: 9000 });
      }

      // 界面永远先反映本地镜像的结果：上传失败不等于这次编辑没写成，
      // 否则离线时用户输入的东西会像凭空消失一样。
      if (localOk) {
        await refresh();
        if (!ownsSession()) return false;
        tabChannel?.postMessage(Date.now());
      }

      if (localOk && getSyncState().mode === 'server') {
        const synced = await flush();
        if (!ownsSession()) return false;
        if (!synced) {
          // 不写 error：那是「数据库不可用」级别的横幅。离线排队是可恢复状态，顶栏标注 + 这次提示已经说清了
          const message = getSyncState().lastError ?? '改动没能上传到服务器';
          if (!options?.silent)
            toast({
              title: '还没同步到服务器',
              description: `${message} 改动已留在这台浏览器里，服务器恢复后会自动补传。`,
              tone: 'error',
              duration: 9000,
            });
          // 本地保存已经完成：关闭创建表单，防止用户把同一条记录重复提交。
          // 未上传状态继续由同步标注和上面的提示表达。
          return localOk;
        }
      }
      if (!ownsSession()) return false;
      if (localOk && options?.success && !options.silent) toast({ title: options.success, tone: 'success' });
      return localOk;
    },
    [owner, refresh, toast],
  );

  const value = useMemo<DataCtx>(
    () => ({
      data: owner && loadedFor === owner ? data : emptyDataset(),
      status: owner && loadedFor === owner ? status : 'loading',
      error: owner && loadedFor === owner ? error : null,
      refresh,
      mutate,
      retry: () => void refresh(),
    }),
    [data, loadedFor, owner, status, error, refresh, mutate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useData 必须在 DataProvider 内使用');
  return ctx;
}
