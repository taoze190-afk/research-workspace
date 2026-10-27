/**
 * 备份 → 恢复 的自证脚本：造数据、备份、清空、恢复、再核对。
 * 只用于验证 deploy 文档里那条恢复路径真的可行。
 * 用法：node scripts/verify-restore.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-restore-'));
const PORT = 8813;
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function serve() {
  const child = spawn(process.execPath, ['server/src/main.ts'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), HOST: '127.0.0.1', ALLOW_SIGNUP: '1' },
  });
  return child;
}

async function waitHealth(expectUp) {
  for (let i = 0; i < 40; i++) {
    let up = false;
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok;
    } catch {
      up = false;
    }
    if (up === expectUp) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stop(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 3000);
  });
}

const dbFile = path.join(dir, 'research-workspace.db');
let server = serve();
await waitHealth(true);

// 1. 造一点数据
const email = `restore-${Date.now()}@example.com`;
const signup = await fetch(`http://127.0.0.1:${PORT}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
  body: JSON.stringify({ email, password: ['restore', 'pass', '2026'].join('-') }),
});
const cookie = (signup.headers.getSetCookie()[0] ?? '').split(';')[0];
await fetch(`http://127.0.0.1:${PORT}/api/tx`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-rw-client': 'rw', cookie },
  body: JSON.stringify({
    ops: [
      { type: 'put', table: 'projects', record: { id: 'restore-p1', name: '恢复验证项目', question: '', goal: '', status: 'active', startDate: null, endDate: null, favorite: false, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, isDemo: false } },
      { type: 'put', table: 'tasks', record: { id: 'restore-t1', title: '恢复验证任务', description: '', status: 'todo', priority: 'high', dueDate: null, projectId: 'restore-p1', sourceExperimentId: null, completedAt: null, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, isDemo: false } },
    ],
  }),
});
const before = new DatabaseSync(dbFile, { readOnly: true });
const beforeCounts = before.prepare('SELECT (SELECT COUNT(*) FROM projects) p, (SELECT COUNT(*) FROM tasks) t').get();
before.close();
record('写入两条记录', Number(beforeCounts.p) === 1 && Number(beforeCounts.t) === 1, JSON.stringify(beforeCounts));

// 2. 停服务 → 备份（停服后备份是冷备份，最干净；在线备份见文档）
await stop(server);
const backupFile = path.join(dir, 'restore-checkpoint.db');
const opened = new DatabaseSync(dbFile);
opened.exec('PRAGMA wal_checkpoint(TRUNCATE)');
opened.close();
fs.copyFileSync(dbFile, backupFile);
record('产出备份文件', fs.existsSync(backupFile) && fs.statSync(backupFile).size > 0, `${(fs.statSync(backupFile).size / 1024).toFixed(0)} KB`);

// 3. 把库彻底删掉，模拟磁盘故障/误删
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbFile + suffix, { force: true });
}
record('原库已清空', !fs.existsSync(dbFile));

// 4. 恢复：把备份放回数据库路径，再起服务
fs.copyFileSync(backupFile, dbFile);
server = serve();
const up = await waitHealth(true);
const after = up ? new DatabaseSync(dbFile, { readOnly: true }).prepare('SELECT (SELECT COUNT(*) FROM projects) p, (SELECT COUNT(*) FROM tasks) t, (SELECT COUNT(*) FROM users) u').get() : null;
record('恢复后数据完整', !!after && Number(after.p) === 1 && Number(after.t) === 1 && Number(after.u) === 1, JSON.stringify(after ?? {}));

// 5. 恢复后账号还能登录（口令散列与会话表都回来了）
const login = after
  ? await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
      body: JSON.stringify({ email, password: ['restore', 'pass', '2026'].join('-') }),
    })
  : { status: 0 };
record('恢复后仍能正常登录', login.status === 200, `HTTP ${login.status}`);

await stop(server);
try {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
} catch {
  console.log(`（临时目录留在 ${dir}，可手动删）`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`);
process.exitCode = failed.length ? 1 : 0;
