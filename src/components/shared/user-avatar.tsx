import { useState } from 'react';
import { UserRound } from 'lucide-react';
import type { AuthUser } from '@/data/api';
import { cn } from '@/lib/cx';

export function UserAvatar({
  user,
  size = 32,
  className,
}: {
  user?: Pick<AuthUser, 'email' | 'nickname' | 'avatarDataUrl'> | null;
  size?: number;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = user?.avatarDataUrl;
  const name = (user?.nickname?.trim() || user?.email || '').trim();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-brand-soft font-medium text-brand-ink',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.38)) }}
      aria-label={name ? `${name}的头像` : '默认头像'}
      role="img"
    >
      {source && source !== failedSource ? (
        <img src={source} alt="" className="h-full w-full object-cover" onError={() => setFailedSource(source)} />
      ) : name ? (
        name[0].toUpperCase()
      ) : (
        <UserRound size={Math.round(size * 0.52)} aria-hidden />
      )}
    </span>
  );
}
