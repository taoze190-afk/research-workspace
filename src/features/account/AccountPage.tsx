import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/state/AuthContext';
import { AccountSection } from '@/features/settings/AccountSection';
import { roleLabels, type UserRole } from '@/domain/platform';
import { UserAvatar } from '@/components/shared/user-avatar';

export function AccountPage() {
  const auth = useAuth();
  const user = auth.user;
  return (
    <div className="platform-page account-page">
      <header className="platform-page-heading">
        <div>
          <h2>个人账号</h2>
        </div>
      </header>
      {!user ? (
        <section className="panel p-8">
          <UserRound size={28} className="mb-4 text-brand" />
          <h3 className="text-section">当前使用本地工作台</h3>
          <p className="mt-3 max-w-[54ch] text-aux leading-7 text-ink-2">
            登录服务器账号后，可设置头像、密码和登录设备。
          </p>
          <Link to="/settings" className="mt-5 inline-block text-aux text-brand">
            查看数据与连接设置 →
          </Link>
        </section>
      ) : (
        <div className="account-page-grid">
          <aside className="account-identity panel h-fit p-6">
            <UserAvatar user={user} size={72} />
            <h3 className="mt-5 break-words text-[19px] font-semibold">{user.nickname || '我的科研账号'}</h3>
            <p className="mt-1 break-all text-aux text-ink-2">{user.email}</p>
            <span className="mt-4 inline-flex rounded-full border border-line px-3 py-1 text-[13px] text-brand">
              {roleLabels[user.role as UserRole] ?? '普通用户'}
            </span>
            <div className="mt-6 space-y-4 border-t border-line pt-5 text-[13px] text-ink-2">
              <p className="flex items-center gap-2">
                <ShieldCheck size={15} />
                科研记录按账号隔离
              </p>
              <p className="flex items-center gap-2">
                <KeyRound size={15} />
                平台 AI {user.aiEnabled === false ? '未开通' : '已授权'}
              </p>
            </div>
          </aside>
          <section className="panel min-w-0 overflow-hidden">
            <header className="border-b border-line px-5 py-4">
              <h3 className="platform-card-title">
                <UserRound size={16} />
                资料与安全
              </h3>
            </header>
            <AccountSection />
          </section>
        </div>
      )}
    </div>
  );
}
