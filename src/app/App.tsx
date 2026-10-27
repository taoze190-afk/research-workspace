import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppLayout } from './AppLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { DataProvider, useData } from '@/state/DataContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { ToastProvider } from '@/components/ui/toast';
import { WelcomeGate } from '@/features/onboarding/WelcomeGate';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { ExperimentDetailPage } from '@/features/experiments/ExperimentDetailPage';
import { ExperimentsPage } from '@/features/experiments/ExperimentsPage';
import { LibraryPage } from '@/features/library/LibraryPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { NotFoundPage } from '@/features/NotFoundPage';
import { AiWorkspacePage } from '@/features/ai/AiWorkspacePage';
import { AccountPage } from '@/features/account/AccountPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { FilesPage } from '@/features/files/FilesPage';
import { getPrefs, usePrefs } from '@/lib/prefs';
import { applyTheme, onSystemThemeChange, applyBgStyle } from '@/lib/theme';

function AppRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/experiments" element={<ExperimentsPage />} />
        <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ai" element={<AiWorkspacePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </AppLayout>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const auth = useAuth();
  const { data, status } = useData();
  const prefs = usePrefs();

  // 主题跟随设置与系统；'system' 下监听系统切换实时跟随
  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme !== 'system') return undefined;
    return onSystemThemeChange(() => applyTheme('system'));
  }, [prefs.theme]);

  // 页面背景样式跟随设置
  useEffect(() => {
    applyBgStyle(prefs.bgStyle ?? 'nebula');
  }, [prefs.bgStyle]);

  if (auth.phase === 'checking') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-app-bg"
        role="status"
        aria-label="正在检查登录状态"
      >
        <p className="text-body text-ink-2">正在连接…</p>
      </div>
    );
  }

  // 自建服务器模式下，未登录只给登录页；本地镜像里的数据不会被渲染出来
  if (auth.phase === 'signed-out') return <LoginPage />;

  // 首次快照准备好之前不挂载空业务页，避免随后跳转引导页和编辑器状态重建。
  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-app-bg"
        role="status"
        aria-label="正在读取研究资料"
      >
        <p className="text-body text-ink-2">正在读取资料…</p>
      </div>
    );
  }

  const isEmpty = data.projects.length + data.tasks.length + data.experiments.length + data.references.length === 0;
  // 空库时先给一次选择：本地模式和服务器模式都适用（服务器模式下示例会同步进你的账号）
  if (
    status === 'ready' &&
    isEmpty &&
    getPrefs().demoLoadedAt === null &&
    !['/admin', '/account', '/ai', '/files'].includes(pathname)
  )
    return <WelcomeGate />;

  return <AppRoutes />;
}

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <DataProvider>
            <Shell />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
