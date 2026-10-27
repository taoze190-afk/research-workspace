import { chromeExecutable } from './browser.mjs';
// 真实 PNG → 客户端裁剪/压缩 → 账号头像接口。只使用临时数据库、账号和 Chrome 配置。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-avatar-qa-'));
const output = path.join(root, 'shots', 'avatar');
fs.mkdirSync(output, { recursive: true });
const results = [];
const errors = [];
let browser, backend, preview;
const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const freePort = async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const waitUrl = async (url) => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`服务未启动 ${url}`);
};
async function click(page, selector, text) {
  const handle = await page.evaluateHandle(
    (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim() === text),
    selector,
    text,
  );
  if (!handle.asElement()) throw new Error(`找不到 ${selector} ${text}`);
  await handle.asElement().click();
  await handle.dispose();
}
async function me(page) {
  return page.evaluate(async () => (await fetch('/api/me')).json());
}
async function signUp(page, email) {
  return page.evaluate(async (email) => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
      body: JSON.stringify({ email, password: 'research2026!' }),
    });
    return { status: response.status, body: await response.json() };
  }, email);
}
async function login(page, email) {
  const result = await page.evaluate(async (email) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
      body: JSON.stringify({ email, password: 'research2026!' }),
    });
    return { status: response.status, body: await response.json() };
  }, email);
  if (result.status !== 200) throw new Error(`测试账号登录失败 ${result.status}`);
}
async function logout(page) {
  await page.click('[aria-label="账号与同步"]');
  await page.waitForSelector('[role="menu"]');
  await click(page, '[role="menuitem"]', '退出登录');
  await page.waitForSelector('.login-page');
}
async function choose(page, file) {
  const picker = await page.$('[aria-label="选择头像图片"]');
  if (!picker) throw new Error('找不到头像文件输入');
  await picker.uploadFile(file);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[aria-label="头像设置"] button')].some(
      (el) => el.textContent.trim() === '保存头像' && !el.disabled,
    ),
  );
}
async function save(page) {
  await click(page, '[aria-label="头像设置"] button', '保存头像');
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[aria-label="头像设置"] button')].some(
        (el) => el.textContent.trim() === '保存头像' || el.textContent.includes('正在保存'),
      ),
  );
}

