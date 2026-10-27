import { chromeExecutable } from './browser.mjs';
// 在独立临时浏览器内检查整体视觉，所有演示数据仅供本次走查使用。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'shots', 'redesign');
fs.mkdirSync(output, { recursive: true });
const width = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 1440);
const zoom = Number(process.argv.find((arg) => arg.startsWith('--zoom='))?.split('=')[1] ?? 1);
const viewportWidth = Math.round(width / zoom);
const runName = `${width}${zoom === 1 ? '' : '-zoom' + zoom}`;
const portProbe = http.createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore', windowsHide: true },
);
const checks = [];
const check = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${width}px ${name}${detail ? `: ${detail}` : ''}`);
};
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: viewportWidth,
    height: Math.round((width < 1000 ? 900 : 1000) / zoom),
    deviceScaleFactor: zoom,
  });
  await page.emulateTimezone('Asia/Shanghai');
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.url().includes('/api/')
      ? request.respond({ status: 503, contentType: 'application/json', body: '{"error":"local-preview"}' })
      : request.continue(),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: 'networkidle0' });
  const demo = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((button) => button.textContent.includes('体验示例')),
  );
  if (!demo.asElement()) throw new Error('首次使用入口未出现');
  await demo.asElement().click();
  await page.waitForSelector('nav[aria-label="概览"]');
  const project = await page.$eval('main a[href^="/projects/"]', (el) => el.getAttribute('href'));
  const experiment = await page.$eval('main a[href^="/experiments/"]', (el) => el.getAttribute('href'));
  const routes = [
    ['dashboard', '/'],
    ['projects', '/projects'],
    ['tasks', '/tasks?filter=all'],
    ['board', '/tasks?filter=all&view=board'],
    ['calendar', '/tasks?view=calendar'],
    ['experiments', '/experiments'],
    ['matrix', '/experiments?view=matrix'],
    ['library', '/library'],
    ['settings', '/settings'],
    ['project-detail', project],
    ['experiment-detail', experiment],
    ['ai', '/ai'],
    ['account', '/account'],
  ];
  async function visit(name, route) {
    await page.goto(base + route, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(output, `${runName}-${name}.png`) });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth + 1 ||
        document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1,
    );
    check(`${name} 布局`, !overflow);
    const readability = await page.evaluate(() => {
      const rgb = (value) => {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const ctx = c.getContext('2d');
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const lum = (color) =>
        color
          .slice(0, 3)
          .map((c) => {
            const n = c / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          })
          .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
      const topbar = rgb(getComputedStyle(document.querySelector('.app-topbar')).backgroundColor);
      const dark = document.documentElement.dataset.theme === 'dark';
      const failures = [...document.querySelectorAll('main .btn.bg-brand:not(:disabled)')]
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          const style = getComputedStyle(el),
            a = lum(rgb(style.color)),
            b = lum(rgb(style.backgroundColor));
          return { text: el.textContent.trim(), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        })
        .filter((item) => item.contrast < 4.5);
      return {
        theme: dark ? 'dark' : 'light',
        topbar,
        failures,
        valid: (dark ? lum(topbar) < 0.15 : lum(topbar) > 0.6) && failures.length === 0,
      };
    });
    check(`${name} 主题与主操作文字对比度`, readability.valid, readability.valid ? '' : JSON.stringify(readability));
  }
  for (const [name, route] of routes) await visit(name, route);

  await page.goto(`${base}/projects`, { waitUntil: 'networkidle0' });
  const plannedStage = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.project-stage-nav button')].find((el) => el.textContent.includes('计划中')),
  );
  await plannedStage.asElement().click();
  await page.waitForFunction(() =>
    document.querySelector('.project-stage-nav [aria-pressed="true"]')?.textContent.includes('计划中'),
  );
  check(
    '项目阶段切换与计数一致',
    await page.evaluate(() => {
      const active = document.querySelector('.project-stage-nav [aria-pressed="true"]');
      return (
        active?.textContent.includes('计划中') &&
        document.querySelectorAll('.portfolio-card').length === Number(active.querySelector('.stage-count').textContent)
      );
    }),
  );
  await page.goto(`${base}/experiments`, { waitUntil: 'networkidle0' });
  const activeStatus = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.experiment-status-nav button')].find((el) => el.textContent.includes('进行中')),
  );
  await activeStatus.asElement().click();
  await page.waitForFunction(() =>
    document.querySelector('.experiment-status-nav [aria-pressed="true"]')?.textContent.includes('进行中'),
  );
  check(
    '实验状态切换与计数一致',
    await page.evaluate(() => {
      const active = document.querySelector('.experiment-status-nav [aria-pressed="true"]');
      return (
        active?.textContent.includes('进行中') &&
        document.querySelectorAll('.experiment-entry').length === Number(active.lastElementChild.textContent)
      );
    }),
  );
  await page.goto(base + experiment, { waitUntil: 'networkidle0' });
  await page.click('.experiment-outline a[href="#experiment-method"]');
  await new Promise((resolve) => setTimeout(resolve, 220));
  check(
    '实验目录定位且跟随当前分区',
    await page.evaluate(() => {
      const section = document.getElementById('experiment-method');
      const main = document.querySelector('main').getBoundingClientRect();
      const rect = section.getBoundingClientRect();
      return (
        rect.top >= main.top &&
        rect.top < main.bottom &&
        document.querySelector('.experiment-outline [aria-current="location"]')?.getAttribute('href') ===
          '#experiment-method'
      );
    }),
  );
  await page.screenshot({ path: path.join(output, `${runName}-experiment-method.png`) });
  await page.$eval('main', (el) => {
    el.scrollTop = 0;
  });
  const previewButton = await page.evaluateHandle(() =>
    [...document.querySelectorAll('main button')].find((el) => el.textContent.trim() === '预览'),
  );
  await previewButton.asElement().click();
  check(
    '预览目录全部有实际内容目标',
    await page.$$eval(
      '.experiment-outline a',
      (links) => links.length > 0 && links.every((el) => document.getElementById(el.getAttribute('href').slice(1))),
    ),
  );
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle0' });
  await page.click('.settings-nav a[href="#settings-backup"]');
  await new Promise((resolve) => setTimeout(resolve, 220));
  check(
    '设置目录定位且当前分区高亮',
    await page.evaluate(() => {
      const rect = document.getElementById('settings-backup').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      return (
        rect.top >= main.top &&
        rect.top < main.bottom &&
        document.querySelector('.settings-nav [aria-current="location"]')?.getAttribute('href') === '#settings-backup'
      );
    }),
  );
  await page.screenshot({ path: path.join(output, `${runName}-settings-backup.png`) });
  await page.goto(`${base}/library`, { waitUntil: 'networkidle0' });
  if (viewportWidth >= 1024) {
    const openNote = await page.evaluateHandle(() =>
      [...document.querySelectorAll('.reading-desk button')].find((el) => el.textContent.includes('打开笔记')),
    );
    await openNote.asElement().click();
    await page.waitForSelector('[aria-label="文献详情"] textarea');
    check(
      '阅读桌打开真实文献与笔记',
      !!(await page.$('[aria-label="文献详情"] textarea')) &&
        (await page.$eval('.library-catalog [aria-current="true"]', (el) => !!el)),
    );
  } else {
    await page.click('.library-catalog li button');
    await page.waitForSelector('[aria-label="文献详情"] textarea');
    check(
      '窄屏打开笔记保留返回入口',
      !!(await page.$('[aria-label="文献详情"]')) && !!(await page.$('[aria-label="返回列表"]')),
    );
  }
  await page.screenshot({ path: path.join(output, `${runName}-library-note.png`) });
  await page.click('[aria-label="文献详情"] h3', { clickCount: 2 });
  check(
    '双击选字不会意外切换沉浸布局',
    await page.evaluate(() => !document.documentElement.classList.contains('focus-mode')),
  );
  await page.goto(`${base}/tasks?filter=all`, { waitUntil: 'networkidle0' });
  if (viewportWidth <= 1000) {
    check(
      '窄屏任务标题有完整的阅读空间',
      await page.$eval(
        '.task-row-title',
        (el) =>
          el.getBoundingClientRect().width >= 150 && getComputedStyle(el.firstElementChild).whiteSpace !== 'nowrap',
      ),
    );
    check(
      '窄屏任务日期文字不截断',
      await page.$$eval('.task-row .task-due-chip span', (els) =>
        els.filter((el) => el.getClientRects().length).every((el) => el.scrollWidth <= el.clientWidth + 1),
      ),
    );
  }
  if (viewportWidth >= 768) {
    await page.click('[aria-label="收起侧栏"]');
    check(
      '折叠导航图标保持在侧栏内',
      await page.$$eval('.app-aside .sidebar-link', (links) =>
        links.every((el) => {
          const aside = document.querySelector('.app-aside').getBoundingClientRect();
          const icon = el.querySelector('svg').getBoundingClientRect();
          return icon.left >= aside.left && icon.right <= aside.right;
        }),
      ),
    );
    await page.click('[aria-label="展开侧栏"]');
  }
  await page.goto(`${base}/library`, { waitUntil: 'networkidle0' });
  check(
    '文献筛选在当前屏宽可用',
    await page.$$eval('select[aria-label]', (fields) =>
      fields
        .filter((field) => ['按阅读状态筛选', '按关联项目筛选'].includes(field.getAttribute('aria-label')))
        .every((field) => field.getClientRects().length > 0),
    ),
  );
  await page.goto(`${base}/tasks?filter=all`, { waitUntil: 'networkidle0' });
  const task = await page.$('main .group button[title]');
  if (!task) throw new Error('找不到任务详情入口');
  await task.click();
  await page.waitForSelector('[role="dialog"]');
  await page.screenshot({ path: path.join(output, `${runName}-task-drawer.png`) });
  check('任务详情抽屉可打开', true);
  await page.keyboard.press('Escape');
  await page.goto(`${base}/projects`, { waitUntil: 'networkidle0' });
  const create = await page.evaluateHandle(() =>
    [...document.querySelectorAll('main button')].find((button) => button.textContent.includes('新建项目')),
  );
  await create.asElement().click();
  await page.waitForSelector('[role="dialog"]');
  await page.screenshot({ path: path.join(output, `${runName}-project-dialog.png`) });
  check('新建项目表单可打开', true);
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.waitForSelector('[role="dialog"]');
  await page.screenshot({ path: path.join(output, `${runName}-search.png`) });
  check('全局搜索可用', true);
  await page.keyboard.press('Escape');
  if (viewportWidth < 768) {
    await page.click('[aria-label="打开导航"]');
    await page.waitForSelector('[role="dialog"][aria-label="导航"]');
    await page.screenshot({ path: path.join(output, `${runName}-navigation.png`) });
    check('手机导航可用', true);
    await page.click('[aria-label="关闭导航"]');
  }
  if (viewportWidth >= 640) {
    await page.click('[aria-label="切换深色主题"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    check('顶栏主题切换生效', true);
  }
  await page.evaluate(() =>
    localStorage.setItem(
      'rw.prefs.v1',
      JSON.stringify({ ...JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}'), theme: 'dark' }),
    ),
  );
  for (const [name, route] of routes) await visit(`${name}-dark`, route);
  check('无运行时异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  check('整体走查', false, String(error));
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const done = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await done;
  }
  fs.writeFileSync(path.join(output, `${runName}-report.json`), JSON.stringify(checks, null, 2));
}
if (checks.some((item) => !item.passed)) process.exitCode = 1;
