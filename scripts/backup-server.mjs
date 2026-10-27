/**
 * 服务端 SQLite 在线备份。用 node:sqlite 的 backup()，会带上 WAL 里未落盘的页，
 * 比直接 cp 数据库文件安全（cp 可能拿到一个中间状态）。
 *
 * 用法：
 *   node scripts/backup-server.mjs                     # 用 deploy/research-workspace.env 里的 DATA_DIR
 *   DATA_DIR=/opt/research-workspace/data node scripts/backup-server.mjs
 *   ... node scripts/backup-server.mjs --dest /backup/rw   # 指定输出目录
 *   ... node scripts/backup-server.mjs --keep 30           # 保留天数，覆盖环境变量
 *
 * 1Panel 里挂「计划任务 → Shell 脚本」每天跑一次即可，见 docs/deploy-1panel.md 第 6 步。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile() {
  const envPath = path.join(ROOT, 'deploy', 'research-workspace.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileEnv = readEnvFile();
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const dataDir = process.env.DATA_DIR ?? fileEnv.DATA_DIR ?? path.join(ROOT, 'server', 'data');
const dbFile = path.join(dataDir, 'research-workspace.db');
const destDir = arg('dest') ?? process.env.BACKUP_DIR ?? path.join(dataDir, 'backups');
const keepDays = Number(arg('keep') ?? process.env.BACKUP_KEEP_DAYS ?? fileEnv.BACKUP_KEEP_DAYS ?? 14);

if (!fs.existsSync(dbFile)) {
  console.error(`[备份失败] 找不到数据库文件：${dbFile}`);
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(destDir, `research-workspace-${stamp}.db`);

const source = new DatabaseSync(dbFile);
try {
  // node:sqlite 的 backup(source, destinationFile) 返回 Promise，不是回调形式
  await backup(source, out);
  const size = fs.statSync(out).size;
  const check = new DatabaseSync(out, { readOnly: true });
  const rows = check
    .prepare('SELECT (SELECT COUNT(*) FROM projects) AS p, (SELECT COUNT(*) FROM tasks) AS t, (SELECT COUNT(*) FROM experiments) AS e, (SELECT COUNT(*) FROM "references") AS r, (SELECT COUNT(*) FROM users) AS u')
    .get();
  check.close();
  console.log(`[备份完成] ${out} (${(size / 1024).toFixed(1)} KB) — ${rows.u} 账号 / ${rows.p} 项目 / ${rows.t} 任务 / ${rows.e} 实验 / ${rows.r} 文献`);
} finally {
  source.close();
}

// 只删备份目录里符合命名规则的老文件，别碰其它内容
const cutoff = Date.now() - keepDays * 86400000;
let pruned = 0;
for (const name of fs.readdirSync(destDir)) {
  if (!/^research-workspace-\d{4}-\d{2}-\d{2}T[\d-]+\.db$/.test(name)) continue;
  const full = path.join(destDir, name);
  if (fs.statSync(full).mtimeMs < cutoff) {
    fs.rmSync(full);
    pruned += 1;
  }
}
console.log(`[清理] 删除 ${pruned} 个超过 ${keepDays} 天的备份`);