try {
  const apiPort = await freePort();
  const webPort = await freePort();
  const base = `http://127.0.0.1:${webPort}`;
  const env = { ...process.env, DATA_DIR: temp, PORT: String(apiPort), ALLOW_SIGNUP: '1', TRUST_PROXY: '0' };
  backend = spawn(process.execPath, [path.join(root, 'server/src/main.ts')], {
    cwd: root,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  preview = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { cwd: root, env: { ...env, API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: 'ignore', windowsHide: true },
  );
  await waitUrl(`http://127.0.0.1:${apiPort}/api/health`);
  await waitUrl(base);
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    headless: true,
    userDataDir: path.join(temp, 'chrome'),
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-features=OverlayScrollbar'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  record('隔离测试账号创建', (await signUp(page, 'avatar-a@example.test')).status === 200);
  await page.goto(base + '/account', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="头像设置"]');
  const fixtures = await page.evaluate(() =>
    ['#5684b7', '#253e69'].map((color, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#e6f0ff';
      ctx.font = 'bold 96px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i ? 'B' : 'A', 160, 95);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
  );
  const files = fixtures.map((base64, i) => {
    const file = path.join(temp, `fixture-${i}.png`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return file;
  });
  record('新账号使用默认头像', !(await me(page)).avatarDataUrl);
  await choose(page, files[0]);
  const previewData = await page.$eval('[aria-label="头像设置"] [role="img"] img', (img) => img.src);
  record('真实PNG在浏览器裁剪为WebP预览', previewData.startsWith('data:image/webp;base64,'));
  record('未保存预览不写入账号', !(await me(page)).avatarDataUrl);
  await click(page, '[aria-label="头像设置"] button', '取消');
  record('取消上传恢复默认头像', (await page.$('[aria-label="头像设置"] img')) === null);
  await choose(page, files[0]);
  await save(page);
  const firstAvatar = (await me(page)).avatarDataUrl;
  record(
    '保存后服务端持久化头像',
    typeof firstAvatar === 'string' && firstAvatar.startsWith('data:image/webp;base64,'),
  );
  await page.waitForFunction(() => [...document.querySelectorAll('[role="img"] img')].length >= 3);
  record(
    '顶栏与侧栏同步显示头像',
    await page.$$eval(
      '.app-topbar [role="img"] img,.app-aside [role="img"] img',
      (images) => images.length >= 2 && images.every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await page.reload({ waitUntil: 'networkidle0' });
  record(
    '刷新后头像保留',
    (await me(page)).avatarDataUrl === firstAvatar &&
      (await page.$eval('[aria-label="头像设置"] img', (img) => img.complete && img.naturalWidth === 256)),
  );
  await page.screenshot({ path: path.join(output, '1440-avatar-saved.png') });
  await choose(page, files[1]);
  await save(page);
  const secondAvatar = (await me(page)).avatarDataUrl;
  record('更换头像实际更新服务端', Boolean(secondAvatar && secondAvatar !== firstAvatar));
  for (const width of [768, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `${width}-avatar-saved.png`) });
    record(
      `${width}px头像设置无横向溢出`,
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.querySelector('#main-content').scrollWidth <=
            document.querySelector('#main-content').clientWidth + 1,
      ),
    );
  }
  await page.evaluate(() => document.querySelector('[aria-label="头像设置"] img')?.dispatchEvent(new Event('error')));
  record(
    '图片失败回退默认显示',
    (await page.$('[aria-label="头像设置"] img')) === null &&
      Boolean(await page.$('[aria-label="头像设置"] [role="img"]')),
  );
  await page.reload({ waitUntil: 'networkidle0' });
  await logout(page);
  record('第二个独立账号创建', (await signUp(page, 'avatar-b@example.test')).status === 200);
  await page.goto(base + '/account', { waitUntil: 'networkidle0' });
  record(
    '换账号后不继承其他人头像',
    !(await me(page)).avatarDataUrl && (await page.$('[aria-label="头像设置"] img')) === null,
  );
  await logout(page);
  await login(page, 'avatar-a@example.test');
  await page.goto(base + '/account', { waitUntil: 'networkidle0' });
  record('重新登录恢复本人头像', (await me(page)).avatarDataUrl === secondAvatar);
  await click(page, '[aria-label="头像设置"] button', '移除头像');
  record('移除草稿尚未修改服务端', (await me(page)).avatarDataUrl === secondAvatar);
  await save(page);
  record('移除头像写入服务端', (await me(page)).avatarDataUrl === null);
  await page.reload({ waitUntil: 'networkidle0' });
  record('移除后刷新保持默认头像', (await page.$('[aria-label="头像设置"] img')) === null);
  const invalid = path.join(temp, 'invalid.svg');
  fs.writeFileSync(invalid, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await (await page.$('[aria-label="选择头像图片"]')).uploadFile(invalid);
  await page.waitForSelector('[aria-label="头像设置"] [role="alert"]');
  record('不支持的SVG上传被拒绝且账号未修改', !(await me(page)).avatarDataUrl);
  const rejected = await page.evaluate(
    async () =>
      (
        await fetch('/api/auth/avatar', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
          body: JSON.stringify({ avatarDataUrl: 'data:image/png;base64,not-valid-png' }),
        })
      ).status,
  );
  record('绕过前端的伪造图片被服务端拒绝', rejected === 400);
  record('无页面运行时异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  record('头像浏览器验收完成', false, String(error));
} finally {
  await browser?.close();
  for (const child of [preview, backend])
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  const absoluteTemp = path.resolve(temp),
    temporaryRoot = path.resolve(os.tmpdir());
  if (
    !absoluteTemp.startsWith(`${temporaryRoot}${path.sep}`) ||
    !path.basename(absoluteTemp).startsWith('research-avatar-qa-')
  )
    throw new Error('拒绝清理非本次临时目录');
  fs.rmSync(absoluteTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results, errors }, null, 2),
  );
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
