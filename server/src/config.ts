/** 服务端运行配置。全部走环境变量，1Panel 的 .env 或 systemd EnvironmentFile 直接可用。 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};

const bool = (value: string | undefined, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const config = {
  /** 只绑回环：公网流量一律由 1Panel 的 Nginx 反代进来，这个进程不直接对外。 */
  host: process.env.HOST ?? '127.0.0.1',
  port: int(process.env.PORT, 8787),
  /** SQLite 文件位置。生产要放在持久化目录，别放 /tmp。 */
  dataDir: process.env.DATA_DIR ?? path.join(here, '..', 'data'),
  sessionCookieName: 'rw_session',
  /** 会话有效期，默认 30 天。 */
  sessionTtlMs: int(process.env.SESSION_TTL_DAYS, 30) * 86400000,
  /** 反代在 https 上时设 1，Cookie 才会带 Secure。 */
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  /** 注册开关：库里一个用户都没有时始终放开，之后按这个值。 */
  allowSignup: bool(process.env.ALLOW_SIGNUP, false),
  /** 同一账号+IP 在窗口内允许的失败登录次数。 */
  loginMaxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 10),
  loginWindowMs: int(process.env.LOGIN_WINDOW_MINUTES, 15) * 60000,
  /** 单个请求体上限，防止有人拿大文件打满内存。 */
  maxBodyBytes: int(process.env.MAX_BODY_KB, 8192) * 1024,
  /** 科研文件单独传输，不能复用普通 JSON 的小请求上限。 */
  maxFileBytes: int(process.env.FILE_MAX_MB, 25) * 1024 * 1024,
  fileQuotaBytes: int(process.env.FILE_QUOTA_MB, 500) * 1024 * 1024,
  maxAiBodyBytes: 20 * 1024 * 1024,
  /** 备份文件保留天数（备份脚本用）。 */
  backupKeepDays: int(process.env.BACKUP_KEEP_DAYS, 14),
  /** 只有确认前面是 1Panel 的 Nginx 时才信任 X-Forwarded-For 取真实 IP（限速用）。 */
  trustProxy: bool(process.env.TRUST_PROXY, true),
};

export type Config = typeof config;
