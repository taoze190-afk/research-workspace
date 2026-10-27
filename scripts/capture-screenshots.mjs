// 为公开 README 截取真实初始界面：独立浏览器，不创建研究记录或模型回答。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromeExecutable } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'images');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'research-public-preview-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let preview, browser;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function verifyCleanPage(page) {
  const text = await page.$eval('body', (body) => body.innerText);
  if (/演示|模拟|示例|测试课题|受试者|腕臂/.test(text)) throw new Error('截图页面包含非初始内容');
  const counts = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('research-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tables = ['projects', 'tasks', 'experiments', 'references'];
      return await Promise.all(
        tables.map(
          (name) =>
            new Promise((resolve, reject) => {
              const request = database.transaction(name).objectStore(name).count();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    } finally {
      database.close();
    }
  });
  if (counts.some((count) => count !== 0)) throw new Error('公开截图工作区不是空白状态');
  if (await page.$('.ai-studio-user, .ai-studio-answer')) throw new Error('公开截图不应包含对话内容');
}
try {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('请先 npm run build');
  fs.mkdirSync(output, { recursive: true });
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  preview = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, API_TARGET: 'http://127.0.0.1:1' },
    },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {
      /* 等待独立预览进程 */
    }
    if (ready) break;
    await pause(100);
  }
  if (!ready) throw new Error('隔离预览启动失败');
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    userDataDir: path.join(temporary, 'browser'),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--force-prefers-reduced-motion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.emulateTimezone('Asia/Shanghai');
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith(base + '/api/'))
      return request.respond({ status: 503, contentType: 'application/json', body: '{"error":"local-preview"}' });
    if ([base, 'data:', 'blob:'].some((prefix) => request.url().startsWith(prefix))) return request.continue();
    return request.abort();
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('rw.mode.v1', 'local');
    const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') || '{}');
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: 'light' }));
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  const start = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '开始使用'),
  );
  if (!start.asElement()) throw new Error('没有找到空白工作区入口');
  await start.asElement().click();
  await start.dispose();
  await page.waitForSelector('#main-content');
  for (const [name, route] of [
    ['dashboard', '/'],
    ['ai-studio', '/ai'],
  ]) {
    await page.goto(base + route, { waitUntil: 'networkidle0' });
    await page.waitForSelector(name === 'dashboard' ? 'nav[aria-label="概览"]' : 'textarea[aria-label="向 AI 提问"]');
    await verifyCleanPage(page);
    await pause(250);
    await page.screenshot({ path: path.join(output, name + '.png') });
  }
  console.log('首页截图已更新：空白工作区，无研究记录、模型配置或对话内容。');
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) {
    const ended = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await ended;
  }
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('research-public-preview-')
  )
    throw new Error('预览临时目录越界');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
