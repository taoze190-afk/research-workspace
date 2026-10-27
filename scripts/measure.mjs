import { chromeExecutable } from './browser.mjs';
// 定位窄屏下越界的元素：打印标签、class、尺寸和父链。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTE = process.argv[2] ?? '/';
const WIDTH = Number(process.argv[3] ?? 390);

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
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
  args: [`--user-data-dir=${path.join(ROOT, '.chrome-profile')}`, '--no-first-run', '--force-prefers-reduced-motion'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 844, deviceScaleFactor: 1 });

let route = ROUTE;
let alreadyOnPage = false;
if (route === 'exp-click') {
  alreadyOnPage = true;
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  // 空库时先载入示例，保证详情里有可测的内容
  const loaded = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('体验示例'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (loaded) await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const clicked = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href^="/experiments/"]')][0];
    if (!link) return false;
    link.click();
    return true;
  });
  if (!clicked) {
    console.log('实验列表里没有可点的条目');
    await browser.close();
    server.kill();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 700));
} else {
  if (route === 'experiment-detail' || route === 'project-detail') {
  await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
  const ids = await page.evaluate(async () => {
    const open = new Promise((resolve, reject) => {
      const req = indexedDB.open('research-workspace');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const database = await open;
    const store = (name) =>
      new Promise((resolve) => {
        const tx = database.transaction(name, 'readonly');
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result.map((r) => r.id));
      });
    return { experiments: await store('experiments'), projects: await store('projects') };
  });
  route = route === 'experiment-detail' ? `/experiments/${ids.experiments[0]}` : `/projects/${ids.projects[0]}`;
  }
}

if (!alreadyOnPage) await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 600));

const report = await page.evaluate((expected) => {
  const out = { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [] };
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.right <= expected + 1) continue;
    const chain = [];
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      chain.push(`${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(' ').slice(0, 3).join('.')}` : ''}`);
      node = node.parentElement;
    }
    out.offenders.push({
      tag: el.tagName.toLowerCase(),
      aria: el.getAttribute('aria-label'),
      text: (el.textContent ?? '').slice(0, 24),
      html: el.outerHTML.slice(0, 160),
      rect: { left: Math.round(rect.left), right: Math.round(rect.right), w: Math.round(rect.width) },
      parentW: el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().width) : null,
      parentClass: el.parentElement ? String(el.parentElement.className).slice(0, 90) : null,
      chain,
    });
  }
  out.offenders = out.offenders.slice(0, 12);
  return out;
}, WIDTH);

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.kill();
