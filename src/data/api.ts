/**
 * 服务端接口客户端。写操作统一带 x-rw-client 头（配合 SameSite=Strict 做 CSRF 双保险）。
 * 服务器地址就是当前站点：前端静态文件与 /api 由同一个域名（1Panel 反代）给出。
 */
import type { Dataset } from '@/domain/types';
import type { PlatformAiConfig, PlatformOverview } from '@/domain/platform';

export interface Op {
  type: 'put' | 'patch' | 'delete';
  table: string;
  id?: string;
  record?: Record<string, unknown>;
  changes?: Record<string, unknown>;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  nickname: string | null;
  aiEnabled?: boolean;
  avatarDataUrl?: string | null;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.method && init.method !== 'GET') headers['x-rw-client'] = 'rw';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      credentials: 'same-origin',
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    throw new ApiError(0, `连不上服务器：${(error as Error).message}`);
  }
  const text = await res.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(res.status, '服务器返回了无法读取的内容，请稍后重试');
  }
  if (!res.ok) throw new ApiError(res.status, String(payload.error ?? `请求失败（${res.status}）`), payload.detail);
  return payload as T;
}

export const api = {
  authOptions: () => request<{ allowSignup: boolean; bootstrap: boolean }>('/api/auth/options'),
  adminOverview: () => request<PlatformOverview>('/api/admin/overview'),
  createUser: (body: { email: string; password: string; role: string }) =>
    request<{ id: string }>('/api/admin/users', { method: 'POST', body }),
  updateUser: (body: { id: string; role?: string; status?: string; aiEnabled?: boolean }) =>
    request<{ ok: boolean }>('/api/admin/users', { method: 'PATCH', body }),
  updatePlatform: (body: { allowSignup?: boolean; ai?: { provider: string; model: string; enabled: boolean } }) =>
    request<{ ok: boolean }>('/api/admin/settings', { method: 'PATCH', body }),
  platformAi: () => request<PlatformAiConfig>('/api/ai/config'),
  testPlatformAi: () => request<{ content: string; model: string }>('/api/admin/ai/test', { method: 'POST' }),
  health: () => request<{ ok: boolean; schemaVersion: number; serverTime: number }>('/api/health'),
  me: () => request<AuthUser & { schemaVersion: number }>('/api/me'),
  login: (email: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/signup', { method: 'POST', body: { email, password } }),
  logout: () => request<{ ok?: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (nickname: string) =>
    request<{ user: AuthUser }>('/api/auth/profile', { method: 'PATCH', body: { nickname } }),
  updateAvatar: (avatarDataUrl: string | null) =>
    request<{ user: AuthUser }>('/api/auth/avatar', { method: 'PATCH', body: { avatarDataUrl } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ revoked: number }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  sessions: () => request<{ sessions: SessionInfo[] }>('/api/auth/sessions'),
  revokeSession: (id: string) =>
    request<{ revoked: number }>('/api/auth/sessions/revoke', { method: 'POST', body: { id } }),
  revokeOtherSessions: () =>
    request<{ revoked: number }>('/api/auth/sessions/revoke', { method: 'POST', body: { others: true } }),
  snapshot: () => request<{ schemaVersion: number; serverTime: number; data: Dataset }>('/api/snapshot'),
  tx: (ops: Op[]) =>
    request<{ applied: number; skipped: { reason: string }[] }>('/api/tx', { method: 'POST', body: { ops } }),
  backup: () => request<{ app: string; schemaVersion: number; exportedAt: string; data: Dataset }>('/api/backup'),
  importBackup: (mode: 'merge' | 'replace', data: Dataset) =>
    request<{ mode: string; written: number }>('/api/backup/import', { method: 'POST', body: { mode, data } }),
  clearDemo: () => request<{ removed: number }>('/api/account/clear-demo', { method: 'POST' }),
};
