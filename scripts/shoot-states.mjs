import { chromeExecutable } from './browser.mjs';
// 把「只有用了才会看到」的状态截出来：抽屉、搜索面板、离线横幅、窄屏详情、空状态。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, 'shots', 'states');
fs.mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* 等一下 */
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({
  executablePath: chromeExecutable(),
  headless: true,
  args: [`--user-data-dir=${path.join(ROOT, '.ui-probe')}`, '--no-first-run', '--force-prefers-reduced-motion'],
});
const page = await browser.newPage();
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

async function shot(name, width = 1440, height = 900) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`).replace(/\\/g, '/') });
  console.log('shot', name);
}

const click = async (sel, label) => {
  const ok = await page.evaluate((s, l) => {
    const list = [...document.querySelectorAll(s)];
    const el = l ? list.find((e) => (e.textContent ?? '').replace(/\s+/g, '').includes(l.replace(/\s+/g, ''))) : list[0];
    if (!el) return false;
    el.click();
    return true;
  }, sel, label);
  if (!ok) console.log('  没点到', sel, label ?? '');
  return ok;
};

// 先确保有示例数据
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await settle(800);
await click('button', '体验示例');
await settle(2200);
await shot('01-dashboard');

// 任务详情抽屉
await page.goto(`${BASE}/tasks?filter=all`, { waitUntil: 'networkidle2' });
await settle(700);
await click('div.group button.truncate');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('div.group button')].find((b) => (b.textContent ?? '').trim().length > 4 && !b.className.includes('rounded-full'));
  btn?.click();
});
await settle(700);
await shot('02-task-drawer');
await page.keyboard.press('Escape');
await settle(400);

// 搜索面板（带结果）
await page.keyboard.down('Control');
await page.keyboard.press('KeyK');
await page.keyboard.up('Control');
await settle(400);
await page.evaluate(() => {
  const input = document.querySelector('[role="dialog"] input');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '肌电');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await settle(700);
await shot('03-search');
await page.keyboard.press('Escape');
await settle(300);

// 项目详情
await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
await settle(600);
await page.evaluate(() => document.querySelector('a[href^="/projects/"]')?.click());
await settle(800);
await shot('04-project-overview');
await click('[role="tab"]', '文献');
await settle(600);
await shot('05-project-library');

// 实验编辑 + 预览
await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
await settle(600);
await page.evaluate(() => document.querySelector('a[href^="/experiments/"]')?.click());
await settle(800);
await shot('06-experiment-edit');
await click('button', '预览');
await settle(600);
await shot('07-experiment-preview');

// 文献库选中一条
await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
await settle(600);
await page.evaluate(() => document.querySelector('ul button')?.click());
await settle(700);
await shot('08-library-detail');

// 设置页
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
await settle(700);
await shot('09-settings');

// 平板与手机
await shot('10-dashboard-768', 768, 1024);
await shot('11-library-768', 768, 1024);
await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
await settle(500);
await page.evaluate(() => document.querySelector('ul button')?.click());
await settle(600);
await shot('12-library-detail-390', 390, 844);
await shot('13-settings-390', 390, 844);

// 空状态：清空后看工作台
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
await settle(500);
await click('button', '清除演示数据');
await settle(500);
await click('[role="dialog"] button', '只删演示记录');
await settle(1500);
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await settle(800);
await shot('14-dashboard-empty');

await browser.close();
server.kill();
console.log('完成');
