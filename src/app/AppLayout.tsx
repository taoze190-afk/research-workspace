import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { TriangleAlert, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '@/features/search/CommandPalette';
import { AgentDrawer } from '@/features/agent/AgentDrawer';
import { useData } from '@/state/DataContext';
import { useAuth } from '@/state/AuthContext.tsx';
import { useSyncState } from '@/data/sync.ts';
import { usePrefs, setPrefs } from '@/lib/prefs';
import { cn } from '@/lib/cx';
import { Button } from '@/components/ui/button';
import { OverlayContent } from '@/components/ui/overlay-content';
import './workspace.css';

export function AppLayout({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const { status, error, retry } = useData();
  const auth = useAuth();
  const sync = useSyncState();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentQuestion, setAgentQuestion] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);

  useLayoutEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
      mainRef.current.scrollLeft = 0;
    }
    setFocusMode(false);
  }, [pathname]);

  // 从文献/实验菜单进入沉浸模式，Esc 退出。
  useEffect(() => {
    const toggle = () => setFocusMode((v) => !v);
    window.addEventListener('rw:focus-mode', toggle);
    return () => window.removeEventListener('rw:focus-mode', toggle);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('focus-mode', focusMode);
    if (!focusMode) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('focus-mode');
      window.removeEventListener('keydown', onKey);
    };
  }, [focusMode]);

  // Ctrl/Cmd+K 或 / 呼出搜索；N 新建任务；1–5 切换五个页面。
  // 输入法组合过程中（isComposing）与在输入控件里打字时一律不响应；有浮层打开时单键位让位。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      if (event.key === '/') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        navigate('/tasks?new=1');
      } else if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        navigate(['/', '/projects', '/tasks', '/experiments', '/library'][Number(event.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="workspace-shell flex h-full min-h-0 w-full overflow-hidden bg-app-bg">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside
        className={cn(
          'app-aside hidden shrink-0 border-r border-line md:block',
          prefs.navCollapsed ? 'w-12' : 'w-[240px]',
        )}
      >
        <Sidebar collapsed={prefs.navCollapsed} />
      </aside>

      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay md:hidden" />
          <OverlayContent
            className="fixed left-0 top-0 z-50 h-full w-[268px] border-r border-line bg-surface md:hidden"
            aria-label="导航"
          >
            <DialogPrimitive.Title className="sr-only">导航</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">选择要前往的科研页面</DialogPrimitive.Description>
            <div className="relative h-full">
              <Sidebar collapsed={false} onNavigate={() => setNavOpen(false)} />
              <DialogPrimitive.Close
                className="overlay-close absolute right-2 top-[78px] inline-flex items-center justify-center rounded-control p-1.5 text-ink-2 hover:bg-surface-subtle"
                aria-label="关闭导航"
              >
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </OverlayContent>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={prefs.navCollapsed}
          onOpenNav={() => setNavOpen(true)}
          onToggleCollapse={() => setPrefs({ navCollapsed: !prefs.navCollapsed })}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleAgent={() => setAgentOpen((v) => !v)}
          agentOpen={agentOpen}
        />

        {status === 'error' && (
          <div
            className="flex flex-wrap items-center gap-3 border-b border-danger-soft bg-danger-soft px-4 py-2.5 text-aux text-danger"
            role="alert"
          >
            <TriangleAlert size={15} aria-hidden />
            <span className="min-w-0 flex-1">{error ?? '本地数据库当前不可用，改动可能无法保存。'}</span>
            <Button variant="secondary" size="sm" onClick={retry}>
              重试
            </Button>
          </div>
        )}

        {auth.phase === 'offline' && (
          <div
            className="flex flex-wrap items-center gap-3 border-b border-warning-soft bg-warning-soft px-4 py-2 text-aux text-warning"
            role="status"
          >
            <TriangleAlert size={15} aria-hidden />
            <span className="min-w-0 flex-1">离线中，改动先留在本机</span>
            {sync.pending > 0 && <span className="shrink-0 font-medium tabular-nums">{sync.pending} 条待传</span>}
          </div>
        )}

        {status === 'loading' && (
          <p className="sr-only" role="status">
            正在读取数据
          </p>
        )}

        <div className="flex min-h-0 flex-1">
          <main
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
            className="app-main-scroll scrollbar-thin relative min-w-0 flex-1 overflow-y-auto focus:outline-none"
          >
            <div
              data-page={pathname.split('/')[1] || 'dashboard'}
              className="app-page-content mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 pt-5 md:px-7 md:pt-6 xl:px-8"
              style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}
            >
              {children}
            </div>
          </main>
          <AgentDrawer
            open={agentOpen}
            onOpenChange={setAgentOpen}
            initialQuestion={agentQuestion}
            onQuestionConsumed={() => setAgentQuestion(null)}
          />
        </div>
      </div>

      {focusMode && (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          className="fixed right-4 top-4 z-[70] rounded-full border border-line bg-surface px-3.5 py-1.5 text-aux text-ink-2 shadow-[var(--shadow-pop)] transition-colors duration-150 hover:text-ink"
        >
          退出沉浸（Esc）
        </button>
      )}

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onAsk={(q) => {
          setAgentQuestion(q);
          setAgentOpen(true);
        }}
      />
    </div>
  );
}
