// 为公开 README 生成截图：独立浏览器、内置合成数据、本地模拟模型。
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
const mock = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  for await (const _chunk of req) {
    /* 只消费合成数据请求 */
  }
  const actions = {
    action: 'create_tasks',
    items: [
      {
        title: '复核电极贴放与采样条件',
        description: '补齐采集条件、异常样本与复核记录，形成下一轮采集的验收清单。',
        priority: 'high',
      },
      {
        title: '建立留出验证集并检查数据划分',
        description: '先核对样本分组与已有任务，记录划分规则，再进行对照验证。',
        priority: 'medium',
      },
    ],
  };
  const content =
    '先把采集条件与验证流程补齐，再判断是否需要增加实验。\n\n**建议推进两件事**\n\n1. 复核采集条件，将待确认项集中到一份验收清单。\n2. 检查样本分组与留出规则，避免后续验证出现数据混用。\n\n下面的任务沿用当前项目，采纳后会保存到任务模块。\n\n```action\n' +
    JSON.stringify(actions) +
    '\n```';
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]\n\n');
});
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function clickText(page, text) {
  const handle = await page.evaluateHandle(
    (text) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === text),
    text,
  );
  if (!handle.asElement()) throw new Error('没有找到演示入口：' + text);
  await handle.asElement().click();
  await handle.dispose();
}
try {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('请先 npm run build');
  fs.mkdirSync(output, { recursive: true });
  const modelPort = await listen(mock);
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const model = `http://127.0.0.1:${modelPort}`;
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
    { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, API_TARGET: 'http://127.0.0.1:1' } },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {
      /* 等待预览进程 */
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
      return request.respond({ status: 503, contentType: 'application/json', body: '{"error":"local-demo"}' });
    if ([base, model, 'data:', 'blob:'].some((prefix) => request.url().startsWith(prefix))) return request.continue();
    return request.abort();
  });
  await page.evaluateOnNewDocument((model) => {
    localStorage.setItem('rw.mode.v1', 'local');
    const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') || '{}');
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: 'light' }));
    localStorage.setItem(
      'rw.ai.v1',
      JSON.stringify({ enabled: true, model: '演示模型', apiKey: '', baseUrl: model + '/v1' }),
    );
  }, model);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await clickText(page, '体验示例');
  await page.waitForSelector('nav[aria-label="概览"]');
  await pause(4500);
  await page.screenshot({ path: path.join(output, 'dashboard.png') });
  const projectId = await page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const req = indexedDB.open('research-workspace');
      req.onsuccess = () => resolve(req.result);
    });
    const projects = await new Promise((resolve) => {
      const req = database.transaction('projects').objectStore('projects').getAll();
      req.onsuccess = () => resolve(req.result);
    });
    database.close();
    return projects.find((p) => p.name.includes('腕臂')).id;
  });
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  await page.goto(base + '/ai?scope=project:' + projectId + '&workflow=next-steps', { waitUntil: 'networkidle0' });
  await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
  await page.type('textarea[aria-label="向 AI 提问"]', '帮我安排下一步，把需要验证的事项整理成任务。');
  await page.click('[aria-label="发送"]');
  await page.waitForSelector('[aria-label="AI 提议的动作"]');
  await pause(300);
  await page.screenshot({ path: path.join(output, 'ai-studio.png') });
  console.log('已生成首页截图：内置演示数据和模拟模型，未读取真实账号或研究资料。');
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) {
    const ended = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await ended;
  }
  await new Promise((resolve) => mock.close(resolve));
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('research-public-preview-')
  )
    throw new Error('预览临时目录越界');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
