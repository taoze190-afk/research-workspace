// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readState, saveState, isAppUrl, isExternalUrl } = require('../desktop/runtime.cjs');
const modulePath: string = '../desktop/static.mjs';
const { staticPath, serveStatic } = await import(modulePath);
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanxu-desktop-unit-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>研序</title>');
});
afterEach(() => {
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('yanxu-desktop-unit-'))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('Windows 桌面运行边界', () => {
  it('第一次分配端口，重启沿用原访问地址，不接受损坏或非法状态', () => {
    expect(readState(root).port).toBe(0);
    saveState(root, 32123);
    expect(readState(root).port).toBe(32123);
    expect(() => saveState(root, 80)).toThrow();
    fs.writeFileSync(path.join(root, 'desktop-state.json'), '{broken');
    expect(readState(root).port).toBe(0);
    fs.writeFileSync(path.join(root, 'desktop-state.json'), JSON.stringify({ port: '32123' }));
    expect(readState(root).port).toBe(0);
  });
  it('页面只在自身来源内导航，外部只允许普通网页协议', () => {
    expect(isAppUrl('http://127.0.0.1:32123/ai?scope=workspace', 'http://127.0.0.1:32123')).toBe(true);
    for (const url of [
      'http://127.0.0.1:32124/',
      'https://example.com',
      'file:///C:/Windows',
      'javascript:alert(1)',
      'data:text/html,hi',
    ])
      expect(isAppUrl(url, 'http://127.0.0.1:32123')).toBe(false);
    expect(isExternalUrl('https://doi.org/10.1234/test')).toBe(true);
    expect(isExternalUrl('file:///C:/Windows')).toBe(false);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
  });
  it('支持业务深链接，缺失资源和编码路径越界不会读到构建目录以外的文件', () => {
    expect(staticPath(root, '/projects/project-id')).toBe(path.join(root, 'index.html'));
    for (const url of [
      '/assets/missing.js',
      '/desktop.env',
      '/%00',
      '/..%2foutside.txt',
      '/assets/..%2f..%2fdesktop.env',
      '/%5c..%5cdesktop.env',
      '/%invalid',
    ])
      expect(staticPath(root, url)).toBeNull();
  });
  it('静态界面使用正确类型、脚本隔离规则和 HEAD；拒绝非读取方法', async () => {
    const bootstrap = '\nwindow.theme="dark";\n';
    fs.writeFileSync(path.join(root, 'index.html'), '<script>' + bootstrap.replace(/\n/g, '\r\n') + '</script>');
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("test")');
    const server = http.createServer((req, res) => serveStatic(root, req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    try {
      const html = await fetch(base + '/ai');
      expect(html.status).toBe(200);
      expect(html.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(html.headers.get('content-security-policy')).toContain(
        "'sha256-" + crypto.createHash('sha256').update(bootstrap).digest('base64') + "'",
      );
      expect(html.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe-inline'");
      const script = await fetch(base + '/assets/app.js');
      expect(script.headers.get('content-type')).toContain('javascript');
      const head = await fetch(base, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect((await fetch(base, { method: 'POST' })).status).toBe(405);
      expect((await fetch(base + '/assets/missing.js')).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
