/**
 * 研序服务端入口。Node 24 直接跑 TS，部署不需要构建步骤：
 *   node server/src/main.ts
 */
import http from 'node:http';
import path from 'node:path';
import { config } from './config.ts';
import { migrate, openDatabase, LATEST_SCHEMA_VERSION } from './schema.ts';
import { purgeExpiredSessions } from './auth.ts';
import { createRequestHandler } from './http.ts';

const dbFile = path.join(config.dataDir, 'research-workspace.db');
const db = openDatabase(dbFile);
const result = migrate(db);
if (result.applied.length) console.log(`[研序] 数据库迁移完成：${result.from} → ${result.to}（${result.applied.join(', ')}）`);

purgeExpiredSessions(db);
setInterval(() => {
  try {
    const removed = purgeExpiredSessions(db);
    if (removed) console.log(`[研序] 清理了 ${removed} 条过期会话`);
  } catch (error) {
    console.error('[研序] 会话清理失败', error);
  }
}, 3600000).unref();

const server = http.createServer((req, res) => {
  void createRequestHandler(db)(req, res);
});

server.listen(config.port, config.host, () => {
  console.log(`[研序] 接口已启动 http://${config.host}:${config.port} （数据文件 ${dbFile}，结构版本 v${LATEST_SCHEMA_VERSION}）`);
  if (config.allowSignup) console.log('[研序] 注意：ALLOW_SIGNUP=1，任何人都能在这台服务器上注册账号。');
});

const shutdown = (signal: string) => {
  console.log(`[研序] 收到 ${signal}，正在退出`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* 已经关了 */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
