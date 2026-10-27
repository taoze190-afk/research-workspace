import { chromeExecutable } from './browser.mjs';
// 浏览器走查：真点每个页面，断言界面显示的是库里的真实数据。
// 用法：node scripts/verify.mjs          走查 + 截图
//      node scripts/verify.mjs --shots   只补截图
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PROFILE = path.join(ROOT, '.chrome-profile');
const DOWNLOADS = path.join(ROOT, '.chrome-downloads');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = chromeExecutable();
const onlyShots = process.argv.includes('--shots');

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function startPreview() {
  // 纯本地走查：把 /api 指向必失败端口，避免本机 8787 有后端时被切进服务器模式挡在登录页
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, API_TARGET: 'http://127.0.0.1:1' },
  });
  child.stderr.on('data', (d) => {
    const text = String(d);
    if (!/ENOTFOUND|EADDRINUSE/.test(text)) return;
    console.error('preview stderr:', text.trim());
  });
  return child;
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`预览服务没起来：${url}`);
}

const textOf = (page) => page.evaluate(() => document.body.innerText);

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) => [...document.querySelectorAll(sel)].find((el) => el.textContent.replace(/\s+/g, '') === needle.replace(/\s+/g, '')),
    selector,
    text
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到 ${selector} 里文字为「${text}」的元素`);
  await element.click();
  return true;
}

async function clickContaining(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) => [...document.querySelectorAll(sel)].find((el) => (el.textContent ?? '').includes(needle)),
    selector,
    text
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到 ${selector} 里包含「${text}」的元素`);
  await element.click();
  return true;
}

// Radix 的下拉菜单靠 pointerdown 打开，element.click() 走真实鼠标事件，合成 click() 打不开。
async function clickByAria(page, label) {
  const element = await page.$(`[aria-label="${label}"]`);
  if (!element) throw new Error(`找不到 aria-label="${label}"`);
  await element.click();
  return true;
}

// React 受控输入：直接改 el.value 不会触发 onChange，必须走原生 setter + input 事件。
async function typeInto(page, selector, value, { index = 0 } = {}) {
  const written = await page.evaluate(
    (sel, val, idx) => {
      const el = document.querySelectorAll(sel)[idx];
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selector,
    value,
    index
  );
  if (!written) throw new Error(`找不到输入框 ${selector}[${index}]`);
  return true;
}

async function readNumberChips(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="概览"]');
    if (!nav) return null;
    const out = {};
    for (const link of nav.querySelectorAll('a')) {
      const label = link.querySelector('.stat-label')?.textContent?.trim();
      const value = link.querySelector('.stat-value')?.textContent?.trim();
      if (label && value) out[label] = Number(value);
    }
    return out;
  });
}

const CHECKBOX = 'button[role="checkbox"]';

