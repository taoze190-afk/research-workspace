import { chromeExecutable } from './browser.mjs';
// 量 UI：行高、列宽、截断、行长、点按区域尺寸。不改代码，只出数字。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, 'shots');
const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });

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
  args: [`--user-data-dir=${path.join(ROOT, '.ui-probe')}`, '--no-first-run', '--force-prefers-reduced-motion', '--hide-scrollbars'],
});
const page = await browser.newPage();

async function open(width, height, route) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
}

// 先确保库里有示例数据
await open(1440, 900, '/');
const seeded = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('体验示例'));
  if (btn) btn.click();
  return !!btn;
});
if (seeded) await new Promise((r) => setTimeout(r, 1500));

const report = {};

// —— 工作台：摘要条、行高、两栏比例、首屏能看到多少内容
await open(1440, 900, '/');
report.dashboard = await page.evaluate(() => {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const nav = document.querySelector('nav[aria-label="概览"]');
  const rows = [...document.querySelectorAll('section[aria-labelledby="today-title"] div[role="checkbox"]')].map((c) => c.closest('div.group'));
  const left = document.querySelector('section[aria-labelledby="today-title"]');
  const right = document.querySelector('section[aria-labelledby="week-title"]');
  const focus = document.querySelector('section[aria-labelledby="focus-title"]');
  return {
    摘要条高: Math.round(rect(nav)?.height ?? 0),
    左栏宽: Math.round(rect(left)?.width ?? 0),
    右栏宽: Math.round(rect(right)?.width ?? 0),
    任务行数: rows.length,
    任务行高: rows.map((r) => Math.round(rect(r)?.height ?? 0)),
    正在推进项目顶边: Math.round(rect(focus)?.top ?? 0),
    视口高: window.innerHeight,
    首屏可见到项目区: rect(focus) ? rect(focus).top < window.innerHeight : false,
  };
});

// —— 看板：标题截断、列宽、列高、行内元素拥挤度
await open(1440, 900, '/tasks?filter=all&view=board');
report.board = await page.evaluate(() => {
  const cols = [...document.querySelectorAll('section[aria-label*="列，"]')];
  const truncated = [];
  for (const c of cols) {
    for (const btn of c.querySelectorAll('button.truncate, span.truncate')) {
      if (btn.scrollWidth > btn.clientWidth + 1) truncated.push({ text: (btn.textContent ?? '').slice(0, 18), sw: btn.scrollWidth, cw: btn.clientWidth });
    }
  }
  return {
    列数: cols.length,
    列宽: cols.map((c) => Math.round(c.getBoundingClientRect().width)),
    列高: cols.map((c) => Math.round(c.getBoundingClientRect().height)),
    截断条目: truncated.length,
    样例: truncated.slice(0, 4),
  };
});

// —— 列表：行高一致性、日期列宽跳动
await open(1440, 900, '/tasks?filter=all');
report.taskList = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.group')].filter((d) => d.querySelector('button[role="checkbox"]'));
  const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
  const chips = rows.map((r) => {
    const chip = [...r.querySelectorAll('span')].find((s) => /天前到期|^今天$|^\d+ 天后/.test(s.textContent ?? ''));
    return chip ? Math.round(chip.getBoundingClientRect().width) : 0;
  }).filter(Boolean);
  return { 行数: rows.length, 行高去重: [...new Set(heights)], 日期徽章宽度去重: [...new Set(chips)] };
});

// —— 实验编辑页：正文行长（可读性）、字段与提示间距
await open(1440, 900, '/experiments');
const expHref = await page.evaluate(() => document.querySelector('a[href^="/experiments/"]')?.getAttribute('href') ?? '/experiments');
await open(1440, 900, expHref);
report.experiment = await page.evaluate(() => {
  const areas = [...document.querySelectorAll('textarea')];
  const widths = areas.map((a) => Math.round(a.getBoundingClientRect().width));
  const fontPx = areas[0] ? parseFloat(getComputedStyle(areas[0]).fontSize) : 0;
  const fields = [...document.querySelectorAll('label')].slice(0, 6).map((l) => {
    const control = l.parentElement?.querySelector('input, textarea, select');
    if (!control) return null;
    return { 标签: (l.textContent ?? '').slice(0, 6), 间距: Math.round(control.getBoundingClientRect().top - l.getBoundingClientRect().bottom) };
  });
  return {
    左栏宽: Math.round(document.querySelector('section.panel')?.getBoundingClientRect().width ?? 0),
    文本域宽度: widths,
    估算每行字符数: fontPx ? Math.round(widths[0] / (fontPx * 0.55)) : 0,
    标签到控件间距: fields.filter(Boolean),
  };
});

// —— 平板与手机：筛选换行、点按区域 <44px 的数量
for (const [key, w, h] of [['tablet768', 768, 1024], ['phone390', 390, 844]]) {
  await open(w, h, '/tasks');
  report[key] = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find((d) => d.querySelector('button[aria-pressed]') && /全部项目/.test(d.textContent ?? ''));
    const tops = new Set();
    if (bar) for (const child of bar.children) tops.add(Math.round(child.getBoundingClientRect().top));
    const small = [...document.querySelectorAll('button, a')]
      .map((b) => ({ r: b.getBoundingClientRect(), tag: b.tagName.toLowerCase(), name: (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 18), cls: String(b.className).split(' ').slice(0, 3).join(' ') }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44));
    const filterRow = document.querySelector('div[role="group"][aria-label="筛选"]');
    // 复选框靠 ::before 扩命中区，getBoundingClientRect 量不到，改用命中测试验
    const hitTest = [...document.querySelectorAll('button[role="checkbox"]')].slice(0, 3).map((c) => {
      const r = c.getBoundingClientRect();
      const px = r.left + r.width / 2;
      const py = r.bottom + 12;
      const hit = document.elementFromPoint(px, Math.min(py, window.innerHeight - 1));
      return { 盒: `${Math.round(r.width)}x${Math.round(r.height)}`, 下方12px命中: hit === c || c.contains(hit ?? null) };
    });
    return {
      筛选栏换行数: tops.size,
      筛选组宽: filterRow ? Math.round(filterRow.getBoundingClientRect().width) : 0,
      小于44px的可点元素: small.length,
      复选框命中区: hitTest,
      明细: small.map((x) => `${x.tag}「${x.name}」${Math.round(x.r.width)}x${Math.round(x.r.height)} ${x.cls}`).slice(0, 12),
      总可点元素: document.querySelectorAll('button, a').length,
    };
  });
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.kill();
