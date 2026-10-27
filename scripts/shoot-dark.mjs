import { chromeExecutable } from './browser.mjs';
// 深色主题目视走查：起 preview，注入 theme=dark 的偏好与示例数据入口，截三张主页面。
// 用法：node scripts/shoot-dark.mjs   （产物在 shots/states/dark-*.png）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.chrome-profile-dark');
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = chromeExecutable();

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });

const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(BASE);
    if (res.ok) break;
  } catch {
    /* 还没起 */
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  args: ['--no-first-run', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ theme: 'dark', demoLoadedAt: 1 }));
  });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });

  // 空库会先停在欢迎页：点「体验示例」载入演示数据再截
  const demo = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('体验示例')) ?? null);
  const demoEl = demo.asElement();
  if (demoEl) {
    await demoEl.click();
    await new Promise((r) => setTimeout(r, 1200));
  }

  await page.screenshot({ path: path.join(ROOT, 'shots/states/dark-dashboard.png') });
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(ROOT, 'shots/states/dark-tasks.png') });
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(ROOT, 'shots/states/dark-settings.png') });
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`完成，data-theme=${theme}`);
} finally {
  await browser.close();
  child.kill();
}
