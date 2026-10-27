import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const policies = new Map();
function contentPolicy(root) {
  if (!policies.has(root)) {
    // 只允许构建文件内已有的首屏主题脚本；不放开任意内联脚本。
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1].replace(/\r\n?/g, '\n'))
      .filter((body) => body.trim())
      .map((body) => "'sha256-" + crypto.createHash('sha256').update(body).digest('base64') + "'");
    policies.set(
      root,
      `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    );
  }
  return policies.get(root);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};
export function staticPath(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://local').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  const absolute = path.resolve(root, '.' + pathname);
  if (absolute !== path.resolve(root) && !absolute.startsWith(path.resolve(root) + path.sep)) return null;
  // 资源仅来自构建目录；找不到的带扩展名资源返回 404，业务路由交回 React。
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  return path.extname(pathname) || pathname.startsWith('/assets/') ? null : path.join(root, 'index.html');
}
export function serveStatic(root, req, res) {
  const fail = (code) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(code === 404 ? '找不到该文件' : '不支持此请求');
  };
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return fail(405);
  const file = staticPath(root, req.url || '/');
  if (!file) return fail(404);
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return fail(404);
  }
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': contentPolicy(root),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}
