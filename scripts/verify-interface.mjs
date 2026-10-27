import { chromeExecutable } from './browser.mjs';
// 各模块背景、可读性与缩放重排验收。独立浏览器只加载演示资料；完整CRUD复用 verify-interactions.mjs。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'shots', 'interface');
const width = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 1440);
const zoom = Number(process.argv.find((arg) => arg.startsWith('--zoom='))?.split('=')[1] ?? 1);
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.split('=')[1]
  ?.split(',');
const name = `${width}${zoom === 1 ? '' : `-zoom${zoom}`}${only ? `-only-${only.join('-')}` : ''}`;
const viewport = {
  width: Math.round(width / zoom),
  height: Math.round((width < 1000 ? 900 : 1000) / zoom),
  deviceScaleFactor: zoom,
};
const checks = [];
const pages = [];
const errors = [];
let browser;
let preview;
fs.mkdirSync(output, { recursive: true });
const record = (label, passed, detail = '') => {
  checks.push({ label, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} ${label}${detail ? `: ${detail}` : ''}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;

async function inspect() {
  return page.evaluate(() => {
    const main = document.querySelector('#main-content');
    const visible = (el) => {
      const style = getComputedStyle(el);
      return (
        el.getClientRects().length > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !el.closest('[aria-hidden="true"], .sr-only')
      );
    };
    const rgba = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const opaqueAncestor = (el) => {
      for (let node = el; node && node !== main; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (rgba(color)[3] >= 242) return { color, className: node.className?.toString().slice(0, 90) };
      }
      return null;
    };
    const label = (el) =>
      (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName)
        .trim()
        .slice(0, 65);
    const luminance = (channels) =>
      channels
        .slice(0, 3)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const primaryContrast = [...main.querySelectorAll('button.btn.bg-brand:not(:disabled),a.btn.bg-brand')]
      .filter(visible)
      .map((el) => {
        const foreground = rgba(getComputedStyle(el).color);
        const backdrop = rgba(getComputedStyle(el).backgroundColor);
        const text = foreground
          .slice(0, 3)
          .map((channel, index) => (channel * foreground[3]) / 255 + backdrop[index] * (1 - foreground[3] / 255));
        const light = luminance(text),
          dark = luminance(backdrop);
        return {
          text: label(el),
          ratio: Number(((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)).toFixed(2)),
        };
      });
    const lowActionText = [];
    const actions = [
      ...main.querySelectorAll('button, a, label, input, textarea, select, th'),
      ...document.querySelectorAll('.app-aside button,.app-aside a,.app-topbar button,.app-topbar a'),
    ];
    for (const el of actions) {
      if (
        !visible(el) ||
        el.matches('input[type="checkbox"], input[type="radio"], input[type="color"], input[type="file"]')
      )
        continue;
      const text = label(el);
      if (!text || (el.matches('button,a') && !el.textContent.trim())) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) lowActionText.push({ text, size, tag: el.tagName });
      for (const child of el.querySelectorAll('span, strong, small')) {
        if (
          !visible(child) ||
          !child.textContent.trim() ||
          child.querySelector('span,strong,small') ||
          child.matches('kbd')
        )
          continue;
        const childSize = parseFloat(getComputedStyle(child).fontSize);
        if (childSize < 12) lowActionText.push({ text: label(child), size: childSize, tag: child.tagName });
      }
    }
    const smallText = [...main.querySelectorAll('p,small,span')]
      .filter(
        (el) =>
          visible(el) &&
          el.textContent.trim() &&
          !el.querySelector('p,small,span') &&
          parseFloat(getComputedStyle(el).fontSize) < 12,
      )
      .map((el) => ({ text: label(el), size: parseFloat(getComputedStyle(el).fontSize) }))
      .slice(0, 45);
    const unprotectedSurfaces = [...main.querySelectorAll('.panel,.ai-studio-conversation,.ai-studio-composer')]
      .filter(visible)
      .filter((el) => !opaqueAncestor(el))
      .map((el) => label(el));
    const unprotectedInputs = [...main.querySelectorAll('input,textarea,select')]
      .filter(visible)
      .filter((el) => !el.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[type="color"]'))
      .filter((el) => !opaqueAncestor(el))
      .map((el) => label(el));
    const backgrounds = [...document.querySelectorAll('[data-workspace-background] img')].map((el) => ({
      src: el.currentSrc || el.src,
      loaded: el.complete && el.naturalWidth > 0,
      pointerEvents: getComputedStyle(el).pointerEvents,
      parentPointerEvents: getComputedStyle(el.closest('[data-workspace-background]')).pointerEvents,
    }));
    const mainRect = main.getBoundingClientRect();
    const overflowing = [...main.querySelectorAll('*')]
      .filter((el) => visible(el) && !el.closest('[data-allow-x]'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > mainRect.right + 1 || rect.left < mainRect.left - 1;
      })
      .slice(0, 15)
      .map((el) => ({
        text: label(el),
        className: el.className?.toString().slice(0, 160),
        rect: el.getBoundingClientRect().toJSON(),
      }));
    const dateControls = [...document.querySelectorAll('button[aria-label="清除日期"]')]
      .filter(visible)
      .map((button) => {
        const input = button.parentElement.querySelector('input[type="date"]');
        if (!input) return null;
        const field = input.getBoundingClientRect(),
          clear = button.getBoundingClientRect();
        const x = field.right - 16,
          y = field.top + field.height / 2;
        const inViewport = x > 0 && x < innerWidth && y > 64 && y < innerHeight;
        return {
          input: field.toJSON(),
          button: clear.toJSON(),
          position: getComputedStyle(button).position,
          aligned: Math.abs(field.top + field.height / 2 - clear.top - clear.height / 2) <= 1,
          calendarNotBlocked: !inViewport || document.elementFromPoint(x, y) === input,
        };
      })
      .filter(Boolean);
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      documentHeight: document.documentElement.scrollHeight,
      main: {
        width: main.clientWidth,
        scrollWidth: main.scrollWidth,
        height: main.clientHeight,
        scrollHeight: main.scrollHeight,
      },
      horizontal: document.documentElement.scrollWidth <= innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1,
      noOuterScroll: document.documentElement.scrollHeight <= innerHeight + 1,
      lowActionText,
      primaryContrast,
      smallText,
      unprotectedSurfaces,
      unprotectedInputs,
      backgrounds,
      overflowing,
      dateControls,
    };
  });
}

let page;
try {
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
    { cwd: root, stdio: 'ignore', windowsHide: true },
  );
  for (let attempt = 0; attempt < 80; attempt++) {
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
    '正常动画和真实滚动条',
    !browser.process().spawnargs.some((arg) => /hide-scrollbars|prefers-reduced-motion/.test(arg)),
  );
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport(viewport);
  await page.emulateTimezone('Asia/Shanghai');
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.url().includes('/api/')
      ? request.respond({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"isolated-interface-preview"}',
        })
      : request.continue(),
  );
  await page.goto(base, { waitUntil: 'networkidle0' });
  const demo = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((el) => el.textContent.includes('体验示例')),
  );
  if (!demo.asElement()) throw new Error('找不到独立演示数据入口');
  await demo.asElement().click();
  await page.waitForSelector('nav[aria-label="概览"]');
  const project = await page.$eval('main a[href^="/projects/"]', (el) => el.getAttribute('href'));
  const experiment = await page.$eval('main a[href^="/experiments/"]', (el) => el.getAttribute('href'));
  const routes = [
    ['dashboard', '/'],
    ['projects', '/projects'],
    ['tasks', '/tasks?filter=all'],
    ['board', '/tasks?filter=all&view=board'],
    ['calendar', '/tasks?filter=all&view=calendar'],
    ['experiments', '/experiments'],
    ['matrix', '/experiments?view=matrix'],
    ['library', '/library'],
    ['settings', '/settings'],
    ['project-detail', project],
    ['experiment-detail', experiment],
    ['ai', '/ai'],
    ['account', '/account'],
    ...(only?.includes('date-control') ? [['date-control', '/tasks?new=1']] : []),
  ];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) =>
        localStorage.setItem(
          'rw.prefs.v1',
          JSON.stringify({ ...JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}'), theme }),
        ),
      theme,
    );
    for (const [routeName, route] of routes.filter(([routeName]) => !only || only.includes(routeName))) {
      await page.goto(base + route, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#main-content');
      if (routeName === 'date-control') {
        await page.waitForSelector('[role="dialog"] input[type="date"]');
        await page.$eval('[role="dialog"] input[type="date"]', (input) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-11-10');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForSelector('button[aria-label="清除日期"]');
      }
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-workspace-background] img')].every((img) => img.complete),
      );
      const metrics = await inspect();
      const label = `${theme} ${routeName}`;
      pages.push({ name: routeName, route, theme, ...metrics });
      record(`${label} 主题`, metrics.theme === theme);
      record(`${label} 无横向溢出`, metrics.horizontal, metrics.horizontal ? '' : JSON.stringify(metrics.overflowing));
      record(`${label} 无文档外层滚动`, metrics.noOuterScroll);
      record(
        `${label} 操作文字不少于12px`,
        metrics.lowActionText.length === 0,
        metrics.lowActionText.length ? JSON.stringify(metrics.lowActionText.slice(0, 12)) : '',
      );
      record(
        `${label} 主按钮文字对比不低于4.5`,
        metrics.primaryContrast.every((item) => item.ratio >= 4.5),
        metrics.primaryContrast.some((item) => item.ratio < 4.5) ? JSON.stringify(metrics.primaryContrast) : '',
      );
      record(
        `${label} 内容面板遮住背景`,
        metrics.unprotectedSurfaces.length === 0,
        metrics.unprotectedSurfaces.length ? JSON.stringify(metrics.unprotectedSurfaces) : '',
      );
      record(
        `${label} 输入控件有实色承托`,
        metrics.unprotectedInputs.length === 0,
        metrics.unprotectedInputs.length ? JSON.stringify(metrics.unprotectedInputs) : '',
      );
      record(
        `${label} 背景图片独立且加载`,
        metrics.backgrounds.length > 0 &&
          metrics.backgrounds.every((image) => image.loaded && !image.src.includes('login-mountains')),
      );
      record(
        `${label} 背景不拦截操作`,
        metrics.backgrounds.length > 0 &&
          metrics.backgrounds.every((image) => image.pointerEvents === 'none' || image.parentPointerEvents === 'none'),
      );
      if (metrics.dateControls.length) {
        record(
          `${label} 日期清除按钮与输入同行`,
          metrics.dateControls.every((control) => control.aligned),
          JSON.stringify(metrics.dateControls),
        );
        record(
          `${label} 原生日历入口未被清除按钮挡住`,
          metrics.dateControls.every((control) => control.calendarNotBlocked),
        );
      }
      if (routeName === 'experiment-detail')
        record(`${label} 必填实验日期不提供误清空入口`, metrics.dateControls.length === 0);
      if (theme === 'light' || ['dashboard', 'tasks', 'library', 'settings', 'ai'].includes(routeName))
        await page.screenshot({ path: path.join(output, `${name}-${theme}-${routeName}.png`) });
      if (routeName === 'settings') {
        const before = await page.$eval('#main-content', (el) => el.clientWidth);
        await page.click('[role="switch"][aria-label="背景图片"]');
        record(
          `${theme} 可关闭背景且不改变正文宽度`,
          (await page.$('[data-workspace-background]')) === null &&
            (await page.$eval('#main-content', (el) => el.clientWidth)) === before,
        );
        await page.reload({ waitUntil: 'networkidle0' });
        record(`${theme} 关闭背景偏好刷新后保留`, (await page.$('[data-workspace-background]')) === null);
        await page.click('[role="switch"][aria-label="背景图片"]');
        await page.waitForSelector('[data-workspace-background] img');
        await page.waitForFunction(() => document.querySelector('[data-workspace-background] img')?.complete);
        record(
          `${theme} 可恢复背景`,
          await page.$eval('[data-workspace-background] img', (img) => img.complete && img.naturalWidth > 0),
        );
      }
      if (routeName === 'date-control') {
        await page.click('button[aria-label="清除日期"]');
        record(
          `${theme} 任务截止日期实际可清空`,
          (await page.$eval('[role="dialog"] input[type="date"]', (input) => input.value)) === '',
        );
        record(
          `${theme} 清空日期后焦点回到输入框`,
          await page.$eval('[role="dialog"] input[type="date"]', (input) => document.activeElement === input),
        );
        await page.keyboard.press('Escape');
        await page.waitForSelector('[role="dialog"]', { hidden: true });
      }
    }
  }
  record('无页面运行时异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  record('界面走查完成', false, String(error));
} finally {
  await browser?.close();
  if (preview && preview.exitCode === null) {
    const exited = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await exited;
  }
  fs.writeFileSync(
    path.join(output, `${name}-report.json`),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        width,
        zoom,
        zoomMethod:
          zoom === 1
            ? 'normal viewport'
            : '1280 physical pixels / 2 = 640 CSS px; DPR 2; desktop 200% equivalent reflow, not pinch zoom',
        checks,
        pages,
        errors,
      },
      null,
      2,
    ),
  );
}
if (checks.some((item) => !item.passed)) process.exitCode = 1;
