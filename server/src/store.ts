/**
 * 记录 ↔ SQLite 行的编解码，以及带归属校验的读写。
 * 安全前提：userId 永远来自会话，绝不取请求体里的值；每条语句都带 userId 条件。
 */
import { TABLE_COLUMNS, quoteCol, quoteTable, type EntityTable } from './schema.ts';
import type { DatabaseSync } from 'node:sqlite';

export type ColumnType = 'text' | 'int' | 'bool' | 'json';

/** id 只做卫生检查（值一律参数绑定）；允许 Unicode 字母，免得拒绝中文 id。 */
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,63}$/u;

const ENUMS: Record<string, string[]> = {
  status: [
    'planned',
    'active',
    'paused',
    'completed',
    'archived',
    'todo',
    'doing',
    'done',
    'cancelled',
    'draft',
    'active',
    'failed',
    'unread',
    'reading',
    'read',
  ],
  priority: ['urgent', 'high', 'medium', 'low'],
  entityType: ['project', 'task', 'experiment', 'reference'],
  readingStatus: ['unread', 'reading', 'read'],
  recurrence: ['none', 'weekly', 'biweekly', 'monthly'],
};

export function isEntityTable(name: string): name is EntityTable {
  return Object.prototype.hasOwnProperty.call(TABLE_COLUMNS, name);
}

export interface OpIssue {
  table: string;
  id: string;
  reason: string;
}

/** 客户端生成的 id 必须是安全字符，长度受限；这是拼进语句前的硬门槛（值本身仍走参数绑定）。 */
export function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

function toColumn(type: ColumnType, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (type === 'bool') return value ? 1 : 0;
  if (type === 'int') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (type === 'json') return JSON.stringify(value ?? null);
  return String(value);
}

function fromColumn(type: ColumnType, value: string | number | null | bigint): unknown {
  if (value === null || value === undefined) return type === 'json' ? [] : null;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (type === 'bool') return num === 1;
  if (type === 'int') return num;
  if (type === 'json') {
    try {
      const parsed = JSON.parse(String(num));
      return parsed ?? [];
    } catch {
      return [];
    }
  }
  return String(num);
}

export function encode(
  table: EntityTable,
  userId: string,
  record: Record<string, unknown>,
): Record<string, string | number | null> {
  const cols = TABLE_COLUMNS[table];
  const out: Record<string, string | number | null> = {};
  for (const [name, type] of Object.entries(cols)) {
    out[name] = toColumn(type, name === 'userId' ? userId : record[name]);
  }
  return out;
}

export function decode(table: EntityTable, row: Record<string, unknown>): Record<string, unknown> {
  const cols = TABLE_COLUMNS[table];
  const out: Record<string, unknown> = {};
  for (const [name, type] of Object.entries(cols)) {
    if (name === 'userId') continue;
    out[name] = fromColumn(type, row[name] as string | number | null | bigint);
  }
  // v2 迁移后列可为 NULL（老客户端写入的），读出去永远是合法枚举
  if (table === 'tasks' && (out.recurrence === null || out.recurrence === undefined)) out.recurrence = 'none';
  return out;
}

/** 结构校验：必填、id 形状、枚举值。返回错误列表，空数组表示通过。 */
export function validateRecord(table: EntityTable, record: Record<string, unknown>): string[] {
  const cols = TABLE_COLUMNS[table];
  const errors: string[] = [];
  if (!validId(record.id)) errors.push('id 形状不合法');
  for (const required of ['createdAt', 'updatedAt']) {
    if (typeof record[required] !== 'number' || !Number.isFinite(record[required]))
      errors.push(`${required} 必须是数字`);
  }
  if ('deletedAt' in record && record.deletedAt !== null && typeof record.deletedAt !== 'number')
    errors.push('deletedAt 只能是数字或 null');
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const value = record[field];
    if (value !== undefined && value !== null && !allowed.includes(String(value)))
      errors.push(`${field} 的值不在允许范围内`);
  }
  for (const [name, type] of Object.entries(cols)) {
    if (name === 'userId' || name === 'id') continue;
    const value = record[name];
    if (value === undefined) continue;
    if (type === 'text' && value !== null && typeof value !== 'string') errors.push(`${name} 应为文字`);
    if (type === 'int' && value !== null && typeof value !== 'number' && typeof value !== 'boolean')
      errors.push(`${name} 应为整数`);
  }
  if (table === 'projects' && !(record.name as string | undefined)?.trim()) errors.push('项目名不能为空');
  if (table === 'tasks' && !(record.title as string | undefined)?.trim()) errors.push('任务标题不能为空');
  return errors;
}

export interface Snapshot {
  [table: string]: Record<string, unknown>[];
}

