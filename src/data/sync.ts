/**
 * 同步层：登录模式下，浏览器里的 IndexedDB 是服务器数据的一份镜像。
 * 写操作先落本地（界面立刻有反馈），再排队发给服务器；服务器确认后清队列。
 * 断网或服务器挂了时改动留在队列里，界面显示「待同步」，不会假装保存成功。
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Table, Transaction } from 'dexie';
import { db, type TableName } from './db.ts';
import { api, type Op } from './api.ts';
import type { Dataset } from '@/domain/types';
import { TABLE_NAMES } from './tables.ts';

export type DataMode = 'local' | 'server';

export interface SyncState {
  mode: DataMode;
  /** 还没被服务器确认的操作数 */
  pending: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  ready: boolean;
}

let state: SyncState = { mode: 'local', pending: 0, lastError: null, lastSyncedAt: null, ready: false };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getSyncState(): SyncState {
  return state;
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSyncState,
    getSyncState
  );
}


/**
 * 待传队列放在 localStorage，不放 IndexedDB。
 * 原因：钩子运行在调用方那条 Dexie 事务的作用域里，而 Dexie 的作用域会跟着 setTimeout
 * 回调一起恢复，所以在钩子里再写另一张 IndexedDB 表必然报「The transaction is not active」。
 * localStorage 是同步 API，不会卷入 IndexedDB 事务；只在事务提交后写入队列，回滚不上传。
 *
 * 队列绑定账号 id：换账号登录时不会把上一个账号没传完的改动塞进新账号。
 */
const QUEUE_KEY = 'rw.queue.v1';
const ACCOUNT_KEY = 'rw.account.v1';
const CHUNK = 500;
let queueOwner: string | null = null;

/** 登录成功时记下账号 id；离线启动时靠它给队列打标，不会把改动错塞给下一个人。 */
export function rememberAccount(id: string) {
  queueOwner = id;
  try {
    localStorage.setItem(ACCOUNT_KEY, id);
  } catch {
    /* 记不住就退回内存里的 queueOwner */
  }
}

export function rememberedAccount(): string | null {
  if (queueOwner) return queueOwner;
  const stored = localStorage.getItem(ACCOUNT_KEY);
  if (stored) queueOwner = stored;
  return stored;
}

/** 登录后由 AuthContext 调用。不清 ACCOUNT_KEY：队列按 owner 打标，同一账号再登录时会继续补传。 */
export function setQueueOwner(owner: string | null) {
  queueOwner = owner;
  if (owner) {
    try {
      localStorage.setItem(ACCOUNT_KEY, owner);
    } catch {
      /* 忽略 */
    }
  }
}

interface QueueFile {
  owner: string;
  ops: Op[];
}

function readQueue(): Op[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueFile;
    if (!parsed || !Array.isArray(parsed.ops)) return [];
    // 不是当前账号攒下的队列，先搁着不动（也不发给现在的人）
    if (queueOwner && parsed.owner !== queueOwner) return [];
    return parsed.ops;
  } catch {
    return [];
  }
}

function writeQueue(ops: Op[]): void {
  try {
    if (ops.length === 0) {
      localStorage.removeItem(QUEUE_KEY);
      return;
    }
    if (!queueOwner) {
      // 没有归属就绝不落盘成"谁的改动"，但一定要说出来，不能静默丢
      set({ lastError: '还没确认账号身份，这次改动没能进入待传队列' });
      return;
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ owner: queueOwner, ops } satisfies QueueFile));
  } catch (error) {
    // 配额满：界面仍然能重试，不会静默当成已保存
    set({ lastError: `待传队列写不进本地存储：${(error as Error).message}` });
  }
}

/**
 * 探测部署形态。模式是有记忆的：一旦确认过「这是一台带服务端的部署」，
 * 之后即使服务器暂时连不上也仍然算服务器模式 —— 否则离线期间的改动不会排队，
 * 等服务器恢复又会被全量覆盖，等于把用户那段时间的工作抹掉。
 */
const MODE_KEY = 'rw.mode.v1';

export function rememberedMode(): DataMode | null {
  const raw = localStorage.getItem(MODE_KEY);
  return raw === 'server' || raw === 'local' ? raw : null;
}

export async function detectMode(): Promise<DataMode> {
  try {
    await api.health();
  } catch {
    const remembered = rememberedMode();
    if (remembered === 'server') {
      set({ mode: 'server', ready: true, lastError: '连不上服务器，改动会先留在这台浏览器里，恢复后自动补传。' });
      return 'server';
    }
    set({ mode: 'local', ready: true });
    return 'local';
  }
  try {
    await api.me();
    localStorage.setItem(MODE_KEY, 'server');
    set({ mode: 'server', ready: true });
    return 'server';
  } catch {
    // 服务器在，但没登录：仍然算服务器模式，界面要挡到登录页
    localStorage.setItem(MODE_KEY, 'server');
    set({ mode: 'server', ready: true });
    return 'server';
  }
}

export function setMode(mode: DataMode) {
  localStorage.setItem(MODE_KEY, mode);
  set({ mode, ready: true, lastError: null });
}

/** 服务器恢复后自动把队列补传上去；传成功后通知调用方回到在线状态。 */
let autoRetryTimer: number | null = null;
export function startAutoRetry(onRecovered?: () => void) {
  if (autoRetryTimer) return;
  autoRetryTimer = window.setInterval(async () => {
    if (state.mode !== 'server') return;
    const queued = readQueue().length;
    if (queued === 0) return;
    if (await flush() && queued > 0) onRecovered?.();
  }, 15000);
}

export function stopAutoRetry() {
  if (autoRetryTimer) window.clearInterval(autoRetryTimer);
  autoRetryTimer = null;
}

