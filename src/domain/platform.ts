export type UserRole = 'owner' | 'admin' | 'member';
export type AccountStatus = 'active' | 'disabled';
export const roleLabels: Record<UserRole, string> = { owner: '平台所有者', admin: '管理员', member: '普通用户' };
export const canManagePlatform = (role?: string) => role === 'owner' || role === 'admin';

export interface ManagedUser {
  id: string;
  email: string;
  nickname: string | null;
  role: UserRole;
  status: AccountStatus;
  aiEnabled: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface AuditEvent {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  createdAt: number;
}

export const MODEL_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyVariable: 'DEEPSEEK_API_KEY' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVariable: 'GEMINI_API_KEY',
  },
  { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyVariable: 'GLM_API_KEY' },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', keyVariable: 'KIMI_API_KEY' },
  { id: 'custom', label: '自定义兼容服务', baseUrl: '', keyVariable: 'AI_API_KEY' },
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]['id'];

export interface PlatformAiConfig {
  provider: ModelProvider;
  model: string;
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  keyVariable: string;
  aiAllowed: boolean;
}

export interface PlatformOverview {
  users: ManagedUser[];
  audit: AuditEvent[];
  allowSignup: boolean;
  ai: PlatformAiConfig;
}
