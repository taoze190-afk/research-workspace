import { chromeExecutable } from './browser.mjs';
// 全模块审计截图：每页面 × 浅/深 × 关键交互态，产出 shots/audit/*.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.chrome-profile-audit');
const OUT = path.join(ROOT, 'shots/audit');
const PORT = 4175;
const API_PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = chromeExecutable();

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.rmSync(path.join(ROOT, '.audit-data'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 隔离审计后端：独立数据目录 + 开放注册，不碰用户 8787 的真实库
const backend = spawn(process.execPath, [path.join(ROOT, 'server/src/main.ts')], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, PORT: String(API_PORT), DATA_DIR: path.join(ROOT, '.audit-data'), ALLOW_SIGNUP: '1' },
});
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, API_TARGET: `http://127.0.0.1:${API_PORT}` },
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  args: ['--no-first-run', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('rw.prefs.v1', JSON.stringify({ demoLoadedAt: 1 })));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });

  // 服务器模式登录页：注册一个审计账号并登录
  const loginBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '登录') ?? null);
  if (loginBtn.asElement()) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '注册')?.click());
    await sleep(400);
    await page.type('input[type="email"]', 'audit@test.dev');
    await page.type('input[type="password"]', 'audit-pass-2026');
    await page.click('button[type="submit"]');
    await sleep(2500);
  }

  const demo = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('体验示例')) ?? null);
  if (demo.asElement()) {
    await demo.asElement().click();
    await sleep(1500);
  }

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('shot', name);
  };

  // 浅色全页面
  await shot('light-dashboard');
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999));
  await sleep(300);
  await shot('light-dashboard-bottom');
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));

  // KPI 展开
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('明细'))?.click());
  await sleep(300);
  await shot('light-kpi-expand');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('明细'))?.click());

  // 任务三视图 + 表单
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('light-tasks');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '看板')?.click());
  await sleep(400);
  await shot('light-tasks-board');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '日历')?.click());
  await sleep(400);
  await shot('light-tasks-calendar');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务')?.click());
  await sleep(500);
  await shot('light-task-form');
  await page.keyboard.press('Escape');
  await sleep(300);

  // 项目
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('light-projects');

  // 实验：列表 + 参数表
  await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('light-experiments');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '参数表')?.click());
  await sleep(400);
  await shot('light-experiments-matrix');

  // 文献：三栏 + 选中详情
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('light-library');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('示例条目') || (b.textContent ?? '').includes('综述'))?.click());
  await sleep(500);
  await shot('light-library-detail');
  // 沉浸模式（双击详情面板）
  await page.evaluate(() => document.querySelector('[aria-label="文献详情"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(400);
  await shot('light-library-focus');
  await page.keyboard.press('Escape');
  await sleep(300);

  // 设置
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('light-settings-top');
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999));
  await sleep(300);
  await shot('light-settings-bottom');

  // 协作者新增的三页：AI 工作台 / 账号 / 管理
  await page.goto(`${BASE}/ai`, { waitUntil: 'networkidle2' });
  await sleep(600);
  await shot('light-ai-workspace');
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle2' });
  await sleep(600);
  await shot('light-account');
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' });
  await sleep(600);
  await shot('light-admin');

  // AI 副驾驶（未配置态）
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('AI'))?.click());
  await sleep(500);
  await shot('light-agent');

  // 命令面板 + /（面板唤起依赖焦点，失败不阻断）
  try {
    await page.bringToFront();
    await page.click('main');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(400);
    await page.type('input[aria-label="搜索内容"]', '/');
    await sleep(300);
    await shot('light-palette-slash');
    await page.keyboard.press('Escape');
  } catch (e) {
    console.log('palette 跳过:', String(e && e.message).slice(0, 60));
  }

  // ===== 深色 =====
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') || '{}');
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: 'dark' }));
    document.documentElement.dataset.theme = 'dark';
  });
  await sleep(400);

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await shot('dark-dashboard');
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('dark-tasks');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('dark-library');
  await page.goto(`${BASE}/experiments?view=matrix`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('dark-experiments-matrix');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot('dark-settings');

  // 390 窄屏抽查
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await shot('light-mobile-tasks');
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await shot('light-mobile-library');

  console.log('完成');
} finally {
  await browser.close();
  child.kill();
  backend.kill();
}