export function countPending(): number {
  const n = readQueue().length;
  set({ pending: n });
  return n;
}

/** 由 Dexie 钩子调用：同步落进 localStorage 队列，不碰任何事务。 */
export function enqueue(ops: Op[]): void {
  if (state.mode !== 'server' || ops.length === 0) return;
  const queue = readQueue();
  queue.push(...ops);
  writeQueue(queue);
  set({ pending: queue.length });
}

/**
 * 把队列分批发给服务器。
 * 服务器端每个操作都是幂等的（put 是 upsert、patch 按 id 覆盖、delete 重复执行无副作用），
 * 所以「部分成功后整体重发」是安全的；失败时保留队列，界面显示待同步并可重试。
 */
export async function flush(): Promise<boolean> {
  if (state.mode !== 'server') return true;
  let queue = readQueue();
  if (queue.length === 0) {
    set({ pending: 0, lastError: null });
    return true;
  }
  while (queue.length > 0) {
    const batch = queue.slice(0, CHUNK);
    try {
      const result = await api.tx(batch);
      if (result.skipped?.length) console.warn('[研序] 有操作被服务器跳过', result.skipped);
      queue = queue.slice(batch.length);
      writeQueue(queue);
      set({ pending: queue.length, lastError: null, lastSyncedAt: Date.now() });
    } catch (error) {
      const message = (error as Error).message;
      set({ lastError: message, pending: queue.length });
      return false;
    }
  }
  set({ pending: 0, lastError: null, lastSyncedAt: Date.now() });
  return true;
}

/** 用服务器数据覆盖本地镜像。队列（localStorage）不参与覆盖，未确认的改动不能丢。 */
export async function pull(options?: { replace?: boolean }): Promise<Dataset | null> {
  if (state.mode !== 'server') return null;
  try {
    const { data } = await api.snapshot();
    capturing = false;
    try {
      await db.transaction('rw', db.tables, async () => {
        // replace：先清空镜像再写入。换账号、或队列已全部传上去之后必须走这条，
        // 否则上一个账号的记录会留在同一台浏览器里被下一个人看到。
        if (options?.replace) {
          for (const table of TABLE_NAMES) await db.table(table).clear();
        }
        for (const table of TABLE_NAMES) {
          const rows = (data as unknown as Record<string, { id: string }[]>)[table] ?? [];
          await db.table(table).bulkPut(rows as never[]);
        }
      });
    } finally {
      capturing = true;
    }
    set({ lastSyncedAt: Date.now() });
    return data;
  } catch (error) {
    set({ lastError: (error as Error).message });
    return null;
  }
}

/** 退出登录：抹掉这台浏览器上的镜像。共享设备上不能留残数据。 */
export async function clearMirror(): Promise<void> {
  capturing = false;
  try {
    await db.transaction('rw', db.tables, async () => {
      for (const table of TABLE_NAMES) await db.table(table).clear();
    });
  } finally {
    capturing = true;
  }
  set({ pending: 0, lastSyncedAt: null });
}

/**
 * 捕获本地写入：给每张业务表挂 Dexie 行级钩子，把新建/修改/删除翻译成操作入队。
 * 这样 repository 里二十多处写操作不用逐个改，也不会漏掉某一张表。
 */
let capturing = true;
const pendingTransactions = new WeakMap<Transaction, { owner: string | null; ops: Op[] }>();
function captureAfterCommit(transaction: Transaction, op: Op) {
  if (!capturing || state.mode !== 'server') return;
  let pending = pendingTransactions.get(transaction);
  if (!pending) {
    pending = { owner: queueOwner, ops: [] };
    pendingTransactions.set(transaction, pending);
    const batch = pending;
    transaction.on('complete', () => {
      pendingTransactions.delete(transaction);
      if (batch.owner !== queueOwner) {
        set({ lastError: '账号已切换，原账号的这次改动没有进入新账号的同步队列' });
        return;
      }
      enqueue(batch.ops);
    });
    transaction.on('abort', () => pendingTransactions.delete(transaction));
  }
  pending.ops.push(op);
}

export function installWriteCapture(tables: TableName[]) {
  for (const name of tables) {
    // 给具体记录类型再挂钩子，Dexie 的 hook 重载才能按事件名分辨出来
    const table = db.table(name) as unknown as Table<Record<string, unknown>, string>;
    table.hook('creating', (primKey, obj, transaction) => {
      captureAfterCommit(transaction, { type: 'put', table: name, record: { ...obj, id: String(primKey) } });
    });
    table.hook('updating', (mods, primKey, _obj, transaction) => {
      if (mods && Object.keys(mods).length > 0) {
        captureAfterCommit(transaction, { type: 'patch', table: name, id: String(primKey), changes: mods as Record<string, unknown> });
      }
    });
    table.hook('deleting', (primKey, _obj, transaction) => {
      captureAfterCommit(transaction, { type: 'delete', table: name, id: String(primKey) });
    });
    // 实测 Dexie v4 的行级钩子覆盖 bulkAdd / bulkPut / bulkDelete / where().delete()，
    // 所以这三条就够，不需要再挂 Collection 钩子（v4 也没有 Collection.hook）。
  }
}

/** 登录成功后：先把上一台设备没发出去的东西发走，再拉全量镜像。 */
export async function bootstrap(): Promise<void> {
  await countPending();
  const flushed = await flush();
  // 队列没清空说明还离线，这时不能重建镜像，否则会丢掉没传上去的改动
  await pull({ replace: flushed });
  await countPending();
}

export function useSyncActions() {
  return {
    retry: useCallback(() => flush(), []),
    refresh: useCallback(() => pull(), []),
  };
}
