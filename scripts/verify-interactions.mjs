import { chromeExecutable } from './browser.mjs';
// 独立临时浏览器中的交互与布局稳定性走查；保留正常动画和可见滚动条。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'shots/interactions');
fs.mkdirSync(output, { recursive: true });
const width = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 1440);
const baseline = process.argv.includes('--baseline');
const modalOnly = process.argv.includes('--modal-only');
const agentOnly = process.argv.includes('--agent-only');
const outerOnly = process.argv.includes('--outer-only');
const name = `${width}${outerOnly ? '-outer-diagnostic' : baseline ? '-baseline' : ''}`;
const results = [];
const traces = [];
const errors = [];
const record = (label, passed, detail = '') => {
  results.push({ label, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${width}px ${label}${detail ? `: ${detail}` : ''}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const preview = spawn(
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
  { cwd: root, stdio: 'ignore', windowsHide: true },
);
let browser;
let page;

async function clickText(selector, text) {
  const handle = await page.evaluateHandle(
    (s, t) =>
      [...document.querySelectorAll(s)].find((el) => el.textContent.replace(/\s+/g, '') === t.replace(/\s+/g, '')),
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到操作 ${selector}: ${text}`);
  await element.click();
  await handle.dispose();
}

async function closeDialog() {
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await delay(220);
}

async function field(labelText, value) {
  const handle = await page.evaluateHandle((text) => {
    const label = [...document.querySelectorAll('label')].find(
      (el) => el.textContent.trim().replace(/\s*\*$/, '') === text,
    );
    return label ? document.getElementById(label.htmlFor) : null;
  }, labelText);
  const element = handle.asElement();
  if (!element) throw new Error(`找不到字段 ${labelText}`);
  await element.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await element.type(value);
  await handle.dispose();
}

async function fillInput(selector, value) {
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
}

async function scenario(label, action) {
  try {
    await action();
  } catch (error) {
    record(label, false, String(error));
    await page
      .screenshot({ path: path.join(output, `${name}-${label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')}-failure.png`) })
      .catch(() => {});
    for (let i = 0; i < 3 && (await page.$('[role="dialog"], [role="menu"]')); i++) {
      await page.keyboard.press('Escape');
      await delay(200);
    }
  }
}

async function dismissToasts() {
  for (const button of await page.$$('[aria-label="关闭提示"]')) await button.click().catch(() => {});
  await delay(100);
}

async function navTo(route) {
  if (width < 768) {
    await page.click('[aria-label="打开导航"]');
    await page.waitForSelector('[role="dialog"][aria-label="导航"]');
    await page.click(`[role="dialog"][aria-label="导航"] a[href="${route}"]`);
  } else await page.click(`.app-aside a[href="${route}"]`);
  await page.waitForFunction((route) => location.pathname === route, {}, route);
  await delay(250);
}

async function detailedFlows(experiment) {
  await scenario('任务创建与关联选择', async () => {
    await visit('任务新建流程', '/tasks?filter=all');
    await clickText('main button', '新建任务');
    await page.waitForSelector('[role="dialog"]');
    await delay(220);
    await field('标题', `交互验证任务 ${width}`);
    const picker = '[role="combobox"][aria-label="关联实验"]';
    await page.click(picker);
    await page.waitForSelector('[role="option"]');
    const before = await page.$eval('[role="dialog"]', (el) => ({
      y: el.getBoundingClientRect().y,
      height: el.getBoundingClientRect().height,
    }));
    await page.click('[role="option"]');
    await delay(70);
    const after = await page.$eval('[role="dialog"]', (el) => ({
      y: el.getBoundingClientRect().y,
      height: el.getBoundingClientRect().height,
    }));
    record(
      '关联实验选择不改变弹窗高度',
      Math.abs(before.height - after.height) <= 1,
      JSON.stringify({ before, after }),
    );
    await page.click('[role="dialog"] button[type="submit"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.waitForFunction(
      (title) => [...document.querySelectorAll('main button[title]')].some((el) => el.title === title),
      {},
      `交互验证任务 ${width}`,
    );
    record('新建任务真实落库并展示', true);
    await clickText('main button[title]', `交互验证任务 ${width}`);
    await page.waitForSelector('[role="dialog"][aria-label="任务详情"]');
    await delay(240);
    await fillInput('[aria-label="任务标题"]', `交互验证任务已编辑 ${width}`);
    await field('描述', `连续快速修改标题与描述 ${width}`);
    await closeDialog();
    await delay(900);
    await clickText('main button[title]', `交互验证任务已编辑 ${width}`);
    await page.waitForSelector('[role="dialog"][aria-label="任务详情"]');
    await delay(240);
    const saved = await page.evaluate(() => ({
      title: document.querySelector('[aria-label="任务标题"]').value,
      description: document.querySelector('[role="dialog"] textarea')?.value,
    }));
    record(
      '任务快速修改两字段并立即关闭后均保留',
      saved.title === `交互验证任务已编辑 ${width}` && saved.description === `连续快速修改标题与描述 ${width}`,
      JSON.stringify(saved),
    );
    await closeDialog();
    await page.click(`button[aria-label="完成「交互验证任务已编辑 ${width}」"]`);
    await delay(180);
    record(
      '任务完成可切换状态',
      (await page.$(`button[aria-label="把「交互验证任务已编辑 ${width}」标为未完成"]`)) !== null,
    );
    await dismissToasts();
    await shellStable('任务更多菜单开关', async () => {
      await page.click(`button[aria-label="「交互验证任务已编辑 ${width}」的操作"]`);
      await page.waitForSelector('[role="menu"]');
      await delay(160);
      await page.keyboard.press('Escape');
    });
    await page.click(`button[aria-label="「交互验证任务已编辑 ${width}」的操作"]`);
    await page.waitForSelector('[role="menu"]');
    await clickText('[role="menu"] [role="menuitem"]', '移到回收站');
    await page.waitForFunction(
      (title) => ![...document.querySelectorAll('main button[title]')].some((button) => button.title === title),
      {},
      `交互验证任务已编辑 ${width}`,
    );
    record('任务移到回收站后从列表移除', true);
    await clickText('button', '撤销');
    await page.waitForFunction(
      (title) => [...document.querySelectorAll('main button[title]')].some((button) => button.title === title),
      {},
      `交互验证任务已编辑 ${width}`,
    );
    record('任务删除可通过撤销恢复', true);
  });
  await scenario('筛选与任务视图', async () => {
    await visit('任务筛选流程', '/tasks?filter=all');
    await shellStable(
      '任务筛选空结果与恢复',
      async () => {
        await fillInput('[aria-label="搜索任务"]', '不存在的任务');
        await delay(180);
        await fillInput('[aria-label="搜索任务"]', '');
      },
      1000,
    );
    for (const label of ['看板', '日历', '列表']) {
      await shellStable(`任务切换${label}`, () => clickText('[role="group"][aria-label="视图"] button', label));
      record(
        `任务${label}控件保持焦点`,
        await page.evaluate((label) => document.activeElement?.textContent?.trim() === label, label),
      );
    }
    await clickText('[role="group"][aria-label="视图"] button', '日历');
    await page.waitForSelector('[aria-label="下一月"]');
    await shellStable('任务日历切换月份', () => page.click('[aria-label="下一月"]'));
    record('任务日历下一月可返回', (await page.$('[aria-label="上一月"]')) !== null);
  });
  await scenario('文献创建与笔记', async () => {
    await visit('文献筛选流程', '/library');
    await shellStable(
      '文献搜索空结果与恢复',
      async () => {
        await fillInput('[aria-label="搜索文献"]', '不存在的文献');
        await delay(180);
        await fillInput('[aria-label="搜索文献"]', '');
      },
      1000,
    );
    await clickText('main button', '新增条目');
    await page.waitForSelector('[role="dialog"]');
    await delay(220);
    await field('标题', `交互验收文献 ${width}`);
    await page.click('[role="dialog"] button[type="submit"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.waitForSelector('[aria-label="文献详情"]');
    const focusUrl = page.url();
    record(
      '文献创建并打开详情',
      await page.$eval('[aria-label="文献详情"]', (el) => el.textContent.includes('交互验收文献')),
    );
    await dismissToasts();
    await page.click('[aria-label="条目操作"]');
    await page.waitForSelector('[role="menu"]');
    await clickText('[role="menu"] [role="menuitem"]', '移到回收站');
    await page.waitForSelector('[role="dialog"]');
    await delay(220);
    await clickText('[role="dialog"] button', '取消');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    record(
      '文献删除确认取消保留当前记录',
      await page.$eval('[aria-label="文献详情"]', (el) => el.textContent.includes('交互验收文献')),
    );
    await field('研究问题', `界面稳定性观察 ${width}`);
    await page.evaluate(() =>
      document
        .querySelector('[aria-label="文献详情"] textarea')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    record(
      '双击文献编辑内容不隐藏应用框架',
      await page.evaluate(() => !document.documentElement.classList.contains('focus-mode')),
    );
    await navTo('/projects');
    await delay(750);
    await page.goto(focusUrl, { waitUntil: 'networkidle0' });
    const note = await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find((el) => el.textContent.trim() === '研究问题');
      return document.getElementById(label?.htmlFor)?.value;
    });
    record('文献笔记快速离开后保留', note === `界面稳定性观察 ${width}`, String(note));
  });
  await scenario('实验编辑与预览', async () => {
    await visit('实验编辑流程', experiment);
    await fillInput('[aria-label="实验标题"]', `交互编辑实验 ${width}`);
    await page.evaluate(() =>
      document.querySelector('[aria-label="方法与步骤"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    record(
      '双击实验编辑内容不隐藏应用框架',
      await page.evaluate(() => !document.documentElement.classList.contains('focus-mode')),
    );
    await clickText('main button', '预览');
    record(
      '实验预览使用当前输入草稿',
      await page.$eval('main .page-title', (el) => el.textContent.includes('交互编辑实验')),
    );
    await clickText('main button', '继续编辑');
    await navTo('/experiments');
    await delay(850);
    await page.goto(base + experiment, { waitUntil: 'networkidle0' });
    record(
      '实验快速离开保存当前记录',
      (await page.$eval('[aria-label="实验标题"]', (el) => el.value)) === `交互编辑实验 ${width}`,
    );
  });
  await scenario('导航与滚动位置', async () => {
    await visit('导航滚动流程', '/settings');
    await page.$eval('#main-content', (el) => {
      el.scrollTop = el.scrollHeight;
    });
    await navTo('/tasks');
    record('切换新页面从顶部开始', (await page.$eval('#main-content', (el) => el.scrollTop)) <= 1);
    await visit('同页操作滚动流程', '/tasks?filter=all');
    await page.$eval('#main-content', (el) => {
      el.scrollTop = 80;
    });
    const start = await page.$eval('#main-content', (el) => el.scrollTop);
    await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="筛选"] button')]
        .find((button) => button.textContent.includes('全部'))
        ?.click(),
    );
    await delay(160);
    record('同页筛选不无故回到顶部', Math.abs((await page.$eval('#main-content', (el) => el.scrollTop)) - start) <= 1);
    await page.$eval('#main-content', (el) => {
      el.scrollTop = 60;
    });
    const before = await page.$eval('#main-content', (el) => el.scrollTop);
    const task = await page.$('main .group button[title]');
    await task.click();
    await page.waitForSelector('[role="dialog"]');
    await delay(220);
    await closeDialog();
    record(
      '任务抽屉关闭保持列表滚动位置',
      Math.abs((await page.$eval('#main-content', (el) => el.scrollTop)) - before) <= 1,
    );
    if (width >= 768) {
      await page.click('[aria-label="收起侧栏"]');
      await delay(250);
      record('侧栏收起后主区域仍可用', (await page.$eval('#main-content', (el) => el.clientWidth)) > width - 100);
      await page.click('[aria-label="展开侧栏"]');
      await delay(250);
      record(
        '侧栏可恢复展开',
        (await page.$eval('.app-aside', (el) => Math.round(el.getBoundingClientRect().width))) === 240,
      );
    }
  });
}

async function startTrace(label, selectors, ms = 700) {
  await page.evaluate(
    ({ selectors, ms }) => {
      const start = performance.now();
      window.__traceDone = false;
      window.__motionFrames = [];
      window.__traceStart = start;
      const tick = () => {
        const frame = { time: Math.round(performance.now() - start), nodes: {} };
        for (const [key, selector] of Object.entries(selectors)) {
          const el = document.querySelector(selector);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          frame.nodes[key] = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            scrollTop: el.scrollTop,
            translate: style.translate,
            transform: style.transform,
            animation: style.animationName,
          };
        }
        window.__motionFrames.push(frame);
        if (performance.now() - start < ms) requestAnimationFrame(tick);
        else window.__traceDone = true;
      };
      requestAnimationFrame(tick);
    },
    { selectors, ms },
  );
  return async () => {
    await page.waitForFunction(() => window.__traceDone);
    const data = await page.evaluate(() => ({
      frames: window.__motionFrames,
      shifts: window.__layoutShifts.filter((shift) => shift.time >= window.__traceStart),
    }));
    traces.push({ label, ...data });
    return data;
  };
}

function spread(trace, key, dimension) {
  const values = trace.frames.map((f) => f.nodes[key]?.[dimension]).filter(Number.isFinite);
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

async function shellStable(label, action, ms = 700) {
  const done = await startTrace(
    label,
    { main: '#main-content', heading: '.page-head', sidebar: '.app-aside', topbar: '.app-topbar' },
    ms,
  );
  await action();
  const trace = await done();
  const move = Math.max(
    spread(trace, 'main', 'x'),
    spread(trace, 'main', 'width'),
    spread(trace, 'main', 'clientWidth'),
    spread(trace, 'heading', 'x'),
    spread(trace, 'heading', 'width'),
  );
  record(`${label} 框架无意外水平位移`, move <= 1, `${move.toFixed(2)}px`);
  return trace;
}

async function visit(label, route) {
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main-content');
  await delay(120);
  const layout = await page.evaluate(() => {
    const main = document.querySelector('#main-content');
    return {
      horizontal: main.scrollWidth <= main.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
      bodyWidth: document.body.clientWidth,
      viewport: innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      viewportHeight: innerHeight,
      mainGutter: main.offsetWidth - main.clientWidth,
      mainScrollable: main.scrollHeight > main.clientHeight + 1,
    };
  });
  record(`${label} 无页面横向溢出`, layout.horizontal, JSON.stringify(layout));
  if (!baseline && !outerOnly)
    record(
      `${label} 仅主内容滚动`,
      layout.documentHeight <= layout.viewportHeight + 1,
      `${layout.documentHeight}/${layout.viewportHeight}`,
    );
}

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await delay(150);
  }
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-features=OverlayScrollbar'],
  });
  record(
    '测试保留可见滚动条及正常动画',
    !browser.process().spawnargs.includes('--hide-scrollbars') &&
      !browser.process().spawnargs.some((arg) => arg.includes('prefers-reduced-motion')),
  );
  page = await browser.newPage();
  await page.setViewport({ width, height: width < 1000 ? 900 : 1000, deviceScaleFactor: 1 });
  await page.emulateTimezone('Asia/Shanghai');
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    window.__layoutShifts = [];
    new PerformanceObserver((list) => {
      for (const item of list.getEntries())
        window.__layoutShifts.push({
          time: item.startTime,
          value: item.value,
          hadRecentInput: item.hadRecentInput,
          sources: item.sources.map((source) => ({
            node: source.node?.className?.toString()?.slice(0, 180),
            previousRect: source.previousRect.toJSON(),
            currentRect: source.currentRect.toJSON(),
          })),
        });
    }).observe({ type: 'layout-shift', buffered: true });
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '* { scrollbar-width: auto !important; } ::-webkit-scrollbar { width: 14px; height: 14px; }';
      document.head.append(style);
    });
  });
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.url().includes('/api/')
      ? request.respond({ status: 503, contentType: 'application/json', body: '{"error":"isolated-ui-preview"}' })
      : request.continue(),
  );
  await page.goto(base, { waitUntil: 'networkidle0' });
  await clickText('button', '体验示例');
  await page.waitForSelector('nav[aria-label="概览"]');
  const project = await page.$eval('main a[href^="/projects/"]', (el) => el.getAttribute('href'));
  const experiment = await page.$eval('main a[href^="/experiments/"]', (el) => el.getAttribute('href'));
  if (outerOnly) {
    for (const route of ['/tasks?filter=all', '/settings', experiment]) {
      await visit('外层滚动诊断', route);
      const detail = await page.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            tag: el.tagName,
            cls: el.className?.toString().slice(0, 180),
            y: r.y,
            height: r.height,
            bottom: r.bottom,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: s.overflowY,
            position: s.position,
          };
        };
        return {
          html: rect(document.documentElement),
          body: rect(document.body),
          root: rect(document.getElementById('root')),
          overflow: [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().bottom > innerHeight + 1 && !el.closest('#main-content'))
            .map(rect)
            .slice(0, 25),
          main: rect(document.querySelector('#main-content')),
        };
      });
      traces.push({ label: '外层滚动诊断', route, detail });
      console.log(JSON.stringify({ route, ...detail }));
      await page.$eval('#main-content', (el) => {
        el.style.position = 'relative';
      });
      const positioned = await page.evaluate(() => ({
        htmlHeight: document.documentElement.scrollHeight,
        bodyWidth: document.body.clientWidth,
      }));
      traces.push({ label: 'main设置relative对照', route, positioned });
      console.log(JSON.stringify({ route, positioned }));
    }
  } else {
    if (baseline && modalOnly) {
      await visit('任务滚动条基线', '/tasks?filter=all');
      await shellStable(
        '任务筛选切换滚动条',
        async () => {
          await page.type('[aria-label="搜索任务"]', '不存在的结果');
          await delay(170);
          await page.click('[aria-label="搜索任务"]', { clickCount: 3 });
          await page.keyboard.press('Backspace');
        },
        1000,
      );
    }
    await visit('项目', '/projects');
    if (!modalOnly) {
      await shellStable('AI副驾驶打开', async () => {
        await page.click('[aria-label="AI 科研副驾驶"]');
        await delay(250);
      });
      await page.screenshot({ path: path.join(output, `${name}-agent-open.png`) });
      const modalClose = await page.$(
        '[role="dialog"][aria-label="AI 科研副驾驶"] button[aria-label="收起 AI 面板"], [role="dialog"][aria-label="AI 科研副驾驶"] button[aria-label="关闭"]',
      );
      if (modalClose) await modalClose.click();
      else await page.click('[aria-label="AI 科研副驾驶"]');
      await delay(250);
    }
    if (!agentOnly) {
      const done = await startTrace(
        '新建项目弹窗动画',
        { dialog: '[role="dialog"]', main: '#main-content', heading: '.page-head' },
        800,
      );
      await clickText('main button', '新建项目');
      await page.waitForSelector('[role="dialog"]');
      const modal = await done();
      const centerError = Math.max(
        ...modal.frames
          .filter((f) => f.nodes.dialog)
          .map((f) => Math.abs(f.nodes.dialog.x + f.nodes.dialog.width / 2 - width / 2)),
      );
      const late = modal.frames.filter((f) => f.time > 200 && f.nodes.dialog);
      const jump = Math.max(...late.slice(1).map((f, i) => Math.abs(f.nodes.dialog.x - late[i].nodes.dialog.x)), 0);
      record(
        '新建项目动画横向居中且无结束跳跃',
        centerError <= 2 && jump <= 1,
        `最大中心偏差${centerError.toFixed(2)}px，200ms后帧间跳跃${jump.toFixed(2)}px`,
      );
      await page.screenshot({ path: path.join(output, `${name}-project-dialog.png`) });
      await closeDialog();
      if (!modalOnly) {
        for (const [label, route] of [
          ['工作台', '/'],
          ['项目', '/projects'],
          ['任务', '/tasks?filter=all'],
          ['任务看板', '/tasks?filter=all&view=board'],
          ['任务日历', '/tasks?filter=all&view=calendar'],
          ['实验', '/experiments'],
          ['实验参数表', '/experiments?view=matrix'],
          ['文献', '/library'],
          ['设置', '/settings'],
          ['项目详情', project],
          ['实验详情', experiment],
          ['AI工作室', '/ai'],
          ['账号', '/account'],
        ])
          await visit(label, route);
        await visit('项目筛选', '/projects');
        await shellStable('项目搜索空结果与清空', async () => {
          await page.type('[aria-label="搜索项目"]', '无匹配项目');
          await delay(140);
          await page.click('[aria-label="搜索项目"]', { clickCount: 3 });
          await page.keyboard.press('Backspace');
        });
        await shellStable(
          '新建项目打开与取消',
          async () => {
            await clickText('main button', '新建项目');
            await page.waitForSelector('[role="dialog"]');
            await delay(220);
            await page.keyboard.press('Escape');
          },
          1000,
        );
        await clickText('main button', '新建项目');
        await page.waitForSelector('[role="dialog"]');
        await delay(220);
        await field('项目名称', `交互走查项目 ${width}`);
        await clickText('[role="dialog"] button', '创建项目');
        await page.waitForSelector('[role="dialog"]', { hidden: true });
        record(
          '新建项目实际保存并进入详情',
          await page
            .waitForFunction(
              (text) => document.querySelector('main')?.textContent.includes(text),
              {},
              `交互走查项目 ${width}`,
            )
            .then(() => true),
        );
        await visit('任务交互', '/tasks?filter=all');
        const task = await page.$('main .group button[title]');
        await shellStable(
          '任务详情抽屉打开与关闭',
          async () => {
            await task.click();
            await page.waitForSelector('[role="dialog"]');
            await delay(240);
            await page.keyboard.press('Escape');
          },
          1100,
        );
        await shellStable(
          '全局搜索打开与关闭',
          async () => {
            await page.keyboard.down('Control');
            await page.keyboard.press('k');
            await page.keyboard.up('Control');
            await page.waitForSelector('[role="dialog"]');
            await delay(180);
            await page.keyboard.press('Escape');
          },
          1000,
        );
        if (width < 768)
          await shellStable(
            '手机导航打开与关闭',
            async () => {
              await page.click('[aria-label="打开导航"]');
              await delay(230);
              await page.click('[aria-label="关闭导航"]');
            },
            1000,
          );
        await page.screenshot({ path: path.join(output, `${name}-tasks.png`) });
        await detailedFlows(experiment);
        if (width >= 640) {
          await shellStable('切换深色主题', () => page.click('[aria-label="切换深色主题"]'));
          await page.screenshot({ path: path.join(output, `${name}-dark.png`) });
        }
      }
    }
    record('无运行时异常', errors.length === 0, errors.join('\n'));
  }
} catch (error) {
  record('交互走查完成', false, String(error));
} finally {
  await browser?.close();
  if (preview.exitCode === null) {
    const exited = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await exited;
  }
  fs.writeFileSync(path.join(output, `${name}-report.json`), JSON.stringify({ results, traces, errors }, null, 2));
}
if (results.some((item) => !item.passed)) process.exitCode = 1;
