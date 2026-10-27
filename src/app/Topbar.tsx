import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  Cloud,
  ChevronRight,
  HardDrive,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  User,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown';
import { DropdownContent, MenuRow } from '@/components/ui/dropdown';
import { NewMenu } from './NewMenu';
import { cn } from '@/lib/cx';
import { useAuth } from '@/state/AuthContext.tsx';
import { flush, useSyncState } from '@/data/sync.ts';
import { useData } from '@/state/DataContext';
import { canManagePlatform } from '@/domain/platform';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { UserAvatar } from '@/components/shared/user-avatar';

function SECTION_OF(pathname: string): string {
  if (pathname === '/') return '工作台';
  if (pathname.startsWith('/projects')) return '科研项目';
  if (pathname.startsWith('/tasks')) return '我的任务';
  if (pathname.startsWith('/experiments')) return '实验记录';
  if (pathname.startsWith('/library')) return '文献库';
  if (pathname.startsWith('/files')) return '科研文件';
  if (pathname.startsWith('/settings')) return '设置';
  if (pathname.startsWith('/ai')) return 'AI 工作室';
  if (pathname.startsWith('/account')) return '个人账号';
  if (pathname.startsWith('/admin')) return '管理控制台';
  return '工作台';
}

/** 数据去向与同步状态：本地模式和自建服务器模式说不一样的话，不拿「已保存」糊弄。 */
function StorageBadge() {
  const auth = useAuth();
  const sync = useSyncState();
  const server = auth.phase === 'signed-in';

  if (!server) {
    return (
      <span className="hidden w-[140px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2 py-[3px] text-aux tabular-nums text-ink-2 xl:inline-flex">
        <HardDrive size={13} aria-hidden />
        保存在此浏览器
      </span>
    );
  }

  const label =
    sync.pending > 0
      ? `${sync.pending} 条待同步`
      : sync.lastError
        ? '同步失败'
        : sync.lastSyncedAt
          ? '已同步'
          : '已连服务器';

  return (
    <span
      className={cn(
        'hidden w-[140px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[3px] text-aux tabular-nums xl:inline-flex',
        sync.pending > 0
          ? 'border-warning-soft bg-warning-soft text-warning'
          : sync.lastError
            ? 'border-danger-soft bg-danger-soft text-danger'
            : 'border-line text-ink-2',
      )}
      role="status"
    >
      <Cloud size={13} aria-hidden />
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
    </span>
  );
}

function AccountMenu() {
  const auth = useAuth();
  const sync = useSyncState();
  const { refresh } = useData();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="账号与同步" className="shrink-0">
          <UserAvatar user={auth.user} size={28} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownContent>
        <div className="px-2 py-1.5">
          <p className="truncate text-body font-medium" title={auth.user?.nickname || auth.user?.email}>
            {auth.user?.nickname?.trim() || auth.user?.email}
          </p>
          <p className="truncate text-aux text-ink-2" title={auth.user?.email}>
            {auth.user?.nickname?.trim()
              ? auth.user.email
              : sync.pending > 0
                ? `${sync.pending} 条待上传`
                : '已全部上传'}
          </p>
        </div>
        <DropdownMenuSeparator />
        <MenuRow
          icon={<RefreshCw size={14} />}
          onSelect={async () => {
            await flush();
            await refresh();
          }}
        >
          立即同步
        </MenuRow>
        <MenuRow icon={<User size={14} />} onSelect={() => navigate('/account')}>
          个人账号
        </MenuRow>
        {canManagePlatform(auth.user?.role) && (
          <MenuRow icon={<Settings size={14} />} onSelect={() => navigate('/admin')}>
            管理控制台
          </MenuRow>
        )}
        <MenuRow icon={<Settings size={14} />} onSelect={() => navigate('/settings')}>
          备份与数据
        </MenuRow>
        <DropdownMenuSeparator />
        <MenuRow icon={<LogOut size={14} />} danger onSelect={() => void auth.signOut()}>
          退出登录
        </MenuRow>
      </DropdownContent>
    </DropdownMenu>
  );
}

export function Topbar({
  onOpenNav,
  onToggleCollapse,
  collapsed,
  onOpenSearch,
  onToggleAgent,
  agentOpen,
}: {
  onOpenNav: () => void;
  onToggleCollapse: () => void;
  collapsed: boolean;
  onOpenSearch: () => void;
  onToggleAgent: () => void;
  agentOpen: boolean;
}) {
  const { pathname } = useLocation();
  const auth = useAuth();
  const prefs = usePrefs();
  const dark =
    prefs.theme === 'dark' ||
    (prefs.theme === 'system' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);

  return (
    <header
      className="app-topbar sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-line bg-surface/92 px-2 backdrop-blur-[8px] md:px-5"
      style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
    >
      <h1 className="sr-only" aria-live="polite">
        {SECTION_OF(pathname)}
      </h1>

      <div className="md:hidden">
        <Button variant="ghost" size="icon" onClick={onOpenNav} aria-label="打开导航">
          <Menu size={18} />
        </Button>
      </div>
      <div className="hidden md:block">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1 text-[14px]">
        <span className="hidden text-ink-2 xl:inline">我的工作空间</span>
        <ChevronRight size={12} className="hidden shrink-0 text-line-strong xl:block" aria-hidden />
        <span className="truncate font-medium">{SECTION_OF(pathname)}</span>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-control border border-line bg-surface-subtle/60 px-2.5 text-aux text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-surface-subtle lg:w-[260px] lg:justify-start',
        )}
        aria-label="全局搜索"
      >
        <Search size={14} aria-hidden />
        <span className="hidden min-w-0 flex-1 truncate text-left lg:inline">搜索项目、任务与研究资料</span>
        <kbd className="hidden shrink-0 rounded border border-line bg-surface px-1 py-px font-sans text-[10px] text-ink-2 lg:inline">
          {isMac ? '⌘' : 'Ctrl'}K
        </kbd>
      </button>

      <StorageBadge />
      <div className="hidden sm:block">
        <Button
          variant="ghost"
          size="icon"
          aria-label={dark ? '切换浅色主题' : '切换深色主题'}
          title={dark ? '切换浅色主题' : '切换深色主题'}
          onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>

      <Button
        variant={agentOpen ? 'primary' : 'secondary'}
        size="icon"
        aria-label="AI 科研副驾驶"
        aria-pressed={agentOpen}
        title="AI 科研副驾驶"
        onClick={onToggleAgent}
        className="shrink-0"
      >
        <Bot size={16} />
      </Button>

      {/* 列表页与工作台的页头都有自己的新建入口，顶栏就不再重复；详情页仍靠顶栏全局新建 */}
      {/^\/(tasks|projects|library|experiments|ai|admin|account|settings)?$/.test(pathname) ? null : <NewMenu />}
      {auth.phase === 'signed-in' || auth.phase === 'offline' ? <AccountMenu /> : null}
    </header>
  );
}
