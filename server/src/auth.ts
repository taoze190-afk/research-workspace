/** 口令散列、会话签发与校验、登录限速。只用 node 内置 crypto，不引第三方依赖。 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const now = () => Date.now();
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const newId = () => crypto.randomUUID();

export interface User {
  id: string;
  email: string;
  role: string;
  nickname: string | null;
  createdAt: number;
  aiEnabled: boolean;
  avatarDataUrl?: string | null;
}

/** N=2^14 在 J1900 上约一两百毫秒，够慢到打不动字典，又不会把内存吃紧的机器顶住。 */
function hashPassword(password: string, salt: string): string {
  return crypto
    .scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 })
    .toString('hex');
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function validEmail(input: string): boolean {
  const email = normalizeEmail(input);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validPassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return '密码至少 10 个字符';
  if (password.length > 200) return '密码太长了';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^\w\s]/].filter((re) => re.test(password)).length;
  if (kinds < 2) return '密码请至少包含两类字符（大小写、数字、符号任选两类）';
  return null;
}

export function countUsers(db: DatabaseSync): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
}

export type AuthResult = { ok: true; user: User; token: string } | { ok: false; error: string; status: number };

export function createUser(db: DatabaseSync, emailInput: string, password: string): AuthResult {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email)) return { ok: false, error: '邮箱格式不对', status: 400 };
  const weak = validPassword(password);
  if (weak) return { ok: false, error: weak, status: 400 };
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return { ok: false, error: '这个邮箱已经注册过', status: 409 };

  const user: User = {
    id: newId(),
    email,
    role: countUsers(db) === 0 ? 'owner' : 'member',
    nickname: null,
    createdAt: now(),
    aiEnabled: true,
    avatarDataUrl: null,
  };
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(id, email, passSalt, passHash, role, nickname, createdAt) VALUES(?,?,?,?,?,?,?)').run(
    user.id,
    user.email,
    salt,
    hashPassword(password, salt),
    user.role,
    user.nickname,
    user.createdAt,
  );
  const token = startSession(db, user.id);
  return { ok: true, user, token };
}

/** 恒定形状的比较：先算一次哈希再比，避免把「邮箱不存在」变成可测的时间差。 */
export function verifyPassword(db: DatabaseSync, emailInput: string, password: string): User | null {
  const email = normalizeEmail(emailInput);
  const row = db
    .prepare(
      'SELECT id, email, passSalt, passHash, role, nickname, createdAt, status, aiEnabled, avatarDataUrl FROM users WHERE email = ?',
    )
    .get(email) as
    | {
        id: string;
        email: string;
        passSalt: string;
        passHash: string;
        role: string;
        nickname: string | null;
        createdAt: number;
        status: string;
        aiEnabled: number;
        avatarDataUrl: string | null;
      }
    | undefined;
  const dummySalt = '00000000000000000000000000000000';
  const candidate = hashPassword(password, row?.passSalt ?? dummySalt);
  const expected = row?.passHash ?? candidate;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(expected, 'hex');
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!row || !same || row.status !== 'active') return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    nickname: row.nickname,
    createdAt: row.createdAt,
    aiEnabled: Boolean(row.aiEnabled),
    avatarDataUrl: row.avatarDataUrl,
  };
}

export function startSession(db: DatabaseSync, userId: string, userAgent = ''): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const ts = now();
  db.prepare(
    'INSERT INTO sessions(id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, userAgent) VALUES(?,?,?,?,?,?,?)',
  ).run(newId(), userId, sha256(token), ts, ts, ts + config.sessionTtlMs, userAgent.slice(0, 200));
  return token;
}

export interface SessionedUser extends User {
  sessionId: string;
}

