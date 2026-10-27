/**
 * 表结构与迁移。
 * 加新迁移：在 migrations 数组末尾追加一项，version 递增，up 里只写增量 DDL。
 * 已发布的迁移不要改，改了老库不会重放。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

/** 业务表：每一张都必须带 userId，接口层据此做归属校验。列名与客户端记录字段一致，省掉一层映射。 */
export const ENTITY_TABLES = [
  'projects',
  'milestones',
  'tasks',
  'subtasks',
  'experiments',
  'references',
  'tags',
  'entityTags',
  'projectReferences',
] as const;
export type EntityTable = (typeof ENTITY_TABLES)[number];

/** 每张表的列与类型；API 层只按这份白名单拼语句，绝不把外部输入当列名。 */
export const TABLE_COLUMNS: Record<EntityTable, Record<string, 'text' | 'int' | 'bool' | 'json'>> = {
  projects: {
    id: 'text',
    userId: 'text',
    name: 'text',
    question: 'text',
    goal: 'text',
    status: 'text',
    startDate: 'text',
    endDate: 'text',
    favorite: 'bool',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  milestones: {
    id: 'text',
    userId: 'text',
    projectId: 'text',
    title: 'text',
    dueDate: 'text',
    done: 'bool',
    sortOrder: 'int',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  tasks: {
    id: 'text',
    userId: 'text',
    title: 'text',
    description: 'text',
    status: 'text',
    priority: 'text',
    dueDate: 'text',
    projectId: 'text',
    sourceExperimentId: 'text',
    referenceId: 'text',
    completedAt: 'int',
    recurrence: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  subtasks: {
    id: 'text',
    userId: 'text',
    taskId: 'text',
    title: 'text',
    done: 'bool',
    sortOrder: 'int',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  experiments: {
    id: 'text',
    userId: 'text',
    title: 'text',
    experimentDate: 'text',
    projectId: 'text',
    status: 'text',
    purpose: 'text',
    hypothesis: 'text',
    dataSources: 'json',
    method: 'text',
    results: 'text',
    observations: 'text',
    conclusion: 'text',
    nextStep: 'text',
    repoUrl: 'text',
    commit: 'text',
    sourceExperimentId: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  references: {
    id: 'text',
    userId: 'text',
    title: 'text',
    authors: 'text',
    year: 'int',
    venue: 'text',
    doi: 'text',
    url: 'text',
    readingStatus: 'text',
    favorite: 'bool',
    noteQuestion: 'text',
    noteMethod: 'text',
    noteFindings: 'text',
    noteLimits: 'text',
    noteRelevance: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  tags: {
    id: 'text',
    userId: 'text',
    name: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  entityTags: {
    id: 'text',
    userId: 'text',
    tagId: 'text',
    entityType: 'text',
    entityId: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
  projectReferences: {
    id: 'text',
    userId: 'text',
    projectId: 'text',
    referenceId: 'text',
    createdAt: 'int',
    updatedAt: 'int',
    deletedAt: 'int',
    isDemo: 'bool',
  },
};

const baseCols = `id TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
  deletedAt INTEGER, isDemo INTEGER NOT NULL DEFAULT 0`;

const sql = (text: string) => (db: DatabaseSync) => db.exec(text);

export const migrations: Migration[] = [
  // 账号和平台设置不属于科研记录备份，不改变 RECORD_SCHEMA_VERSION。
  {
    version: 1,
    name: 'init',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, passSalt TEXT NOT NULL, passHash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'owner', createdAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, userId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
          createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, userAgent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);

        CREATE TABLE IF NOT EXISTS loginAttempts (
          key TEXT PRIMARY KEY, count INTEGER NOT NULL, firstAt INTEGER NOT NULL, lockedUntil INTEGER
        );
      `);

      sql(`
        CREATE TABLE projects (${baseCols}, name TEXT NOT NULL, question TEXT NOT NULL DEFAULT '',
          goal TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, startDate TEXT, endDate TEXT, favorite INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX idx_projects_user ON projects(userId, deletedAt);

        CREATE TABLE milestones (${baseCols}, projectId TEXT NOT NULL, title TEXT NOT NULL, dueDate TEXT,
          done INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX idx_milestones_user ON milestones(userId, projectId);

        CREATE TABLE tasks (${baseCols}, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL, priority TEXT NOT NULL, dueDate TEXT, projectId TEXT, sourceExperimentId TEXT,
          completedAt INTEGER);
        CREATE INDEX idx_tasks_user ON tasks(userId, deletedAt);
        CREATE INDEX idx_tasks_project ON tasks(userId, projectId);

        CREATE TABLE subtasks (${baseCols}, taskId TEXT NOT NULL, title TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX idx_subtasks_user ON subtasks(userId, taskId);

        CREATE TABLE experiments (${baseCols}, title TEXT NOT NULL DEFAULT '', experimentDate TEXT NOT NULL,
          projectId TEXT, status TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', hypothesis TEXT NOT NULL DEFAULT '',
          dataSources TEXT NOT NULL DEFAULT '[]', method TEXT NOT NULL DEFAULT '', results TEXT NOT NULL DEFAULT '',
          observations TEXT NOT NULL DEFAULT '', conclusion TEXT NOT NULL DEFAULT '', nextStep TEXT NOT NULL DEFAULT '',
          repoUrl TEXT NOT NULL DEFAULT '', "commit" TEXT NOT NULL DEFAULT '', sourceExperimentId TEXT);
        CREATE INDEX idx_experiments_user ON experiments(userId, deletedAt);

        CREATE TABLE "references" (${baseCols}, title TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL DEFAULT '',
          year INTEGER, venue TEXT NOT NULL DEFAULT '', doi TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
          readingStatus TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, noteQuestion TEXT NOT NULL DEFAULT '',
          noteMethod TEXT NOT NULL DEFAULT '', noteFindings TEXT NOT NULL DEFAULT '', noteLimits TEXT NOT NULL DEFAULT '',
          noteRelevance TEXT NOT NULL DEFAULT '');
        CREATE INDEX idx_references_user ON "references"(userId, deletedAt);

        CREATE TABLE tags (${baseCols}, name TEXT NOT NULL);
        CREATE INDEX idx_tags_user ON tags(userId, deletedAt);

        CREATE TABLE entityTags (${baseCols}, tagId TEXT NOT NULL, entityType TEXT NOT NULL, entityId TEXT NOT NULL);
        CREATE INDEX idx_entityTags_user ON entityTags(userId, entityType, entityId);

        CREATE TABLE projectReferences (${baseCols}, projectId TEXT NOT NULL, referenceId TEXT NOT NULL);
        CREATE INDEX idx_projectRefs_user ON projectReferences(userId, projectId);
      `)(db);
    },
  },
  {
    version: 2,
    name: 'task-recurrence',
    // 刻意不加 NOT NULL：老版本客户端还在线时写入的 NULL 由读取侧归一成 'none'，不会让整笔事务被拒
    up: (db) => {
      db.exec('ALTER TABLE tasks ADD COLUMN recurrence TEXT;');
    },
  },
  {
    version: 3,
    name: 'user-nickname',
    // 用户表不在数据备份范围内，这次迁移只影响账号资料，与记录数据版本无关
    up: (db) => {
      db.exec('ALTER TABLE users ADD COLUMN nickname TEXT;');
    },
  },
  {
    version: 4,
    name: 'task-reference',
    // 任务可关联文献；可空外键，读取侧不必归一
    up: (db) => {
      db.exec('ALTER TABLE tasks ADD COLUMN referenceId TEXT;');
    },
  },
  {
    version: 5,
    name: 'platform-accounts-ai-and-audit',
    up: (db) =>
      db.exec(`
      ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE users ADD COLUMN aiEnabled INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE platformAudit (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE aiRequests (id TEXT PRIMARY KEY, userId TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX idx_aiRequests_user_time ON aiRequests(userId, createdAt);
    `),
  },
  {
    version: 6,
    name: 'user-avatar',
    up: (db) => db.exec('ALTER TABLE users ADD COLUMN avatarDataUrl TEXT;'),
  },
  {
    version: 7,
    name: 'research-files',
    up: (db) =>
      db.exec(`
      CREATE TABLE researchFiles (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, mimeType TEXT NOT NULL,
        size INTEGER NOT NULL, sha256 TEXT NOT NULL, projectId TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, data BLOB NOT NULL
      );
      CREATE INDEX idx_researchFiles_user_project ON researchFiles(userId, projectId, updatedAt);
    `),
  },
];

/** 记录（项目/任务/实验/文献…）的数据版本，与客户端 lib/backup.ts 的 SCHEMA_VERSION 对应。 */
export const RECORD_SCHEMA_VERSION = 3;

export const LATEST_SCHEMA_VERSION = migrations.reduce((max, m) => Math.max(max, m.version), 0);

/** references 与 commit 都是 SQL 关键字，表名和列名一律过一层引号。 */
export const quoteTable = (name: string) => (name === 'references' ? '"references"' : name);
export const quoteCol = (name: string) => `"${name.replaceAll('"', '')}"`;

export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL：读不阻塞写；busy_timeout：J1900 上偶发并发写时等一等而不是直接抛错。
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000; PRAGMA foreign_keys = ON;');
  // 版本表要先在，否则读不到版本号会直接抛错（迁移 1 里的那句是幂等重复）。
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  return db;
}

export function appliedVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

/** 顺序重放未执行的迁移，整个过程包在一个事务里：失败就回到升级前。 */
export function migrate(db: DatabaseSync): { from: number; to: number; applied: string[] } {
  const from = appliedVersion(db);
  const applied: string[] = [];
  for (const m of migrations) {
    if (m.version <= from) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare(
        `INSERT INTO meta(key, value) VALUES('schemaVersion', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(m.version));
      db.exec('COMMIT');
      applied.push(`${m.version}:${m.name}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${m.version}:${m.name} 失败：${(error as Error).message}`);
    }
  }
  return { from, to: appliedVersion(db), applied };
}