export function readSnapshot(db: DatabaseSync, userId: string): Snapshot {
  const out: Snapshot = {};
  for (const table of Object.keys(TABLE_COLUMNS) as EntityTable[]) {
    const rows = db.prepare(`SELECT * FROM ${quoteTable(table)} WHERE userId = ?`).all(userId) as Record<
      string,
      unknown
    >[];
    out[table] = rows.map((row) => decode(table, row));
  }
  return out;
}

export type Op =
  | { type: 'put'; table: string; record: Record<string, unknown> }
  | { type: 'patch'; table: string; id: string; changes: Record<string, unknown> }
  | { type: 'delete'; table: string; id: string };

export interface TxResult {
  applied: number;
  skipped: OpIssue[];
  rejected: string[];
}

function owns(db: DatabaseSync, table: EntityTable, id: string, userId: string): boolean {
  return Boolean(db.prepare(`SELECT id FROM ${quoteTable(table)} WHERE id = ? AND userId = ?`).get(id, userId));
}

/**
 * 一个事务里跑完所有操作。
 * 校验不过的 op 记进 rejected 并回滚整笔；指向别人数据的 op 记进 skipped，不动对方一行。
 */
export function applyOps(db: DatabaseSync, userId: string, ops: Op[]): TxResult {
  const skipped: OpIssue[] = [];
  const rejected: string[] = [];
  let applied = 0;

  db.exec('SAVEPOINT rw_apply_ops');
  try {
    for (const op of ops) {
      if (!isEntityTable(op.table)) {
        rejected.push(`未知表 ${op.table}`);
        continue;
      }
      const cols = TABLE_COLUMNS[op.table];

      if (op.type === 'put') {
        const errors = validateRecord(op.table, op.record);
        if (errors.length) {
          rejected.push(`${op.table}: ${errors.join('；')}`);
          continue;
        }
        const row = encode(op.table, userId, op.record);
        const names = Object.keys(row);
        const placeholders = names.map(() => '?').join(', ');
        const exists = db.prepare(`SELECT userId FROM ${quoteTable(op.table)} WHERE id = ?`).get(row.id as string) as
          | { userId: string }
          | undefined;
        if (exists && exists.userId !== userId) {
          skipped.push({ table: op.table, id: String(row.id), reason: '这条记录属于别的账号' });
          continue;
        }
        const assignments = names
          .filter((n) => n !== 'id')
          .map((n) => `${quoteCol(n)} = excluded.${quoteCol(n)}`)
          .join(', ');
        db.prepare(
          `INSERT INTO ${quoteTable(op.table)} (${names.map(quoteCol).join(', ')}) VALUES(${placeholders}) ON CONFLICT(id) DO UPDATE SET ${assignments}`,
        ).run(...names.map((n) => row[n]));
        applied += 1;
        continue;
      }

      if (!validId(op.id)) {
        rejected.push(`${op.table}: id 形状不合法`);
        continue;
      }
      if (!owns(db, op.table, op.id, userId)) {
        skipped.push({ table: op.table, id: op.id, reason: '记录不存在或不属于这个账号' });
        continue;
      }

      if (op.type === 'delete') {
        db.prepare(`DELETE FROM ${quoteTable(op.table)} WHERE id = ? AND userId = ?`).run(op.id, userId);
        applied += 1;
        continue;
      }

      const names = Object.keys(op.changes).filter((n) => n !== 'id' && n !== 'userId' && n in cols);
      if (names.length === 0) {
        skipped.push({ table: op.table, id: op.id, reason: '没有可更新的字段' });
        continue;
      }
      const values = names.map((n) => toColumn(cols[n], op.changes[n]));
      const badEnum = names.find(
        (n) => ENUMS[n] && op.changes[n] !== null && !ENUMS[n].includes(String(op.changes[n])),
      );
      if (badEnum) {
        rejected.push(`${op.table}: ${badEnum} 的值不在允许范围内`);
        continue;
      }
      db.prepare(
        `UPDATE ${quoteTable(op.table)} SET ${names.map((n) => `${quoteCol(n)} = ?`).join(', ')} WHERE id = ? AND userId = ?`,
      ).run(...values, op.id, userId);
      applied += 1;
    }
    if (rejected.length) {
      db.exec('ROLLBACK TO rw_apply_ops; RELEASE rw_apply_ops');
      return { applied: 0, skipped, rejected };
    }
    db.exec('RELEASE rw_apply_ops');
    return { applied, skipped, rejected };
  } catch (error) {
    try {
      db.exec('ROLLBACK TO rw_apply_ops; RELEASE rw_apply_ops');
    } catch {
      /* 已经回滚了 */
    }
    return { applied: 0, skipped, rejected: [`写入失败，整笔已回滚：${(error as Error).message}`] };
  }
}
