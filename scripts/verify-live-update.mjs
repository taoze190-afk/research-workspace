import { chromeExecutable } from './browser.mjs';
// 全场景实时更新复现：快速捕获 / 表单 / 项目 / 文献 —— 全部要求「创建后立即可见 + 刷新仍在」
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.chrome-profile-repro');
const PORT = 4178;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = chromeExecutable();

fs.rmSync(PROFILE, { recursive: true, force: true });
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore', env: { ...process.env, API_TARGET: 'http://127.0.0.1:1' },
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: PROFILE, args: ['--no-first-run'], defaultViewport: { width: 1440, height: 900 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const bodyText = (page) => page.evaluate(() => document.body.innerText);

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('rw.prefs.v1', JSON.stringify({ demoLoadedAt: 1 })));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const demo = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('体验示例')) ?? null);
  if (demo.asElement()) { await demo.asElement().click(); await sleep(1500); }

  // 1. 任务页快速捕获（今日筛选下）→ 立即可见
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' }); await sleep(700);
  const m1 = `捕获${Date.now().toString().slice(-5)}`;
  await page.type('input[aria-label="快速捕获任务"]', m1);
  await page.keyboard.press('Enter');
  await sleep(1200);
  check('任务页快速捕获 → 今日列表立即可见', (await bodyText(page)).includes(m1));
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  check('任务页快速捕获 → 刷新后仍在', (await bodyText(page)).includes(m1));

  // 2. 新建任务表单（Ctrl+Enter 提交）
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '新建任务')?.click());
  await sleep(600);
  const m2 = `表单${Date.now().toString().slice(-5)}`;
  const typed2 = await page.evaluate((m) => {
    const input = [...document.querySelectorAll('form input[type="text"], form input:not([type])')].find((i) => i.closest('form'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, m);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, m2);
  if (typed2) {
    await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
    await sleep(1200);
    check('新建任务表单 → 列表立即可见', (await bodyText(page)).includes(m2));
  } else {
    check('新建任务表单 → 找到标题输入框', false, '选择器未命中');
  }

  // 3. 工作台快速捕获 → 今日任务面板立即可见
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' }); await sleep(900);
  const m3 = `台捕${Date.now().toString().slice(-5)}`;
  await page.type('input[aria-label="快速捕获任务"]', m3);
  await page.keyboard.press('Enter');
  await sleep(1400);
  check('工作台捕获 → 今日任务面板立即可见', (await bodyText(page)).includes(m3));

  // 4. 新建项目
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' }); await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('新建项目'))?.click());
  await sleep(600);
  const m4 = `项目${Date.now().toString().slice(-5)}`;
  const typed4 = await page.evaluate((m) => {
    const input = [...document.querySelectorAll('[role="dialog"] input')][0];
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, m);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, m4);
  if (typed4) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '创建项目')?.click());
    await sleep(1800);
    check('新建项目 → 立即可见（详情/列表）', (await bodyText(page)).includes(m4));
  } else {
    check('新建项目 → 找到名称输入框', false, '选择器未命中');
  }

  // 5. 新增文献
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' }); await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('新增条目'))?.click());
  await sleep(600);
  const m5 = `文献${Date.now().toString().slice(-5)}`;
  const typed5 = await page.evaluate((m) => {
    const input = document.querySelector('[role="dialog"] input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, m);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, m5);
  if (typed5) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('保存条目'))?.click());
    await sleep(1400);
    check('新增文献 → 列表立即可见', (await bodyText(page)).includes(m5));
  } else {
    check('新增文献 → 找到标题输入框', false, '选择器未命中');
  }

  // 6. 实验新建（草稿跳详情）
  await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' }); await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('新建实验'))?.click());
  await sleep(1600);
  const onExp = await page.evaluate(() => !!document.querySelector('input[aria-label="实验标题"]'));
  check('新建实验 → 进入编辑页', onExp);

  console.log(`\n汇总: ${results.filter(r => r.ok).length} / ${results.length}`);
  process.exitCode = results.every(r => r.ok) ? 0 : 1;
} finally {
  await browser.close();
  child.kill();
}
