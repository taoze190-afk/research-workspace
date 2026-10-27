import { chromeExecutable } from './browser.mjs';
// 服务器模式端到端走查：真实浏览器 + 真实 Node/SQLite 服务端 + vite 代理（等价于 1Panel 反代）。
// 用法：node scripts/verify-server.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const API_PORT = await freePort();
const WEB_PORT = await freePort();
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-e2e-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-e2e-browser-'));
const shots = path.join(ROOT, 'shots');
fs.mkdirSync(shots, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function start(cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'pipe', windowsHide: true, env: { ...process.env, ...env } });
  const log = path.join(ROOT, 'test-results', 'server-e2e.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  child.stdout.on('data', (d) => fs.appendFileSync(log, `[out] ${d}`));
  child.stderr.on('data', (d) => fs.appendFileSync(log, `[err] ${d}`));
  return child;
}

/** 界面上的同步标注 title 里带着最近一次失败原因 */
const syncDiary = () =>
  page.evaluate(() => {
    const chip = [...document.querySelectorAll('span[role="status"]')].find((s) =>
      /同步|服务器/.test(s.textContent ?? ''),
    );
    return chip ? `${chip.textContent.trim()} :: ${chip.getAttribute('title') ?? ''}` : '没有同步标注';
  });

async function waitUrl(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等不到 ${url}`);
}

const dbFile = path.join(dataDir, 'research-workspace.db');
let apiProc, webProc, browser, page;

// 直连 SQLite 核对，不用界面自证
function query(sql, ...args) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}

async function startBrowser() {
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    userDataDir: profile,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run'],
  });
  page = await browser.newPage();
  // 测试可加速浏览器的 15 秒重试时钟；仍走同一条自动重试链路，生产时钟不变。
  if (process.argv.includes('--fast-timers')) {
    await page.evaluateOnNewDocument(() => {
      const originalInterval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) =>
        originalInterval(callback, delay === 15000 ? 300 : delay, ...args);
    });
  }
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${String(e).slice(0, 300)}`));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateTimezone('Asia/Shanghai');
}
const consoleLog = [];

