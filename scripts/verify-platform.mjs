import { chromeExecutable } from './browser.mjs';
// 新功能走查：临时账号、临时 SQLite、测试模型，完全独立于正式数据和真实模型密钥。
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yanxu-platform-review-'));
const shots = path.join(root, 'shots', 'platform');
fs.mkdirSync(shots, { recursive: true });
const report = [];
const record = (name, passed, detail = '') => {
  report.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const waitUrl = async (url) => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务未启动 ${url}`);
};
const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const mock = http.createServer(async (req, res) => {
  for await (const _ of req) {
    /* 消耗请求体 */
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: '这是浏览器联调测试模型的固定回复，用于验证完整调用链路。\n\n建议先写清研究问题，再安排对照实验。',
          },
        },
      ],
    }),
  );
});
let backend, preview, browser;
async function click(page, selector, text) {
  const handle = await page.evaluateHandle(
    (s, t) =>
      [...document.querySelectorAll(s)].find((el) => el.textContent.replace(/\s+/g, '') === t.replace(/\s+/g, '')),
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到 ${text}`);
  await element.click();
  await handle.dispose();
}
async function fill(page, labelText, value) {
  const ok = await page.evaluate(
    (text, val) => {
      const label = [...document.querySelectorAll('label')].find((el) => el.textContent.trim() === text);
      const input = label && document.getElementById(label.htmlFor);
      if (!input) return false;
      const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    labelText,
    value,
  );
  if (!ok) throw new Error(`找不到字段 ${labelText}`);
}
try {
  const mockPort = await listen(mock);
  const apiPort = await freePort();
  const webPort = await freePort();
  const base = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    DATA_DIR: temp,
    PORT: String(apiPort),
    AI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    AI_API_KEY: 'ui-test-placeholder-key',
    ALLOW_SIGNUP: '0',
    TRUST_PROXY: '0',
  };
  backend = spawn(process.execPath, [path.join(root, 'server/src/main.ts')], { cwd: root, env, stdio: 'pipe' });
  backend.stderr.on('data', (d) => {
    if (!String(d).includes('ExperimentalWarning') && !String(d).includes('trace-warnings')) console.error(String(d));
  });
  preview = spawn(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(webPort), '--strictPort'],
    { cwd: root, env: { ...env, API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: 'ignore' },
  );
  await waitUrl(`http://127.0.0.1:${apiPort}/api/health`);
  await waitUrl(base);
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    args: ['--no-first-run', '--hide-scrollbars', '--force-prefers-reduced-motion'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.emulateTimezone('Asia/Shanghai');
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}');
      localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: value }));
    }, theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewport({ width, height: width === 1440 ? 1000 : 900 });
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.login-page .login-form-panel form');
      await page.waitForFunction(() => document.querySelector('.login-background img')?.complete);
      await page.screenshot({ path: path.join(shots, `${width}-login${theme === 'dark' ? '-dark' : ''}.png`) });
      const login = await page.evaluate(() => {
        const form = document.querySelector('.login-form-panel form');
        const submit = form.querySelector('button[type="submit"]');
        const image = document.querySelector('.login-background img');
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
        };
        const oldCopy = ['A SPACE FOR YOUR RESEARCH', '让研究有序', '让想法向前', '从课题计划到实验记录', '登录后，继续你的研究', '科研记录按账号隔离', '账号独立空间'];
        return {
          theme: document.documentElement.dataset.theme,
          loginButtons: [...document.querySelectorAll('button')].filter((button) => button.textContent.trim() === '登录').length,
          oldIntroRemoved: !document.querySelector('.login-story') && !oldCopy.some((text) => document.body.textContent.includes(text)),
          backgroundLoaded: Boolean(image?.complete && image.naturalWidth > 0),
          formVisible: visible(form) && visible(submit),
          noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1,
        };
      });
      const name = `${width}px ${theme} 登录页`;
      record(`${name} 主题正确`, login.theme === theme);
      record(`${name} 仅一个登录按钮`, login.loginButtons === 1);
      record(`${name} 已移除介绍与功能卡`, login.oldIntroRemoved);
      record(`${name} 背景图片加载成功`, login.backgroundLoaded);
      record(`${name} 表单与提交首屏可达`, login.formVisible);
      record(`${name} 无横向溢出`, login.noOverflow);
    }
  }
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}');
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: 'light' }));
  });
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await click(page, 'button', '注册');
  await fill(page, '邮箱', 'researcher@example.test');
  await fill(page, '密码', 'research2026!');
  await click(page, 'button', '创建账号');
  await page.waitForFunction(() => !document.querySelector('input[autocomplete="username"]'));
  record('首个账号从注册界面创建', true);
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('table');
  record('空科研库可以直接进入管理控制台', true);
  for (const [email, role] of [
    ['manager@example.test', 'admin'],
    ['student@example.test', 'member'],
  ]) {
    await click(page, 'button', '创建账号');
    await page.waitForSelector('[role="dialog"]');
    await fill(page, '邮箱', email);
    await fill(page, '初始密码', 'research2026!');
    await fill(page, '角色', role);
    await click(page, '[role="dialog"] button', '创建账号');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.waitForFunction((e) => document.querySelector('table')?.textContent.includes(e), {}, email);
  }
  record('前端创建管理员与普通用户并刷新真实列表', true);
  await page.goto(`${base}/admin?tab=models`, { waitUntil: 'networkidle0' });
  await fill(page, '模型服务商', 'custom');
  await fill(page, '模型标识', 'ui-test-model');
  await page.click('[aria-label="启用平台 AI"]');
  await click(page, 'button', '保存设置');
  await page.waitForFunction(() => document.body.textContent.includes('模型已就绪'));
  await click(page, 'button', '测试连接');
  await page.waitForFunction(() => document.body.textContent.includes('浏览器联调测试模型'));
  record('模型设置保存与真实服务端调用链路', true, '使用本机测试模型，不调用外部模型');
  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: width === 1440 ? 1000 : 900 });
    for (const [name, route] of [
      ['ai', '/ai'],
      ['users', '/admin'],
      ['models', '/admin?tab=models'],
      ['permissions', '/admin?tab=permissions'],
      ['audit', '/admin?tab=activity'],
      ['account', '/account'],
    ]) {
      await page.goto(base + route, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: path.join(shots, `${width}-${name}.png`) });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth + 1 ||
          (document.querySelector('main')?.scrollWidth ?? 0) > (document.querySelector('main')?.clientWidth ?? 0) + 1,
      );
      record(`${width}px ${name} 无页面横向溢出`, !overflow);
    }
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${base}/ai`, { waitUntil: 'networkidle0' });
  await click(page, 'button', '整理研究思路把零散想法组织成提纲');
  await click(page, 'button', '发送');
  await page.waitForFunction(() => document.body.textContent.includes('浏览器联调测试模型的固定回复'));
  record('AI 工作室真实发送和展示回答', true);
  await page.screenshot({ path: path.join(shots, '1440-ai-reply-test-model.png') });
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}');
    localStorage.setItem('rw.prefs.v1', JSON.stringify({ ...prefs, theme: 'dark' }));
  });
  await page.goto(`${base}/ai`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(shots, '1440-ai-dark.png') });
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(shots, '1440-users-dark.png') });
  const response = await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-rw-client': 'rw' } });
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
      body: JSON.stringify({ email: 'student@example.test', password: 'research2026!' }),
    });
    const denied = await fetch('/api/admin/overview');
    return { login: login.status, denied: denied.status };
  });
  record('普通用户被后端拒绝管理访问', response.login === 200 && response.denied === 403);
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle0' });
  record(
    '普通用户看到无权限界面且无管理员入口',
    await page.evaluate(
      () =>
        document.body.textContent.includes('管理控制台仅向管理员开放') &&
        !document.querySelector('nav a[href="/admin"]'),
    ),
  );
  record('无运行时异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  record('浏览器走查完成', false, String(error));
} finally {
  await browser?.close();
  for (const child of [preview, backend])
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  await new Promise((resolve) => mock.close(resolve));
  fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, null, 2));
  if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('yanxu-platform-review-'))
    fs.rmSync(temp, { recursive: true, force: true });
}
if (report.some((r) => !r.passed)) process.exitCode = 1;
