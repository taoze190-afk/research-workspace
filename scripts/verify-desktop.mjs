// 真正运行打包后的 EXE，全部资料和账号位于本次临时目录。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked', 'YanxuResearch.exe'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yanxu-desktop-verification-'));
const profile = path.join(temporary, 'profile');
const output = path.join(root, 'shots', 'desktop', path.basename(executable, '.exe'));
fs.mkdirSync(profile);
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [],
  requests = [],
  diagnostics = [];
let processHandle, browser, page, state;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  if (!passed) throw new Error(name);
};
async function until(fn, message, timeout = 35000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      /* 等待文件或服务就绪 */
    }
    await delay(150);
  }
  throw new Error(message);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  requests.push(body);
  const content =
    '附件已用于本次科研计划。\n```action\n{"action":"create_task","title":"桌面 EXE 实际创建的任务"}\n```';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
async function launch() {
  for (const name of ['DevToolsActivePort', 'desktop-test-state.json'])
    fs.rmSync(path.join(profile, name), { force: true });
  processHandle = spawn(executable, ['--desktop-test', '--disable-gpu'], {
    windowsHide: true,
    env: { ...process.env, RW_DESKTOP_TEST_DATA: profile },
    stdio: 'pipe',
  });
  processHandle.stdout.on('data', (data) => diagnostics.push(String(data)));
  processHandle.stderr.on('data', (data) => diagnostics.push(String(data)));
  processHandle.on('error', (error) => diagnostics.push(String(error)));
  state = await until(() => {
    const value = JSON.parse(fs.readFileSync(path.join(profile, 'desktop-test-state.json'), 'utf8'));
    return alive(value.pid) && value;
  }, '桌面 EXE 未启动本机服务');
  const active = await until(
    () => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n'),
    '桌面调试目标未就绪',
  );
  browser = await puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${active[0]}${active[1]}`,
    defaultViewport: null,
    protocolTimeout: 15000,
  });
  page = await until(
    async () => (await browser.pages()).find((p) => p.url().startsWith(state.origin)),
    '未找到真实桌面窗口',
  );
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  await page.waitForSelector('body');
  await page.waitForFunction(() => document.readyState === 'complete');
  return state;
}
async function stop() {
  const current = state;
  if (page && !page.isClosed())
    await Promise.race([
      page.close(),
      delay(4000).then(() => {
        throw new Error('桌面窗口未正常关闭');
      }),
    ]);
  browser?.disconnect();
  browser = null;
  page = null;
  await until(() => !alive(current.pid) && !alive(current.backendPid), '退出后仍有本机服务进程');
  if (processHandle?.exitCode === null) await until(() => processHandle.exitCode !== null, '免安装启动器未退出');
}
async function api(url, body, method = 'POST') {
  return page.evaluate(
    async (url, body, method) => {
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    },
    url,
    body,
    method,
  );
}
async function visit(route) {
  await page.goto(state.origin + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main-content');
}
function pdfFixture() {
  const stream = 'BT /F1 12 Tf 40 720 Td (Desktop PDF evidence 42 samples) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = text.length;
  text +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return text;
}
try {
  if (!fs.existsSync(executable)) throw new Error('请先生成桌面包：' + executable);
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(
    path.join(profile, 'desktop.env'),
    `AI_API_KEY=desktop-isolated-fixture\nAI_BASE_URL=http://127.0.0.1:${mock.address().port}/v1\n`,
  );
  const first = await launch();
  check('真实 Windows EXE 启动独立本机服务', Boolean(first.pid && first.backendPid && first.pid !== first.backendPid));
  check('本机服务只使用回环地址', new URL(first.origin).hostname === '127.0.0.1');
  check(
    '界面禁止直接访问 Node 与 Electron',
    await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'),
  );
  const options = await api('/api/auth/options', undefined, 'GET');
  check('干净安装首次允许创建本机管理员', options.bootstrap === true);
  await page.screenshot({ path: path.join(output, 'login.png') });
  const owner = await api('/api/auth/signup', { email: 'desktop-owner@example.test', password: 'Research2026!' });
  check('首次注册具有管理员权限', ['owner', 'admin'].includes(owner.user.role));
  const stamp = Date.now();
  const project = {
    id: 'desktop-project',
    name: '桌面离线验证课题',
    question: '桌面版本保存测试',
    goal: '验证研究记录和原文件',
    status: 'active',
    startDate: null,
    endDate: null,
    favorite: true,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    isDemo: false,
  };
  await api('/api/tx', { ops: [{ type: 'put', table: 'projects', record: project }] });
  await api(
    '/api/admin/settings',
    { allowSignup: false, ai: { provider: 'custom', model: 'desktop-fixture', enabled: true } },
    'PATCH',
  );
  await visit('/ai?scope=project:desktop-project');
  const textPath = path.join(temporary, 'desktop-evidence.txt');
  fs.writeFileSync(textPath, 'DESKTOP_ORIGINAL_FILE_42');
  const input = await page.$('input[aria-label="上传 AI 附件"]');
  await input.uploadFile(textPath);
  await until(async () => (await api('/api/files', undefined, 'GET')).files.length === 1, '桌面上传原件没有保存');
  await until(async () => page.$eval('[aria-label="发送"]', (el) => !el.disabled), '附件读取后发送未就绪');
  await page.type('textarea[aria-label="向 AI 提问"]', '根据科研附件安排一项任务');
  await page.click('[aria-label="发送"]');
  await page.waitForSelector('[aria-label="采纳：新建任务"]');
  check(
    '桌面模型请求收到当前项目和明确附带的文件',
    requests.length === 1 &&
      JSON.stringify(requests[0].messages).includes('desktop-project') &&
      JSON.stringify(requests[0].messages).includes('DESKTOP_ORIGINAL_FILE_42'),
  );
  await page.click('[aria-label="采纳：新建任务"]');
  await until(
    async () =>
      (await api('/api/snapshot', undefined, 'GET')).data.tasks.some((t) => t.title === '桌面 EXE 实际创建的任务'),
    '桌面 AI 写入未落库',
  );
  check('桌面 AI 操作真实写入 SQLite', fs.existsSync(path.join(profile, 'data', 'research-workspace.db')));
  const chatUrl = page.url();
  await page.screenshot({ path: path.join(output, 'ai-saved.png') });
  const pdf = await page.evaluate(async (body) => {
    const r = await fetch('/api/files', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-rw-client': 'rw',
        'x-file-name': 'desktop.pdf',
        'x-file-type': 'application/pdf',
        'x-project-id': 'desktop-project',
      },
      body,
    });
    if (!r.ok) throw new Error('PDF 上传失败');
    return r.json();
  }, pdfFixture());
  await visit('/files?focus=' + pdf.id);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-preview canvas');
    return canvas && canvas.width > 0 && canvas.height > 0;
  });
  check('桌面 PDF Worker 和阅读画布正常', Boolean(await page.$('[aria-label="PDF 阅读器"] canvas')));
  await page.screenshot({ path: path.join(output, 'pdf-preview.png') });
  for (const route of [
    '/',
    '/projects/desktop-project',
    '/tasks',
    '/experiments',
    '/library',
    '/files',
    '/settings',
    '/account',
    '/admin',
  ]) {
    await visit(route);
    check('模块可打开 ' + route, !(await page.$('[role="alert"][data-fatal="true"]')));
  }
  const beforeSecond = fs.readFileSync(path.join(profile, 'desktop-test-state.json'), 'utf8');
  const second = spawn(executable, ['--desktop-test', '--disable-gpu'], {
    windowsHide: true,
    env: { ...process.env, RW_DESKTOP_TEST_DATA: profile },
    stdio: 'ignore',
  });
  await until(() => second.exitCode !== null, '重复启动未聚焦已有实例', 40000);
  check(
    '重复启动不创建第二套服务',
    fs.readFileSync(path.join(profile, 'desktop-test-state.json'), 'utf8') === beforeSecond,
  );
  await stop();
  check('关闭窗口后后台服务一并退出', !alive(first.backendPid));
  const next = await launch();
  check('重启保持原地址，保留对话与浏览器资料', next.origin === first.origin);
  await visit(new URL(chatUrl).pathname + new URL(chatUrl).search);
  await page.waitForSelector('[aria-label="已执行：新建任务"]');
  check(
    '重启恢复账号登录和已执行回执',
    (await api('/api/me', undefined, 'GET')).id === owner.user.id &&
      (await page.$eval('[aria-label="已执行：新建任务"]', (el) => el.disabled)),
  );
  const data = (await api('/api/snapshot', undefined, 'GET')).data;
  check(
    '重启记录不丢失也不重复创建',
    data.tasks.filter((t) => t.title === '桌面 EXE 实际创建的任务').length === 1 &&
      data.projects.some((p) => p.id === project.id),
  );
  const files = (await api('/api/files', undefined, 'GET')).files;
  check('重启保留科研文件原件', files.length === 2 && files.some((f) => f.id === pdf.id));
  const original = await page.evaluate(
    async (id) => (await fetch('/api/files/' + id + '/content')).text(),
    files.find((f) => f.name.endsWith('.txt')).id,
  );
  check('重启后原文件字节一致', original === 'DESKTOP_ORIGINAL_FILE_42');
  await stop();
  check('桌面界面和 CSP 无运行异常', errors.length === 0, errors.join('\n'));
} catch (error) {
  checks.push({ name: '桌面流程完成', passed: false, detail: String(error) });
  console.log('FAIL ' + error);
  if (page)
    await Promise.race([page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}), delay(5000)]);
} finally {
  const desktopLog = path.join(profile, 'desktop.log');
  if (fs.existsSync(desktopLog)) diagnostics.push(fs.readFileSync(desktopLog, 'utf8'));
  if (browser && state)
    await stop().catch(() => {
      if (state?.pid && alive(state.pid)) process.kill(state.pid);
    });
  if (state?.backendPid && alive(state.backendPid)) {
    process.kill(state.backendPid);
    await delay(250);
  }
  if (processHandle?.exitCode === null) {
    processHandle.kill();
    await delay(1000);
  }
  await new Promise((resolve) => mock.close(resolve));
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), executable, checks, errors, diagnostics }, null, 2),
  );
  if (
    !checks.some((check) => !check.passed) &&
    path.dirname(temporary) === os.tmpdir() &&
    path.basename(temporary).startsWith('yanxu-desktop-verification-')
  )
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
if (checks.some((check) => !check.passed)) process.exitCode = 1;