const text = () => page.evaluate(() => document.body.innerText);
async function clickText(selector, needle) {
  const handle = await page.evaluateHandle(
    (sel, n) =>
      [...document.querySelectorAll(sel)].find((el) =>
        (el.textContent ?? '').replace(/\s+/g, '').includes(n.replace(/\s+/g, '')),
      ),
    selector,
    needle,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`找不到 ${selector} 含「${needle}」`);
  await el.click();
  await handle.dispose();
}
async function type(selector, value, index = 0) {
  const ok = await page.evaluate(
    (sel, val, idx) => {
      const el = document.querySelectorAll(sel)[idx];
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    selector,
    value,
    index,
  );
  if (!ok) throw new Error(`找不到输入框 ${selector}[${index}]`);
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

try {
  apiProc = start(process.execPath, ['server/src/main.ts'], {
    DATA_DIR: dataDir,
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    ALLOW_SIGNUP: '1',
  });
  webProc = start(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    { API_TARGET: `http://127.0.0.1:${API_PORT}` },
  );
  await waitUrl(`http://127.0.0.1:${API_PORT}/api/health`);
  await waitUrl(BASE);
  await startBrowser();

  // 1. 服务器在跑但没登录 → 只给登录页，且看不到任何数据
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await settle(900);
  let body = await text();
  const loginOnly = body.includes('邮箱') && body.includes('密码') && body.includes('注册') && !body.includes('工作台');
  record('未登录时只出现登录页', loginOnly, body.slice(0, 40).replace(/\n/g, ' '));

  // 2. 注册第一个账号
  await clickText('.login-switch button', '注册');
  await settle(400);
  await type('input[type="email"]', 'owner@example.com');
  await type('input[type="password"]', 'research2026!');
  await clickText('button', '创建账号');
  await settle(1600);
  body = await text();
  record('注册后进入应用并给出首次入口', body.includes('体验示例') || body.includes('今日任务'), body.slice(0, 60));

  // 3. 载入示例 → 数据真的落到 SQLite 且带 owner 的 userId
  await clickText('button', '体验示例');
  await settle(2500);
  const owner = query("SELECT id, email FROM users WHERE email='owner@example.com'")[0];
  const demoProjects = query('SELECT COUNT(*) AS n FROM projects WHERE userId = ?', owner.id)[0].n;
  const mirror = await page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const req = indexedDB.open('research-workspace');
      req.onsuccess = () => resolve(req.result);
    });
    const count = (name) =>
      new Promise((resolve) => {
        try {
          const req = database.transaction(name, 'readonly').objectStore(name).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve('ERR');
        } catch {
          resolve('NO_STORE');
        }
      });
    const result = {
      projects: await count('projects'),
      pending: JSON.parse(localStorage.getItem('rw.queue.v1') ?? '{"ops":[]}').ops.length,
    };
    database.close();
    return result;
  });
  record(
    '示例数据落到服务器且归属该账号',
    Number(demoProjects) === 3 && mirror.projects === 3 && mirror.pending === 0,
    `服务器 projects=${demoProjects}；浏览器镜像 projects=${mirror.projects}；待传队列=${mirror.pending}；${await syncDiary()}`,
  );
  body = await text();
  record(
    '顶栏显示同步状态而不是本地标注',
    body.includes('已同步') || body.includes('已连服务器'),
    body.match(/已同步|已连服务器|\d+ 条待同步/)?.[0] ?? '没找到',
  );
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'server-dashboard.png').replace(/\\/g, '/') });

  // 4. 界面里建一条任务 → 服务器多一行
  const stamp = Date.now();
  const taskTitle = `端到端任务 ${stamp}`;
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
  await settle(600);
  await clickText('button', '新建项目');
  await settle(500);
  await type('[role="dialog"] input', `端到端项目 ${stamp}`);
  await clickText('[role="dialog"] button[type="submit"]', '创建项目');
  await settle(1600);
  await clickText('button', '新建任务');
  await settle(500);
  await type('[role="dialog"] input', taskTitle);
  await clickText('[role="dialog"] button[type="submit"]', '创建任务');
  await settle(1800);
  const inDb = query('SELECT COUNT(*) AS n FROM tasks WHERE userId = ? AND title = ?', owner.id, taskTitle)[0].n;
  record('界面新建的任务写进了服务器', Number(inDb) === 1, `匹配 ${inDb}；${await syncDiary()}`);

  // 5. 刷新后仍在（从服务器拉镜像）
  await page.reload({ waitUntil: 'networkidle2' });
  await settle(1200);
  body = await text();
  record('刷新后任务仍在', body.includes(taskTitle));

  // 6. 换第二个账号：看不到第一个账号的任何数据
  //    （这一步需要 ALLOW_SIGNUP=1，正是部署文档里「邀请第二个账号时临时打开」的用法）
  const immediateExperiment = query('SELECT id, title FROM experiments WHERE userId = ? LIMIT 1', owner.id)[0];
  const immediateTitle = `退出前最后一次实验编辑 ${stamp}`;
  await page.goto(`${BASE}/experiments/${immediateExperiment.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[aria-label="实验标题"]');
  await type('input[aria-label="实验标题"]', immediateTitle);
  const accountBtn = await page.$('[aria-label="账号与同步"]');
  await accountBtn.click();
  await page.waitForSelector('[role="menu"] [role="menuitem"]');
  const pendingTitle = query('SELECT title FROM experiments WHERE id = ?', immediateExperiment.id)[0].title;
  record('快速编辑后在防抖保存前立即发起退出', pendingTitle !== immediateTitle);
  await clickText('[role="menu"] [role="menuitem"]', '退出登录');
  await settle(1200);
  record(
    '立即退出前最后一次实验编辑已保存到服务器',
    query('SELECT title FROM experiments WHERE id = ? AND userId = ?', immediateExperiment.id, owner.id)[0].title ===
      immediateTitle,
  );
  body = await text();
  record(
    '退出后回到登录页',
    body.includes('邮箱') && body.includes('密码') && !body.includes('正在推进的项目'),
    body.slice(0, 40).replace(/\n/g, ' '),
  );

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await settle(900);
  await clickText('.login-switch button', '注册');
  await settle(400);
  await type('input[type="email"]', 'guest@example.com');
  await type('input[type="password"]', 'research2026!');
  await clickText('button', '创建账号');
  await settle(1800);
  const guest = query("SELECT id FROM users WHERE email='guest@example.com'")[0];
  record('第二个账号能注册（部署时靠 ALLOW_SIGNUP 控制）', !!guest);
  const needsOnboarding = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '开始使用'),
  );
  if (needsOnboarding) await clickText('button', '开始使用');
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle2' });
  await settle(1400);
  body = await text();
  const leaked = body.includes(`端到端项目 ${stamp}`) || body.includes('腕臂式肌电信号采集装置');
  record(
    '第二个账号看不到第一个账号的数据',
    !leaked,
    leaked ? '界面出现了别人的项目' : `页面片段：${body.slice(0, 60)}`,
  );

  // 7. 断网：改动排队，界面说清还没同步
  await stopProcess(apiProc);
  const offlineTitle = `离线改动 ${stamp}`;
  await page.goto(`${BASE}/tasks?filter=all`, { waitUntil: 'networkidle2' });
  await settle(800);
  await clickText('button', '新建任务');
  await settle(400);
  await type('[role="dialog"] input', offlineTitle);
  await clickText('[role="dialog"] button[type="submit"]', '创建任务');
  await settle(1600);
  record('离线本地保存成功后关闭新建任务表单', !(await page.$('[role="dialog"] form')));
  body = await text();
  record(
    '断网时改动留在浏览器并明确提示未同步',
    body.includes('待同步') || body.includes('还没同步'),
    body.match(/\d+ 条待同步|还没同步到服务器/)?.[0] ?? body.slice(0, 60),
  );
  const localHasIt = await page.evaluate((t) => document.body.innerText.includes(t), offlineTitle);
  record('断网期间界面仍可用（镜像可写）', localHasIt);
  const queued = await page.evaluate((title) => {
    const queue = JSON.parse(localStorage.getItem('rw.queue.v1') ?? '{"ops":[]}');
    return {
      owner: queue.owner,
      matching: queue.ops.filter((op) => op.record?.title === title).length,
      count: queue.ops.length,
    };
  }, offlineTitle);
  record(
    '离线操作按第二账号归属进入待传队列',
    queued.owner === guest.id && queued.matching === 1,
    JSON.stringify(queued),
  );
  await page.keyboard.press('Escape');

  // 8. 恢复服务器：自动补传（15 秒一轮），也可以手动点「立即同步」
  apiProc = start(process.execPath, ['server/src/main.ts'], {
    DATA_DIR: dataDir,
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    ALLOW_SIGNUP: '1',
  });
  await waitUrl(`http://127.0.0.1:${API_PORT}/api/health`);
  // 不点手动同步：核实同一条定时自动补传链路。
  let uploaded = 0;
  for (let i = 0; i < 25 && uploaded === 0; i++) {
    await settle(1200);
    uploaded = Number(
      query('SELECT COUNT(*) AS n FROM tasks WHERE userId = ? AND title = ?', guest.id, offlineTitle)[0]?.n ?? 0,
    );
  }
  record('恢复后排队改动补传到服务器', uploaded === 1, `rows=${uploaded}`);
  record(
    '离线补传没有写入第一个账号',
    Number(
      query('SELECT COUNT(*) AS n FROM tasks WHERE userId = ? AND title = ?', owner.id, offlineTitle)[0]?.n ?? 0,
    ) === 0,
  );
  body = await text();
  record(
    '同步完成后标注回到已同步',
    body.includes('已同步') && !body.includes('条待同步'),
    body.match(/已同步|已连服务器|\d+ 条待同步/)?.[0] ?? '',
  );
  await page.screenshot({ path: path.join(shots, 'server-after-sync.png').replace(/\\/g, '/') });
  record(
    '服务端完整流程无页面运行时异常',
    !consoleLog.some((line) => line.startsWith('[pageerror]')),
    consoleLog.filter((line) => line.startsWith('[pageerror]')).join('\n'),
  );
} catch (error) {
  record('服务器模式走查异常', false, String(error).slice(0, 240));
} finally {
  await browser?.close();
  await stopProcess(webProc);
  await stopProcess(apiProc);
  // Windows 上 SQLite 句柄可能还没释放，清不掉就交给系统临时目录回收，不该让整个走查崩掉
  try {
    cleanTemporary(dataDir, 'rw-e2e-');
    cleanTemporary(profile, 'rw-e2e-browser-');
  } catch {
    console.log(`（临时数据目录留在 ${dataDir}）`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log('\n===== 汇总 =====');
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
for (const f of failed) console.log(`FAIL  ${f.name} — ${f.detail}`);
fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test-results', 'server-walkthrough.json'), JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await stopped;
}

function cleanTemporary(directory, prefix) {
  const resolved = path.resolve(directory);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`) || !path.basename(resolved).startsWith(prefix))
    throw new Error(`拒绝清理非本次临时目录：${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
}