async function checkOverflow(page, width) {
  return page.evaluate((expected) => {
    const bad = [];
    if (window.innerWidth !== expected) bad.push(`innerWidth=${window.innerWidth} 应为 ${expected}`);
    if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push(`文档横向溢出 ${document.documentElement.scrollWidth}`);
    const inOverlay = (el) => {
      let node = el;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed') return true;
        node = node.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= window.innerWidth + 1) continue;
      // 浮层（toast、菜单、对话框）本来就是 fixed 定位的，不参与页面横向溢出判定
      if (inOverlay(el)) continue;
      if (el.closest('[data-allow-x]')) continue;
      bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} right=${Math.round(rect.right)} w=${Math.round(rect.width)}` + ' | ' + el.outerHTML.slice(0, 140));
    }
    return bad.slice(0, 6);
  }, width);
}

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 860 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
];

const PAGES = [
  ['dashboard', '/'],
  ['projects', '/projects'],
  ['project-detail', null],
  ['tasks', '/tasks'],
  ['tasks-board', '/tasks?view=board'],
  ['experiments', '/experiments'],
  ['experiment-detail', null],
  ['library', '/library'],
  ['settings', '/settings'],
];

async function shoot(page, label, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 400));
  const file = path.join(SHOTS, `${label}.png`).replace(/\\/g, '/');
  await page.screenshot({ path: file });
  return file;
}

async function shootAllViewports(page) {
  const problems = [];
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    for (const [label, route] of PAGES) {
      const target = route ?? (await page.evaluate(() => (window.__firstProject ?? '') + ''));
      if (!target) continue;
      const file = path.join(SHOTS, `${vp.name}-${label}.png`).replace(/\\/g, '/');
      await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: file });
      const overflow = await checkOverflow(page, vp.width);
      if (overflow.length) problems.push(`${vp.name}/${label}: ${overflow.join(' | ')}`);
    }
  }
  return problems;
}

async function main() {
  const server = startPreview();
  await waitForServer(BASE);
  // 走查的前提是「第一次打开」，残留的 IndexedDB 会让它从中间状态开始，所以先清掉整个 profile。
  if (!onlyShots) fs.rmSync(PROFILE, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--force-prefers-reduced-motion',
      '--hide-scrollbars',
      `--allow-file-access`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page
    .createCDPSession()
    .then((cdp) => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }))
    .catch(() => {});

  try {
    if (onlyShots) {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
      const problems = await shootAllViewports(page);
      record('四档视口无横向溢出', problems.length === 0, problems.join(' ; '));
      console.log(JSON.stringify({ shots: fs.readdirSync(SHOTS).length }, null, 2));
      await browser.close();
      server.kill();
      return;
    }

    // 1. 第一次打开：两个入口都在
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    let text = await textOf(page);
    const hasGate = text.includes('开始使用') && text.includes('体验示例');
    record('第一次打开出现「开始使用 / 体验示例」', hasGate, hasGate ? '' : text.slice(0, 120));

    // 2. 载入示例
    if (hasGate) {
      await clickContaining(page, 'button', '体验示例');
      await new Promise((r) => setTimeout(r, 900));
    }
    text = await textOf(page);
    record('示例载入后进入工作台', text.includes('今日任务') && text.includes('正在推进'), text.slice(0, 100));

    // 3. 刷新不重复插入
    const before = await readNumberChips(page);
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    const after = await readNumberChips(page);
    record(
      '刷新后示例数据没有重复插入',
      JSON.stringify(before) === JSON.stringify(after),
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    );

    // 4. 摘要数字来自真实数据（演示库的预期值）
    const expectChips = { 进行中项目: 2, 今日待办: 2, 逾期: 1, 待读文献: 4 };
    const mismatch = Object.entries(expectChips).filter(([k, v]) => after?.[k] !== v).map(([k, v]) => `${k} 期望 ${v} 实得 ${after?.[k]}`);
    record('工作台四个数字与演示库一致', mismatch.length === 0, mismatch.join('；'));

    // 5. 完成那条逾期任务 → 逾期归零 → 撤销恢复
    const chipsBefore = await readNumberChips(page);
    await page.evaluate(() => {
      const box = document.querySelector('button[role="checkbox"][aria-label^="完成「跟进"]');
      box?.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    const chipsAfterDone = await readNumberChips(page);
    const toastText = await textOf(page);
    record('勾选完成后出现可撤销提示', toastText.includes('已完成：'), toastText.slice(0, 40));
    record(
      '完成后逾期数减一',
      (chipsAfterDone?.逾期 ?? -1) === (chipsBefore?.逾期 ?? 0) - 1,
      `${chipsBefore?.逾期} → ${chipsAfterDone?.逾期}`
    );
    await clickContaining(page, 'button', '撤销');
    await new Promise((r) => setTimeout(r, 700));
    const chipsUndone = await readNumberChips(page);
    record(
      '撤销后数字回到原值',
      chipsUndone?.逾期 === chipsBefore?.逾期,
      `${chipsAfterDone?.逾期} → ${chipsUndone?.逾期}`
    );

    // 6. 新建项目 → 加任务 → 完成 → 进度更新 → 刷新仍在
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
    await clickContaining(page, 'button', '新建项目');
    await new Promise((r) => setTimeout(r, 400));
    await typeInto(page, 'form input[type="text"], form input:not([type])', '走查用项目');
    await clickContaining(page, 'form button[type="submit"]', '创建项目');
    await new Promise((r) => setTimeout(r, 900));
    text = await textOf(page);
    const inDetail = text.includes('走查用项目') && text.includes('研究目标');
    record('新建项目后进入详情页', inDetail, text.slice(0, 80));

    const projectId = new URL(page.url()).pathname.split('/').pop();
    await page.evaluate((id) => {
      window.__firstProject = `/projects/${id}`;
    }, projectId);

    await clickContaining(page, 'button', '新建任务');
    await new Promise((r) => setTimeout(r, 400));
    await typeInto(page, '[role="dialog"] input', '走查任务甲');
    await clickContaining(page, '[role="dialog"] button[type="submit"]', '创建任务');
    await new Promise((r) => setTimeout(r, 800));

    await page.evaluate(() => {
      const box = document.querySelector('button[role="checkbox"][aria-label^="完成「走查任务甲"]');
      box?.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    text = await textOf(page);
    record('任务完成后项目进度显示 100%', text.includes('100%'), text.match(/进度[\s\S]{0,40}/)?.[0].replace(/\n/g, ' '));
    record('刷新后走查任务仍在', text.includes('走查任务甲'));

    // 7. 同一文献服务两个项目
    await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    await clickContaining(page, 'ul button', '演示条目：高密度表面肌电握姿分类');
    await new Promise((r) => setTimeout(r, 500));
    text = await textOf(page);
    const twoProjects = text.includes('腕臂式肌电信号采集装置') && text.includes('挥拍前肌电轨迹分析');
    record('一条文献同时关联两个项目', twoProjects, text.match(/关联项目[\s\S]{0,80}/)?.[0].replace(/\n/g, ' '));

    // 8. 实验自动保存 + 刷新仍在
    await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    await clickContaining(page, 'a', '台架基线：静息与最大自主收缩');
    await new Promise((r) => setTimeout(r, 700));
    const marker = `走查自动保存 ${Date.now()}`;
    await typeInto(page, 'textarea', marker, { index: 0 });
    await new Promise((r) => setTimeout(r, 1600));
    text = await textOf(page);
    record('实验编辑后显示已保存', text.includes('已保存'), text.match(/正在保存|已保存|保存失败/)?.[0] ?? '没看到保存状态');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));
    const persisted = await page.evaluate((needle) => [...document.querySelectorAll('textarea')].some((t) => t.value.includes(needle)), marker);
    record('刷新后自动保存的内容还在', persisted, marker);

    // 9. Markdown 预览能渲染且转义了危险内容
    await clickContaining(page, 'button', '预览');
    await new Promise((r) => setTimeout(r, 500));
    const previewHtml = await page.evaluate(() => document.querySelector('.prose-md')?.innerHTML ?? '');
    record('预览渲染出内容', previewHtml.includes('走查自动保存'), previewHtml.slice(0, 60));

    // 10. 深链接与无效 ID
    await page.goto(`${BASE}/experiments/no-such-id`, { waitUntil: 'networkidle2' });
    text = await textOf(page);
    record('无效 ID 给出友好返回', text.includes('找不到这条实验记录'));

    // 11. 搜索 Ctrl+K
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 400));
    await typeInto(page, '[role="dialog"] input', '挥拍');
    await new Promise((r) => setTimeout(r, 500));
    const optionCount = await page.evaluate(() => document.querySelectorAll('[role="option"]').length);
    record('Ctrl+K 呼出搜索并有结果', optionCount > 0, `${optionCount} 条结果`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 600));
    const urlAfterSearch = page.url();
    record('回车打开选中结果', !urlAfterSearch.endsWith('/') && urlAfterSearch !== `${BASE}/`, urlAfterSearch);
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const closedByEsc = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    record('Esc 关闭搜索', closedByEsc);

    // 12. 看板与列表共享筛选、状态菜单可用
    await page.goto(`${BASE}/tasks?filter=overdue&view=board`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    const boardInfo = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('section[aria-label*="列，"]')];
      const pressed = [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim());
      return { columns: sections.length, pressed, rows: document.querySelectorAll('button[role="checkbox"]').length };
    });
    record('看板三列且沿用逾期筛选', boardInfo.columns >= 3, JSON.stringify(boardInfo));

    // 13b. 看板拖拽真的会换列并落库（切到全部任务，把第一张卡拖进「进行中」）
    await page.goto(`${BASE}/tasks?filter=all&view=board`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    const beforeDrag = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label*="列，"]')].map((s) => ({
        label: s.getAttribute('aria-label'),
        rows: s.querySelectorAll('button[role="checkbox"]').length,
      }))
    );
    const dragResult = await page.evaluate(() => {
      const card = document.querySelector('section[aria-label^="待办列"] [draggable="true"]');
      const column = document.querySelector('section[aria-label^="进行中列"]');
      if (!card || !column) return { ok: false, reason: '没找到卡片或目标列' };
      // puppeteer v25 的 CDP 拖拽拦截在这台机器上不可用，这里派发真实 DOM 事件，
      // 走的是应用自己的 dragstart / dragover / drop 处理链。
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      column.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      column.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return { ok: true, payload: dt.getData('text/plain') };
    });
    const dragged = dragResult.ok;
    await new Promise((r) => setTimeout(r, 900));
    const afterDrag = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label*="列，"]')].map((s) => ({
        label: s.getAttribute('aria-label'),
        rows: s.querySelectorAll('button[role="checkbox"]').length,
      }))
    );
    const moved = dragged && beforeDrag?.[0]?.rows === afterDrag?.[0]?.rows + 1 && afterDrag?.[1]?.rows === beforeDrag?.[1]?.rows + 1;
    record('看板拖拽换列并同步保存', moved, dragged ? `${JSON.stringify(beforeDrag)} → ${JSON.stringify(afterDrag)}` : '没找到可拖的卡片或目标列');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));
    const afterReload = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label*="列，"]')].map((s) => s.querySelectorAll('button[role="checkbox"]').length)
    );
    record(
      '拖拽结果刷新后仍在',
      JSON.stringify(afterReload) === JSON.stringify(afterDrag.map((r) => r.rows)),
      `${JSON.stringify(afterDrag.map((r) => r.rows))} vs ${JSON.stringify(afterReload)}`
    );

    // 15. 窄屏列表行：标题必须省略而不是换行顶出或叠到日期上，行高不低于触控下限
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/tasks?filter=all`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    const rowFit = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('div.group')].filter((d) => d.querySelector('button[role="checkbox"]'));
      const bad = [];
      for (const row of rows) {
        const h = Math.round(row.getBoundingClientRect().height);
        const span = row.querySelector('button[title] span');
        if (!span) continue;
        const wrapped = span.scrollHeight > span.clientHeight + 1;
        const clippedButOverflowing = span.scrollWidth > span.clientWidth + 1 && getComputedStyle(span).textOverflow !== 'ellipsis';
        if (h < 44 || wrapped || clippedButOverflowing) {
          bad.push({ h, wrapped, text: (span.textContent ?? '').slice(0, 12) });
        }
      }
      return { rows: rows.length, bad: bad.slice(0, 4) };
    });
    record('390 下列表行不折行、不溢出', rowFit.rows > 0 && rowFit.bad.length === 0, JSON.stringify(rowFit));
    const chipFit = await page.evaluate(() => {
      const group = document.querySelector('div[role="group"][aria-label="筛选"]');
      const chips = group ? [...group.querySelectorAll('button')] : [];
      return { n: chips.length, tall: chips.filter((c) => c.getBoundingClientRect().height > 48).map((c) => `${(c.textContent ?? '').trim()}@${Math.round(c.getBoundingClientRect().height)}`) };
    });
    record('390 下筛选标签不竖排折行', chipFit.n > 0 && chipFit.tall.length === 0, JSON.stringify(chipFit));
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

    // 16. 回收站：删除项目 → 实验与文献不受影响 → 恢复
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    await clickByAria(page, '更多操作');
    await new Promise((r) => setTimeout(r, 500));
    await clickContaining(page, '[role="menu"] [role="menuitem"]', '移到回收站');
    await new Promise((r) => setTimeout(r, 400));
    await clickContaining(page, '[role="dialog"] button', '移到回收站');
    await new Promise((r) => setTimeout(r, 900));
    // 删掉后应用会退回项目列表；再显式访问原地址才该看到友好返回入口
    const backToList = (await textOf(page)).includes('科研项目');
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    const gone = (await textOf(page)).includes('找不到这条项目');
    record('删除项目后退回列表，原地址给出友好返回入口', backToList && gone);
    await page.goto(`${BASE}/experiments`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    text = await textOf(page);
    record('删项目不抹掉实验记录', text.includes('台架基线'));
    await page.goto(`${BASE}/library`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    text = await textOf(page);
    record('删项目不抹掉文献条目', text.includes('演示条目'));

    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    await clickContaining(page, 'li button', '恢复');
    await new Promise((r) => setTimeout(r, 900));
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    text = await textOf(page);
    record('从回收站恢复项目后一切照旧', text.includes('走查用项目') && text.includes('走查任务甲'), text.slice(0, 80));

    // 14. 导出备份并再导入（走真实下载目录）
    const downloadFiles = () => fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.json'));
    const beforeCount = downloadFiles().length;
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    await clickContaining(page, 'button', '导出记录备份');
    await new Promise((r) => setTimeout(r, 1500));
    const newFiles = downloadFiles().filter((f, i) => i >= beforeCount || !f.startsWith('crdownload'));
    const latest = downloadFiles().sort().at(-1);
    record('导出记录备份产出 JSON 文件', downloadFiles().length > beforeCount, `${downloadFiles().length - beforeCount} 个，最新 ${latest ?? '无'}`);

    if (latest) {
      const parsed = JSON.parse(fs.readFileSync(path.join(DOWNLOADS, latest), 'utf8'));
      const counts = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v.length]));
      record(
        '备份含 schemaVersion 与全部实体',
        parsed.schemaVersion === 3 && Array.isArray(parsed.data.projects) && counts.tasks > 0,
        JSON.stringify(counts)
      );
      const badVersion = { ...parsed, schemaVersion: 42 };
      fs.writeFileSync(path.join(DOWNLOADS, 'bad-version.json'), JSON.stringify(badVersion));
      const input = await page.$('input[type="file"]');
      await input.uploadFile(path.join(DOWNLOADS, 'bad-version.json'));
      await new Promise((r) => setTimeout(r, 1200));
      text = await textOf(page);
      record('未知 schemaVersion 被拒绝并说明原因', text.includes('不支持的数据版本 v42'), text.match(/不支持的数据版本[^\n]*/)?.[0] ?? '');
      await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 700));
      const stillThere = (await textOf(page)).includes('走查用项目');
      record('被拒绝的导入没有破坏已有数据库', stillThere);
    }

    // 15. 移动端导航抽屉
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    const hamburgerVisible = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '打开导航');
      return !!btn && btn.getBoundingClientRect().width > 0;
    });
    record('手机宽度有导航按钮', hamburgerVisible);
    if (hamburgerVisible) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '打开导航')?.click());
      await new Promise((r) => setTimeout(r, 500));
      const navOpen = await page.evaluate(() => !!document.querySelector('[aria-label="导航"]'));
      record('手机导航抽屉可打开', navOpen);
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
    }

    // 16. 截图 + 溢出检查
    await page.evaluate((id) => {
      window.__firstProject = `/projects/${id}`;
    }, projectId);
    const experimentId = await page.evaluate(async () => {
      const link = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href')?.startsWith('/experiments/'));
      return link?.getAttribute('href') ?? '';
    });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    PAGES[2][1] = `/projects/${projectId}`;
    PAGES[6][1] = experimentId || '/experiments';
    const problems = await shootAllViewports(page);
    record('四档视口无横向溢出', problems.length === 0, problems.slice(0, 3).join(' ; '));
    record('截图产出', fs.readdirSync(SHOTS).length >= 20, `${fs.readdirSync(SHOTS).length} 张`);

    // 17. 清理走查数据，别污染用户环境
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    await clickContaining(page, 'button', '清除演示数据');
    await new Promise((r) => setTimeout(r, 500));
    await clickContaining(page, '[role="dialog"] button', '只删演示记录');
    await new Promise((r) => setTimeout(r, 1200));
    text = await textOf(page);
    const demoGone = text.includes('库里现在没有演示数据');
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));
    const userKept = (await textOf(page)).includes('走查用项目');
    record('清除演示数据只删演示记录，用户记录仍在', demoGone && userKept, `演示已清=${demoGone} 用户项目在=${userKept}`);
  } catch (error) {
    record('走查脚本异常', false, String(error).slice(0, 300));
  } finally {
    await browser.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n===== 汇总 =====');
  console.log(`通过 ${results.length - failed.length} / ${results.length}`);
  for (const f of failed) console.log(`FAIL  ${f.name} — ${f.detail}`);
  fs.writeFileSync(path.join(ROOT, 'test-results', 'walkthrough.json'), JSON.stringify(results, null, 2));
}

fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
