import { chromeExecutable } from './browser.mjs';
// 模块补充验收：独立 Chrome、演示数据、真实界面操作与本地数据库/下载核对。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const width = Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 1440);
const batchOnly = process.argv.includes('--batch-only');
const keyboardBatch = process.argv.includes('--keyboard-batch');
const output = path.join(root, 'shots', 'module-actions');
const downloads = path.join(output, 'downloads', `${width}-${Date.now()}`);
fs.mkdirSync(downloads, { recursive: true });
const results = [];
const errors = [];
const diagnostics = [];
let buildAssets = [];
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
let project;
let modifiedTasks = [];
let priority;
const expectedPriorities = {};
const milestoneTitle = `里程碑补充验收 ${width}`;
const restoredTitle = `回收站补充验收 ${width}`;

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${width}px ${name}${detail ? `: ${detail}` : ''}`);
}
async function until(check, message, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}
async function byText(selector, text) {
  const handle = await page.evaluateHandle(
    (s, t) =>
      [...document.querySelectorAll(s)].find((el) => el.textContent.replace(/\s+/g, '') === t.replace(/\s+/g, '')),
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到操作 ${text}`);
  return element;
}
async function clickText(selector, text) {
  const element = await byText(selector, text);
  await element.click();
  await element.dispose();
}
async function table(name) {
  return page.evaluate(async (store) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('research-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, name);
}
async function visit(route) {
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main-content');
}
async function dismissToasts() {
  for (const button of await page.$$('[aria-label="关闭提示"]')) await button.click().catch(() => {});
}
async function capture(name) {
  await page.screenshot({ path: path.join(output, `${width}-${name}.png`) });
  record(
    `${name} 无页面横向溢出`,
    await page.evaluate(() => {
      const main = document.getElementById('main-content');
      return document.documentElement.scrollWidth <= innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1;
    }),
  );
}
async function scenario(name, run) {
  try {
    await run();
  } catch (error) {
    record(name, false, String(error));
    await page.screenshot({ path: path.join(output, `${width}-${name}-failure.png`) }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}

try {
  await until(async () => {
    try {
      return (await fetch(base)).ok;
    } catch {
      return false;
    }
  }, '预览服务未启动');
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-features=OverlayScrollbar'],
  });
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({ width, height: width < 1000 ? 900 : 1000 });
  await page.emulateTimezone('Asia/Shanghai');
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.evaluateOnNewDocument(() => {
    // 捕获本次页面写入 API 的文本，不读写操作系统或用户的剪贴板。
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__exportedClipboardText = text;
        },
      },
    });
  });
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.url().includes('/api/')
      ? request.respond({ status: 503, contentType: 'application/json', body: '{"error":"isolated-module-preview"}' })
      : request.continue(),
  );
  await page.goto(base, { waitUntil: 'networkidle0' });
  buildAssets = await page.$$eval('script[src]', (elements) => elements.map((element) => element.src));
  console.log('BUILD ' + JSON.stringify(buildAssets));
  await clickText('button', '体验示例');
  await page.waitForSelector('nav[aria-label="概览"]');
  project = (await table('projects')).find((row) => !row.deletedAt);
  record('隔离演示数据已就绪', Boolean(project));
  record(
    '保留正常动画与可见滚动条',
    !browser.process().spawnargs.includes('--hide-scrollbars') &&
      !browser.process().spawnargs.some((arg) => arg.includes('prefers-reduced-motion')),
  );

  if (!batchOnly)
    await scenario('项目里程碑', async () => {
      await visit(`/projects/${project.id}`);
      await page.type('[aria-label="新增里程碑"]', milestoneTitle);
      await page.focus('[aria-label="新增里程碑"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector(`[aria-label="完成里程碑：${milestoneTitle}"]`);
      const added = (await table('milestones')).find((row) => row.title === milestoneTitle);
      record('新增里程碑写入当前项目', added?.projectId === project.id && added.done === false);
      await page.click(`[aria-label="完成里程碑：${milestoneTitle}"]`);
      await until(
        async () => (await table('milestones')).find((row) => row.id === added.id)?.done === true,
        '里程碑未保存完成状态',
      );
      record('勾选里程碑真实保存完成状态', true);
      await page.reload({ waitUntil: 'networkidle0' });
      record(
        '刷新后里程碑完成状态仍在',
        (await page.$eval(`[aria-label="完成里程碑：${milestoneTitle}"]`, (element) =>
          element.getAttribute('aria-checked'),
        )) === 'true',
      );
      await capture('milestone');
    });

  await scenario('任务批量修改', async () => {
    await visit('/tasks?filter=all');
    await page.click('[aria-label="更多显示选项"]');
    await clickText('[role="menuitemcheckbox"]', '多选模式');
    await page.waitForSelector('[role="checkbox"][aria-label^="选择「"]');
    const boxes = (await page.$$('[role="checkbox"][aria-label^="选择「"]')).slice(0, 2);
    const titles = [];
    for (const box of boxes) {
      titles.push((await box.evaluate((element) => element.getAttribute('aria-label'))).slice(3, -1));
      await box.click();
    }
    modifiedTasks = (await table('tasks')).filter((task) => titles.includes(task.title));
    if (modifiedTasks.length !== 2) throw new Error(`预期选中两个唯一任务，实际 ${modifiedTasks.length}`);
    record(
      '多选模式选中两项任务',
      await page.$eval('[role="toolbar"][aria-label="批量操作"]', (element) =>
        element.textContent.includes('已选 2 项'),
      ),
    );
    priority = modifiedTasks.every((task) => task.priority === 'low') ? 'urgent' : 'low';
    await clickText('[role="toolbar"] button', '批量操作');
    const sub = await byText('[role="menuitem"]', '优先级');
    if (keyboardBatch) {
      await sub.focus();
      await page.keyboard.press('ArrowRight');
      await delay(160);
      await page.keyboard.press(priority === 'low' ? 'End' : 'Home');
      await page.keyboard.press('Enter');
    } else {
      await sub.hover();
      await delay(240);
      const item = await byText('[role="menuitem"]', priority === 'low' ? '低' : '紧急');
      const hit = await item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { text: element.textContent, hit: top?.closest('[role="menuitem"]')?.textContent, x: box.x, y: box.y };
      });
      record('批量优先级子菜单选项可命中', hit.text === hit.hit, JSON.stringify(hit));
      await page.screenshot({ path: path.join(output, `${width}-batch-menu.png`) });
      await page.evaluate(() => {
        window.__batchPointerEvents = [];
        for (const type of ['pointerover', 'pointerdown', 'pointerup', 'click', 'menu.itemSelect'])
          document.addEventListener(
            type,
            (event) => {
              const element = event.target instanceof Element ? event.target : null;
              window.__batchPointerEvents.push({
                type,
                text: element?.closest('[role="menuitem"]')?.textContent,
                tag: element?.tagName,
                className: element?.className?.toString()?.slice(0, 100),
              });
            },
            { capture: true },
          );
      });
      const point = await item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.mouse.move(point.x, point.y, { steps: 12 });
      await item.click();
      await delay(120);
      diagnostics.push(await page.evaluate(() => window.__batchPointerEvents));
      record(
        '连续鼠标路径真实触发批量菜单选择',
        diagnostics
          .at(-1)
          .some((event) => event.type === 'menu.itemSelect' && event.text === (priority === 'low' ? '低' : '紧急')),
      );
      await item.dispose();
    }
    await sub.dispose();
    await until(async () => {
      const current = await table('tasks');
      return modifiedTasks.every((old) => current.find((task) => task.id === old.id)?.priority === priority);
    }, '批量任务优先级没有保存');
    record('两项任务批量优先级真实落库', true);
    for (const task of modifiedTasks) expectedPriorities[task.id] = priority;
    record('成功后清空批量选择', (await page.$('[role="toolbar"][aria-label="批量操作"]')) === null);
    await capture('batch');
  });

  if (!batchOnly)
    await scenario('单条任务子菜单', async () => {
      await visit('/tasks?filter=all');
      const task = modifiedTasks[0];
      if (!task) throw new Error('没有已验证的批量任务可用于单条操作');
      const nextPriority = priority === 'high' ? 'medium' : 'high';
      await page.click(`[aria-label="「${task.title}」的操作"]`);
      const subHandle = await page.evaluateHandle(() =>
        [...document.querySelectorAll('[role="menuitem"]')].find((element) =>
          element.textContent.trim().startsWith('优先级'),
        ),
      );
      const sub = subHandle.asElement();
      if (!sub) throw new Error('单条操作菜单没有优先级入口');
      await sub.hover();
      await delay(240);
      await sub.dispose();
      const item = await byText('[role="menuitem"]', nextPriority === 'high' ? '高' : '中');
      const hittable = await item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[role="menuitem"]') ===
          element
        );
      });
      record('单条任务子菜单鼠标选项可命中', hittable);
      await page.screenshot({ path: path.join(output, `${width}-single-menu.png`) });
      const point = await item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.mouse.move(point.x, point.y, { steps: 12 });
      await item.click();
      await item.dispose();
      await until(
        async () => (await table('tasks')).find((row) => row.id === task.id)?.priority === nextPriority,
        '单条任务优先级没有更新',
      );
      expectedPriorities[task.id] = nextPriority;
      record('单条任务鼠标优先级变更真实落库', true);
      const unchanged = modifiedTasks[1];
      record(
        '单条变更不影响另一批量任务',
        (await table('tasks')).find((row) => row.id === unchanged.id)?.priority === priority,
      );
    });

  if (!batchOnly)
    await scenario('实验参数表', async () => {
      await visit('/experiments?view=matrix');
      const experiments = (await table('experiments')).filter((row) => !row.deletedAt);
      const boxes = (await page.$$('table tbody input[type="checkbox"]')).slice(0, 2);
      const selectedTitles = [];
      for (const box of boxes) {
        selectedTitles.push((await box.evaluate((element) => element.getAttribute('aria-label'))).slice(3, -1));
        await box.click();
      }
      if (selectedTitles.length !== 2) throw new Error('演示实验不足两条');
      await clickText('main button', '导出 LaTeX（2）');
      const latex = await page.evaluate(() => window.__exportedClipboardText ?? '');
      record(
        '导出调用写入 API 且包含 LaTeX 表格',
        latex.includes('\\begin{tabular}') && latex.includes('\\end{tabular}'),
      );
      record(
        'LaTeX 仅包含勾选的两条实验',
        selectedTitles.every((title) => latex.includes(title)) &&
          experiments.filter((row) => !selectedTitles.includes(row.title)).every((row) => !latex.includes(row.title)),
      );
      const filterProject = experiments.find((row) => row.projectId)?.projectId;
      if (!filterProject) throw new Error('演示实验没有关联项目');
      await page.select('select[aria-label="按项目筛选"]', filterProject);
      const expected = experiments
        .filter((row) => row.projectId === filterProject)
        .map((row) => row.title)
        .sort();
      await until(
        async () =>
          JSON.stringify(
            await page.$$eval('table tbody a[title]', (elements) => elements.map((element) => element.title).sort()),
          ) === JSON.stringify(expected),
        '参数表项目筛选结果不符',
      );
      record('参数表项目筛选与数据库记录一致', true, `${expected.length} 条`);
      const scroll = await page.$eval('table', (element) => {
        const panel = element.parentElement;
        panel.scrollLeft = panel.scrollWidth;
        const moved = panel.scrollLeft;
        const needsScroll = panel.scrollWidth > panel.clientWidth + 1;
        panel.scrollLeft = 0;
        return { needsScroll, moved };
      });
      record('参数表需要时可在面板内横向滚动', !scroll.needsScroll || scroll.moved > 0, JSON.stringify(scroll));
      await capture('matrix');
    });

  if (!batchOnly)
    await scenario('回收站恢复', async () => {
      await visit('/tasks?filter=all');
      await page.type('[aria-label="快速捕获任务"]', restoredTitle);
      await page.keyboard.press('Enter');
      await page.waitForSelector(`button[title="${restoredTitle}"]`);
      await dismissToasts();
      await page.click(`[aria-label="「${restoredTitle}」的操作"]`);
      await clickText('[role="menuitem"]', '移到回收站');
      await until(
        async () => Boolean((await table('tasks')).find((task) => task.title === restoredTitle)?.deletedAt),
        '测试任务未进入回收站',
      );
      record('任务删除后有软删除标记', true);
      await visit('/settings');
      const row = await page.evaluateHandle(
        (title) =>
          [...document.querySelectorAll('#settings-recycle li')].find((element) => element.textContent.includes(title)),
        restoredTitle,
      );
      if (!row.asElement()) throw new Error('设置回收站未列出刚删除任务');
      await row.asElement().scrollIntoView();
      if (width < 640) {
        const layout = await row.asElement().evaluate((element) => {
          const title = element.querySelector('span[title]').getBoundingClientRect();
          const date = element.querySelector('.tabular-nums').getBoundingClientRect();
          const restore = element.querySelector('button').getBoundingClientRect();
          return {
            titleWidth: title.width,
            titleBottom: title.bottom,
            restoreTop: restore.top,
            dateCenter: date.top + date.height / 2,
            restoreCenter: restore.top + restore.height / 2,
          };
        });
        record(
          '手机回收站标题有独立且足够宽的阅读行',
          layout.titleWidth >= 160 && layout.titleBottom <= layout.restoreTop + 2,
          JSON.stringify(layout),
        );
        record('手机回收站时间与操作按钮在同一行', Math.abs(layout.dateCenter - layout.restoreCenter) <= 5);
      }
      await capture('recycle-list');
      const restore = await row.asElement().$('button');
      await restore.click();
      await row.dispose();
      await until(
        async () => (await table('tasks')).find((task) => task.title === restoredTitle)?.deletedAt === null,
        '恢复任务未清除软删除标记',
      );
      record('回收站恢复真实清除软删除标记', true);
      await capture('restore');
      await visit(`/tasks?filter=all&q=${encodeURIComponent(restoredTitle)}`);
      record('恢复后在任务列表重新可见', Boolean(await page.$(`button[title="${restoredTitle}"]`)));
    });

  if (!batchOnly)
    await scenario('备份下载', async () => {
      await visit('/settings');
      await clickText('main button', '导出记录备份');
      let file;
      await until(async () => {
        file = fs.readdirSync(downloads).find((entry) => entry.endsWith('.json'));
        return Boolean(file);
      }, '未收到真实备份下载');
      const backup = JSON.parse(fs.readFileSync(path.join(downloads, file), 'utf8'));
      record(
        '真实下载的 JSON 格式与版本正确',
        backup.app === 'research-workspace' && backup.schemaVersion > 0 && Boolean(backup.exportedAt),
      );
      record(
        '备份含新增完成的里程碑',
        backup.data.milestones.some((row) => row.title === milestoneTitle && row.done === true),
      );
      record(
        '备份含批量修改后的任务',
        modifiedTasks.length === 2 &&
          modifiedTasks.every(
            (row) => backup.data.tasks.find((task) => task.id === row.id)?.priority === expectedPriorities[row.id],
          ),
      );
      record(
        '备份含回收站恢复的任务',
        backup.data.tasks.some((row) => row.title === restoredTitle && row.deletedAt === null),
      );
      record(
        '导出后记录上次备份时间',
        await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('rw.prefs.v1')).lastBackupAt)),
      );
      await capture('backup');
    });
  record('无页面运行时异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  record('验收环境', false, String(error));
} finally {
  await browser?.close();
  if (preview.exitCode === null) {
    const exited = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await exited;
  }
  fs.writeFileSync(
    path.join(output, `${width}${batchOnly ? '-batch' : ''}${keyboardBatch ? '-keyboard' : ''}-report.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), buildAssets, results, errors, diagnostics }, null, 2),
  );
}
if (results.some((row) => !row.passed)) process.exitCode = 1;