export function sessionUser(db: DatabaseSync, token: string | undefined): SessionedUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS sessionId, s.expiresAt AS expiresAt, s.lastSeenAt AS lastSeenAt,
              u.id AS id, u.email AS email, u.role AS role, u.nickname AS nickname, u.createdAt AS createdAt, u.aiEnabled AS aiEnabled, u.avatarDataUrl AS avatarDataUrl
       FROM sessions s JOIN users u ON u.id = s.userId WHERE s.tokenHash = ? AND u.status = 'active'`,
    )
    .get(sha256(token)) as
    | {
        sessionId: string;
        expiresAt: number;
        lastSeenAt: number;
        id: string;
        email: string;
        role: string;
        nickname: string | null;
        createdAt: number;
        aiEnabled: number;
        avatarDataUrl: string | null;
      }
    | undefined;
  if (!row) return null;
  if (row.expiresAt < now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sessionId);
    return null;
  }
  // 活跃时间只按小时粒度回写，避免每次请求都产生一次磁盘写。
  if (now() - row.lastSeenAt > 3600000)
    db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?').run(now(), row.sessionId);
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    nickname: row.nickname,
    createdAt: row.createdAt,
    sessionId: row.sessionId,
    aiEnabled: Boolean(row.aiEnabled),
    avatarDataUrl: row.avatarDataUrl,
  };
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(sha256(token));
}

// ---------------------------------------------------------------- 账号资料与安全

export function validNickname(input: unknown): string | null {
  if (input === undefined || input === null) return '';
  if (typeof input !== 'string') return null;
  const clean = input.trim().replace(/\s+/g, ' ');
  if (clean.length > 24) return null;
  return clean;
}

export function setNickname(db: DatabaseSync, userId: string, nickname: string): void {
  db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname === '' ? null : nickname, userId);
}

export function verifyCurrentPassword(db: DatabaseSync, userId: string, password: string): boolean {
  const row = db.prepare('SELECT passSalt, passHash FROM users WHERE id = ?').get(userId) as
    | { passSalt: string; passHash: string }
    | undefined;
  if (!row) return false;
  const candidate = Buffer.from(hashPassword(password, row.passSalt), 'hex');
  const expected = Buffer.from(row.passHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** 改密码：新口令过强度校验后重写盐与散列，并吊销除当前会话外的所有登录。 */
export function changePassword(
  db: DatabaseSync,
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): { ok: true; revoked: number } | { ok: false; error: string; status: number } {
  if (!verifyCurrentPassword(db, userId, currentPassword)) return { ok: false, error: '当前密码不对', status: 400 };
  const weak = validPassword(newPassword);
  if (weak) return { ok: false, error: weak, status: 400 };
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET passSalt = ?, passHash = ? WHERE id = ?').run(
    salt,
    hashPassword(newPassword, salt),
    userId,
  );
  const res = db.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?').run(userId, currentSessionId);
  return { ok: true, revoked: Number(res.changes) };
}

export interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export function listSessions(db: DatabaseSync, userId: string, currentSessionId: string): SessionRow[] {
  return (
    db
      .prepare(
        'SELECT id, userAgent, createdAt, lastSeenAt, expiresAt FROM sessions WHERE userId = ? AND expiresAt >= ? ORDER BY lastSeenAt DESC',
      )
      .all(userId, now()) as {
      id: string;
      userAgent: string;
      createdAt: number;
      lastSeenAt: number;
      expiresAt: number;
    }[]
  ).map((row) => ({ ...row, current: row.id === currentSessionId }));
}

/** 吊销指定会话；others = 踢出除当前设备外的全部登录。返回吊销条数。 */
export function revokeSessions(
  db: DatabaseSync,
  userId: string,
  currentSessionId: string,
  sessionId?: string,
  others = false,
): number {
  if (others) {
    const res = db.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?').run(userId, currentSessionId);
    return Number(res.changes);
  }
  if (!sessionId) return 0;
  if (sessionId === currentSessionId) return 0;
  const res = db.prepare('DELETE FROM sessions WHERE userId = ? AND id = ?').run(userId, sessionId);
  return Number(res.changes);
}

export function purgeExpiredSessions(db: DatabaseSync): number {
  const rows = db.prepare('SELECT id FROM sessions WHERE expiresAt < ?').all(now()) as { id: string }[];
  for (const r of rows) db.prepare('DELETE FROM sessions WHERE id = ?').run(r.id);
  return rows.length;
}

// ---------------------------------------------------------------- 登录限速

export interface LockState {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining: number;
}

export function checkLoginAllowed(db: DatabaseSync, key: string): LockState {
  const row = db.prepare('SELECT count, firstAt, lockedUntil FROM loginAttempts WHERE key = ?').get(key) as
    | { count: number; firstAt: number; lockedUntil: number | null }
    | undefined;
  const ts = now();
  if (!row) return { allowed: true, remaining: config.loginMaxAttempts };
  if (row.lockedUntil && row.lockedUntil > ts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((row.lockedUntil - ts) / 1000), remaining: 0 };
  }
  if (ts - row.firstAt > config.loginWindowMs) {
    db.prepare('DELETE FROM loginAttempts WHERE key = ?').run(key);
    return { allowed: true, remaining: config.loginMaxAttempts };
  }
  return {
    allowed: row.count < config.loginMaxAttempts,
    retryAfterSeconds: Math.ceil((row.firstAt + config.loginWindowMs - ts) / 1000),
    remaining: Math.max(0, config.loginMaxAttempts - row.count),
  };
}

export function noteFailedLogin(db: DatabaseSync, key: string): void {
  const ts = now();
  const row = db.prepare('SELECT count, firstAt FROM loginAttempts WHERE key = ?').get(key) as
    | { count: number; firstAt: number }
    | undefined;
  if (!row || ts - row.firstAt > config.loginWindowMs) {
    db.prepare(
      'INSERT INTO loginAttempts(key, count, firstAt, lockedUntil) VALUES(?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET count = 1, firstAt = excluded.firstAt, lockedUntil = NULL',
    ).run(key, 1, ts);
    return;
  }
  const count = row.count + 1;
  const lockedUntil = count >= config.loginMaxAttempts ? ts + config.loginWindowMs : null;
  db.prepare('UPDATE loginAttempts SET count = ?, lockedUntil = ? WHERE key = ?').run(count, lockedUntil, key);
}

export function clearLoginAttempts(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM loginAttempts WHERE key = ?').run(key);
}

// ---------------------------------------------------------------- Cookie

export function buildCookie(token: string): string {
  const parts = [
    `${config.sessionCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export const CLEAR_COOKIE = `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const piece of header.split(';')) {
    const [key, ...rest] = piece.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
