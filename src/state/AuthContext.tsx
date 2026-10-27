import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type AuthUser } from '@/data/api.ts';
import {
  bootstrap,
  clearMirror,
  countPending,
  detectMode,
  flush,
  installWriteCapture,
  rememberedAccount,
  rememberedMode,
  setMode,
  setQueueOwner,
  startAutoRetry,
  stopAutoRetry,
} from '@/data/sync.ts';
import { TABLE_NAMES } from '@/data/tables.ts';
import { setAiConfigOwner } from '@/lib/ai';
import { flushPendingSaves } from '@/lib/pendingSaves';
import { useToast } from '@/components/ui/toast';

interface AuthCtx {
  user: AuthUser | null;
  /**
   * 'checking' 探测中；'local' 纯本地；'signed-out' 服务器在但没登录；
   * 'signed-in' 已登录；'offline' 后端不可达，但本机有会话与镜像，可以继续离线用
   */
  phase: 'checking' | 'local' | 'signed-out' | 'signed-in' | 'offline';
  /** 服务端镜像完成重建后递增，让页面读取同一账号的最新快照。 */
  dataVersion: number;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** 资料改动（昵称）后重新拉一次 /api/me，让顶栏与设置页立即可见。 */
  refreshMe: () => Promise<void>;
}

/**
 * 后端挂了 vs 没登录，要分开处理。
 * 反代（vite / Nginx）在后端不可达时给的是 5xx，网络断了是 status 0；
 * 这两种都不能把人挡在登录页上 —— 离线时登录根本完不成，只会挡人不挡事。
 */
function unreachable(status: number): boolean {
  return status === 0 || status >= 500;
}

const Ctx = createContext<AuthCtx | null>(null);

let captureInstalled = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [phase, setPhase] = useState<AuthCtx['phase']>('checking');
  const [dataVersion, setDataVersion] = useState(0);
  const sessionRevision = useRef(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    if (!captureInstalled) {
      installWriteCapture(TABLE_NAMES);
      captureInstalled = true;
    }
    // 离线攒下的改动，服务器一通就自动补传并回到在线状态，不用用户记得去点
    startAutoRetry(async () => {
      const revision = sessionRevision.current;
      const previousOwner = rememberedAccount();
      try {
        const me = await api.me();
        if (!alive || revision !== sessionRevision.current) return;
        if (previousOwner !== me.id) setPhase('checking');
        setAiConfigOwner(me.id);
        setQueueOwner(me.id);
        await bootstrap();
        if (!alive || revision !== sessionRevision.current) return;
        setUser({
          id: me.id,
          email: me.email,
          role: me.role,
          nickname: me.nickname,
          aiEnabled: me.aiEnabled,
          avatarDataUrl: me.avatarDataUrl,
        });
        setDataVersion((value) => value + 1);
        setPhase('signed-in');
      } catch {
        /* 还是连不上，继续离线模式 */
      }
    });
    (async () => {
      const mode = await detectMode();
      if (!alive) return;
      if (mode === 'local') {
        setAiConfigOwner(null);
        setPhase('local');
        return;
      }
      try {
        const me = await api.me();
        if (!alive) return;
        setAiConfigOwner(me.id);
        setUser({
          id: me.id,
          email: me.email,
          role: me.role,
          nickname: me.nickname,
          aiEnabled: me.aiEnabled,
          avatarDataUrl: me.avatarDataUrl,
        });
        setQueueOwner(me.id);
        await bootstrap();
        if (!alive) return;
        setDataVersion((value) => value + 1);
        setPhase('signed-in');
      } catch (error) {
        if (!alive) return;
        const status = (error as { status?: number }).status ?? 0;
        if (unreachable(status) && rememberedMode() === 'server') {
          setAiConfigOwner(rememberedAccount());
          // 后端不可达：带着本机镜像继续工作，改动按上次记住的账号排队等补传
          setQueueOwner(rememberedAccount());
          setPhase('offline');
          countPending();
        } else {
          setPhase('signed-out');
        }
      }
    })();
    return () => {
      alive = false;
      sessionRevision.current += 1;
      stopAutoRetry();
    };
  }, []);

  const afterAuth = useCallback(async (nextUser: AuthUser) => {
    const revision = ++sessionRevision.current;
    setPhase((current) => (current === 'signed-out' ? current : 'checking'));
    setAiConfigOwner(nextUser.id);
    setUser(nextUser);
    setMode('server');
    // 队列按账号隔离：先认领身份，再推没传完的，最后按服务器全量重建镜像
    setQueueOwner(nextUser.id);
    await bootstrap();
    if (revision !== sessionRevision.current) return;
    setDataVersion((value) => value + 1);
    setPhase('signed-in');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await api.login(email, password);
        await afterAuth(res.user);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    },
    [afterAuth],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await api.signup(email, password);
        await afterAuth(res.user);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    },
    [afterAuth],
  );

  const signOut = useCallback(async () => {
    sessionRevision.current += 1;
    let saved = false;
    try {
      saved = await flushPendingSaves();
    } catch {
      // 保存异常与返回 false 都保留当前编辑器，交给用户重试。
    }
    if (!saved) {
      toast({ title: '还有编辑未保存', description: '请先重试保存，再退出账号。', tone: 'error' });
      return;
    }
    // 草稿已落库后再卸载编辑器；旧 cleanup 随即被 DataProvider 的账号守卫拦截。
    setPhase('checking');
    try {
      // 先补传当前账号已有队列，再吊销会话；离线失败的队列继续按原账号保留。
      await flush();
      await api.logout();
    } catch {
      // 网络退出失败也完成本地退出，避免菜单中的 void 调用产生未处理 rejection。
    } finally {
      // 队列按账号存着，等同一账号下次登录再传；镜像里可能装着科研记录，退出即抹掉
      setQueueOwner(null);
      try {
        await clearMirror();
      } catch {
        toast({ title: '本机缓存清理失败', description: '账号已退出，请关闭此页面后重试。', tone: 'error' });
      } finally {
        setUser(null);
        setAiConfigOwner(null);
        setPhase('signed-out');
      }
    }
  }, [toast]);

  const refreshMe = useCallback(async () => {
    const me = await api.me();
    setUser({
      id: me.id,
      email: me.email,
      role: me.role,
      nickname: me.nickname,
      aiEnabled: me.aiEnabled,
      avatarDataUrl: me.avatarDataUrl,
    });
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ user, phase, dataVersion, signIn, signUp, signOut, refreshMe }),
    [user, phase, dataVersion, signIn, signUp, signOut, refreshMe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
