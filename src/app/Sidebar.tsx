import { NavLink } from 'react-router-dom';
import {
  BookOpen,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Settings,
  FolderKanban,
  Star,
  Sparkles,
  ShieldCheck,
  Files,
} from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/cx';
import { useData } from '@/state/DataContext';
import { usePrefs, setPrefs } from '@/lib/prefs';
import { BrandMark } from '@/components/brand';
import { useAuth } from '@/state/AuthContext';
import { canManagePlatform, roleLabels } from '@/domain/platform';
import { UserAvatar } from '@/components/shared/user-avatar';

export const NAV_ITEMS = [
  { to: '/', label: '工作台', icon: LayoutDashboard, exact: true },
  { to: '/projects', label: '科研项目', icon: FolderKanban },
  { to: '/tasks', label: '我的任务', icon: ListChecks },
  { to: '/experiments', label: '实验记录', icon: FlaskConical },
  { to: '/library', label: '文献库', icon: BookOpen },
  { to: '/files', label: '科研文件', icon: Files },
  { to: '/ai', label: 'AI 工作室', icon: Sparkles },
];

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { data } = useData();
  const prefs = usePrefs();
  const auth = useAuth();
  const counts: Record<string, number> = {
    '/projects': data.projects.filter((p) => p.deletedAt === null && p.status === 'active').length,
    '/tasks': data.tasks.filter((t) => t.deletedAt === null && (t.status === 'todo' || t.status === 'doing')).length,
    '/experiments': data.experiments.filter((e) => e.deletedAt === null).length,
    '/library': data.references.filter((r) => r.deletedAt === null).length,
  };

  const favorites = useMemo(
    () =>
      data.projects
        .filter((p) => p.deletedAt === null && p.favorite && p.status !== 'archived')
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, 6),
    [data.projects],
  );

  return (
    <div
      data-collapsed={collapsed}
      className={cn('sidebar-surface flex h-full flex-col', collapsed ? 'w-full items-center' : 'w-full')}
    >
      <div className={cn('app-sidebar-brand flex shrink-0 items-center', collapsed ? 'justify-center' : 'gap-3 px-5')}>
        <BrandMark size={collapsed ? 28 : 34} />
        {!collapsed && (
          <div className="min-w-0">
            <span
              className="block truncate text-[19px] font-semibold tracking-[0.08em]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              研序
            </span>
          </div>
        )}
      </div>

      <nav className="scrollbar-thin w-full flex-1 overflow-y-auto px-3 pb-3" aria-label="主导航">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className={item.to === '/ai' ? 'mt-3 border-t border-line pt-3' : undefined}>
              <NavLink
                to={item.to}
                end={item.exact}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'nav-item sidebar-link relative flex items-center gap-3 rounded-control py-2 text-[14px] transition-colors duration-150',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive ? 'font-semibold text-brand-ink' : 'text-ink-2 hover:bg-white/70 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={17}
                      strokeWidth={1.7}
                      aria-hidden
                      className={cn('shrink-0', !isActive && 'opacity-75')}
                    />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && counts[item.to] > 0 && (
                      <span
                        className="shrink-0 text-[12px] tabular-nums text-ink-2"
                        aria-label={`${counts[item.to]} 条`}
                      >
                        {counts[item.to]}
                      </span>
                    )}
                    {!collapsed && isActive && <span className="sr-only">（当前页面）</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        {!collapsed && favorites.length > 0 && (
          <div className="mt-5">
            <button
              type="button"
              className="nav-item flex w-full items-center gap-1.5 rounded-control px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-surface-subtle"
              aria-expanded={!prefs.favoritesCollapsed}
              onClick={() => setPrefs({ favoritesCollapsed: !prefs.favoritesCollapsed })}
            >
              <Star size={12} aria-hidden />
              <span className="flex-1 text-left">收藏项目</span>
              <ChevronDown
                size={13}
                className={cn('transition-transform duration-150', prefs.favoritesCollapsed && '-rotate-90')}
                aria-hidden
              />
            </button>
            {!prefs.favoritesCollapsed && (
              <ul className="mt-0.5 flex flex-col gap-px">
                {favorites.map((p) => (
                  <li key={p.id}>
                    <NavLink
                      to={`/projects/${p.id}`}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'nav-item flex items-center gap-2 rounded-control px-2.5 py-1 text-[13px] transition-colors duration-150',
                          isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-white/70 hover:text-ink',
                        )
                      }
                    >
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-line-strong" />
                      <span className="truncate">{p.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      {/* 底部：用户身份在上，管理入口紧随其下 */}
      <div className={cn('w-full shrink-0 border-t border-line py-2', collapsed ? 'px-2' : 'px-2')}>
        {!collapsed ? (
          <NavLink to="/account" onClick={onNavigate} className="sidebar-footer-link mx-1 mb-2">
            <UserAvatar user={auth.user} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {auth.user?.nickname || auth.user?.email.split('@')[0] || '本地工作空间'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-2">
                {auth.user ? (roleLabels[auth.user.role as keyof typeof roleLabels] ?? '个人账号') : '个人账号与数据'}
              </span>
            </span>
          </NavLink>
        ) : (
          <NavLink
            to="/account"
            title="个人账号"
            onClick={onNavigate}
            className="nav-item mb-1 flex items-center justify-center rounded-control py-2 text-ink-2 hover:bg-surface-subtle"
          >
            <UserAvatar user={auth.user} size={28} />
          </NavLink>
        )}
        {[
          ...(canManagePlatform(auth.user?.role) ? [{ to: '/admin', label: '管理控制台', icon: ShieldCheck }] : []),
          { to: '/settings', label: '设置', icon: Settings },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'nav-item sidebar-link relative flex items-center gap-2.5 rounded-control py-1.5 text-[13.5px] transition-colors',
                collapsed ? 'justify-center px-0' : 'px-2.5',
                isActive ? 'font-semibold text-brand-ink' : 'text-ink-2 hover:bg-surface-subtle hover:text-ink',
              )
            }
          >
            <item.icon size={16} aria-hidden />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
