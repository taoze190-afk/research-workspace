// 由独立 Node 24 子进程运行，原有服务端保持兼容网页部署。
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { serveStatic } from './static.mjs';

const dataRoot = process.env.RW_DESKTOP_DATA;
const webRoot = process.env.RW_DESKTOP_WEB;
if (!dataRoot || !webRoot || !fs.existsSync(path.join(webRoot, 'index.html'))) throw new Error('桌面运行文件不完整');
const envFile = path.join(dataRoot, 'desktop.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
// 配置文件不能把本机服务变成公网服务，也不能改变实际数据库位置。
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = path.join(dataRoot, 'data');
process.env.TRUST_PROXY = '0';
process.env.COOKIE_SECURE = '0';
process.env.ALLOW_SIGNUP = '0';
const [{ openDatabase, migrate }, { createRequestHandler }, { purgeExpiredSessions }] = await Promise.all([
  import('../server/src/schema.ts'),
  import('../server/src/http.ts'),
  import('../server/src/auth.ts'),
]);
const db = openDatabase(path.join(process.env.DATA_DIR, 'research-workspace.db'));
migrate(db);
purgeExpiredSessions(db);
const api = createRequestHandler(db);
const server = http.createServer((req, res) => {
  const expectedOrigin = 'http://127.0.0.1:' + server.address().port;
  if (
    req.headers.host !== new URL(expectedOrigin).host ||
    (req.headers.origin && req.headers.origin !== expectedOrigin)
  ) {
    res.writeHead(403);
    res.end('只允许本机应用访问');
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://local').pathname;
  } catch {
    res.writeHead(400);
    res.end('无效请求');
    return;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) void api(req, res);
  else serveStatic(webRoot, req, res);
});
server.on('error', (error) => {
  process.send?.({ type: 'error', code: error.code, message: error.message });
  process.exit(1);
});
const requestedPort = Number(process.env.RW_DESKTOP_PORT || 0);
server.listen(
  Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 0,
  '127.0.0.1',
  () => {
    process.send?.({ type: 'ready', port: server.address().port });
  },
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
  }, 2000).unref();
}
process.on('message', (message) => {
  if (message?.type === 'shutdown') shutdown();
});
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
