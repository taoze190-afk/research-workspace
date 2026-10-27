import { chromeExecutable } from './browser.mjs';
// 文件库与 AI 附件验收：隔离 SQLite、临时账号、独立 Chrome、本地模拟模型。
// 先 npm run build，再执行 node scripts/verify-research-files.mjs；不连接正式端口或数据库。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'research-files-verification-'));
const output = path.join(root, 'shots', 'research-files');
const downloads = path.join(temporary, 'downloads');
for (const folder of [output, downloads]) fs.mkdirSync(folder, { recursive: true });
const results = [],
  modelRequests = [],
  errors = [],
  blockedExternal = [],
  diagnostics = [];
let backend,
  preview,
  browser,
  page,
  base,
  failNextUpload = false;
let owner, txt, pdf, picture;
let failPatchId = null;
const filePatches = [];
const projectId = 'files-verification-project';
const textToken = 'TXT_REAL_CONTENT_7319';
const pdfToken = 'PDF_REAL_CONTENT_8426';
const fixtureText = Buffer.from('科研附件验收\n' + textToken + '\n实验记录：A-42；准确率 0.82。\n', 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (name, passed, detail = '') => {
  results.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
async function until(predicate, message, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}
const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
};
const freePort = async () => {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
};
function pdfFixture(text) {
  const pages = [text, 'Second page: follow-up experiment with 84 samples'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((value, i) => {
    const stream = 'BT /F1 12 Tf 40 720 Td (' + value + ') Tj ET';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' +
        (5 + i * 2) +
        ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    );
  });
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(value.length);
    value += i + 1 + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = value.length;
  value +=
    'xref\n0 ' +
    (objects.length + 1) +
    '\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('');
  value += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(value, 'ascii');
}
const fixturePdf = pdfFixture(pdfToken + ' Research evidence with 42 samples');
const textPath = path.join(temporary, 'research-notes.txt');
const pdfPath = path.join(temporary, 'research-evidence.pdf');
const retryPath = path.join(temporary, 'retry-notes.txt');
const aiPdfPath = path.join(temporary, 'studio-evidence.pdf');
const aiRetryPath = path.join(temporary, 'studio-retry.txt');
const docxPath = path.join(temporary, 'research-methods.docx');
const docxToken = 'DOCX_PREVIEW_CONTENT_9654';
const docxZip = new JSZip();
docxZip.file(
  '[Content_Types].xml',
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
docxZip.file(
  '_rels/.rels',
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
docxZip.file(
  'word/document.xml',
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
    docxToken +
    '</w:t></w:r></w:p><w:p><w:r><w:t>实验方案：保留科研原件，并在页面阅读正文。</w:t></w:r></w:p></w:body></w:document>',
);
fs.writeFileSync(docxPath, await docxZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
fs.writeFileSync(textPath, fixtureText);
fs.writeFileSync(pdfPath, fixturePdf);
fs.writeFileSync(aiPdfPath, fixturePdf);
fs.writeFileSync(retryPath, 'RETRY_BYTES_5301');
fs.writeFileSync(aiRetryPath, 'STUDIO_RETRY_BYTES_6412');
const contentText = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    res.end();
    return;
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const user = body.messages?.filter((message) => message.role === 'user').at(-1);
  modelRequests.push({ question: contentText(user?.content), messages: body.messages, model: body.model });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '已读取本次附件。这是隔离验收环境的模拟回复。' } }] }));
});
async function api(url, body, method = 'POST', target = page) {
  return target.evaluate(
    async (url, body, method) => {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(url + ': ' + response.status + ' ' + JSON.stringify(result));
      return result;
    },
    url,
    body,
    method,
  );
}
const listing = (target = page) => api('/api/files', undefined, 'GET', target);
async function binary(id, target = page) {
  return Buffer.from(
    await target.evaluate(async (id) => {
      const response = await fetch('/api/files/' + encodeURIComponent(id) + '/content');
      if (!response.ok) throw new Error('下载失败：' + response.status);
      return [...new Uint8Array(await response.arrayBuffer())];
    }, id),
  );
}
async function visit(route) {
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main-content');
}
async function clickText(selector, text) {
  await delay(220); // 等待抽屉/菜单进入动画完成，避免点击移动中的目标。
  const handle = await page.evaluateHandle(
    (selector, text) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim().replace(/\s+/g, '') === text.replace(/\s+/g, ''),
      ),
    selector,
    text,
  );
  if (!handle.asElement()) throw new Error('找不到操作：' + text);
  await handle.asElement().click();
  await handle.dispose();
}
async function fill(selector, value) {
  await page.$eval(
    selector,
    (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}
async function upload(selector, ...paths) {
  const input = await page.$(selector);
  if (!input) throw new Error('找不到文件上传入口：' + selector);
  await input.uploadFile(...paths);
  await input.dispose();
}
async function capture(name) {
  await page.screenshot({ path: path.join(output, name + '.png') });
}
async function scenario(name, run) {
  try {
    await run();
  } catch (error) {
    record(name, false, String(error));
    await capture(name + '-failure').catch(() => {});
  }
}
async function closeDrawer(label = '科研文件详情') {
  const selector = '[role="dialog"][aria-label="' + label + '"]';
  await page.click(selector + ' [aria-label="关闭"]');
  await page.waitForSelector(selector, { hidden: true });
}
async function send(question) {
  await fill('textarea[aria-label="向 AI 提问"]', question);
  await until(async () => page.$eval('[aria-label="发送"]', (el) => !el.disabled), '发送入口没有就绪');
  await page.click('[aria-label="发送"]');
  await until(
    async () => modelRequests.some((request) => request.question.includes(question)),
    '模拟模型没有收到：' + question,
  );
  await page.waitForFunction(() => document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'false');
  return modelRequests.find((request) => request.question.includes(question));
}
async function layout(name) {
  await delay(220);
  const info = await page.evaluate(() => {
    const main = document.getElementById('main-content');
    const composer = document.querySelector('.ai-studio-composer')?.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.files-page button,.ai-studio-composer button')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width && box.height;
    });
    return {
      width: innerWidth,
      height: innerHeight,
      noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1,
      composerVisible: !composer || (composer.top >= -1 && composer.bottom <= innerHeight + 1),
      controlClipping: controls
        .map((el) => ({
          text: el.getAttribute('aria-label') || el.textContent.trim(),
          box: el.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1)
        .map(({ text }) => text),
      fileFontSizes: [...document.querySelectorAll('.file-name-button strong')].map((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      ),
    };
  });
  record(name + ' 无横向溢出', info.noOverflow, JSON.stringify(info));
  record(name + ' 操作按钮未被横向截断', info.controlClipping.length === 0, info.controlClipping.join(','));
  if (await page.$('.ai-studio')) record(name + ' 附件与输入区首屏可用', info.composerVisible);
  if (info.fileFontSizes.length)
    record(
      name + ' 文件名称可读',
      info.fileFontSizes.every((size) => size >= 14),
      JSON.stringify(info.fileFontSizes),
    );
  await capture(name);
}
async function storedConversations() {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem('rw.studio.v2.' + encodeURIComponent(id)) || '[]'),
    owner.id,
  );
}
async function makePicture() {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e6f0ff';
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = '#3166b2';
    context.fillRect(24, 65, 45, 95);
    context.fillRect(89, 40, 45, 120);
    context.fillRect(154, 95, 45, 65);
    context.font = '16px sans-serif';
    context.fillText('REAL PNG A-42', 22, 28);
    return canvas.toDataURL('image/png');
  });
}

try {
  const mockPort = await listen(mock),
    apiPort = await freePort(),
    webPort = await freePort();
  base = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    DATA_DIR: path.join(temporary, 'data'),
    PORT: String(apiPort),
    HOST: '127.0.0.1',
    ALLOW_SIGNUP: '1',
    TRUST_PROXY: '0',
    AI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    AI_API_KEY: 'temporary-files-fixture-key',
  };
  backend = spawn(process.execPath, [path.join(root, 'server/src/main.ts')], {
    cwd: root,
    env,
    stdio: 'pipe',
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
    { cwd: root, env: { ...env, API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: 'pipe', windowsHide: true },
  );
  for (const child of [backend, preview]) child.stderr.on('data', (chunk) => diagnostics.push(String(chunk)));
  await until(async () => {
    try {
      return (await fetch(base)).ok && (await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok;
    } catch {
      return false;
    }
  }, '隔离服务启动失败');
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    userDataDir: path.join(temporary, 'chrome'),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-features=OverlayScrollbar'],
  });
  const adminContext = await browser.createBrowserContext();
  const admin = await adminContext.newPage();
  await admin.goto(base, { waitUntil: 'networkidle0' });
  await api('/api/auth/signup', { email: 'files-admin@example.test', password: 'Research2026!' }, 'POST', admin);
  await api(
    '/api/admin/settings',
    { allowSignup: true, ai: { provider: 'custom', model: 'isolated-files-model', enabled: true } },
    'PATCH',
    admin,
  );
  await adminContext.close();
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateTimezone('Asia/Shanghai');
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith(base)) {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname.startsWith('/api/files/')) {
        const id = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-1));
        filePatches.push(id);
        if (failPatchId === id) {
          failPatchId = null;
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: '验收：这份文件暂时无法关联' }),
          });
        }
      }
      if (failNextUpload && request.method() === 'POST' && new URL(request.url()).pathname === '/api/files') {
        failNextUpload = false;
        return request.respond({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '验收：暂时无法保存，请重试' }),
        });
      }
      return request.continue();
    }
    if (/^(data:|blob:)/.test(request.url())) return request.continue();
    blockedExternal.push(request.url());
    return request.abort();
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  const signup = await api('/api/auth/signup', { email: 'files-owner@example.test', password: 'Research2026!' });
  owner = signup.user;
  const stamp = Date.now();
  const fixture = {
    projects: [
      {
        id: projectId,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
        isDemo: false,
        name: '附件验收课题',
        question: '文件是否真正可读并持久保存',
        goal: '完成隔离验收',
        status: 'active',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        favorite: true,
      },
    ],
    tasks: [],
    subtasks: [],
    milestones: [],
    experiments: [],
    references: [],
    projectReferences: [],
    tags: [],
    entityTags: [],
  };
  await api('/api/backup/import', { mode: 'replace', data: fixture });
  await page.evaluate(() => localStorage.setItem('rw.prefs.v1', JSON.stringify({ theme: 'light', demoLoadedAt: 1 })));
  await visit('/files');
  record(
    '普通用户使用隔离文件服务',
    owner?.role === 'member',
    JSON.stringify({ role: owner?.role, apiPort, webPort, modelPort: mockPort }),
  );
  record(
    '正式端口与数据库未被使用',
    ![apiPort, webPort, mockPort].some((port) => [5173, 8787, 4173].includes(port)) &&
      path.resolve(env.DATA_DIR).startsWith(path.resolve(temporary) + path.sep),
  );

  await scenario('文件库真实上传与下载', async () => {
    await upload('input[aria-label="上传科研文件"]', textPath, pdfPath);
    await until(async () => (await listing()).files.length === 2, '真实 TXT/PDF 未保存到临时 SQLite');
    const saved = await listing();
    txt = saved.files.find((file) => file.name === path.basename(textPath));
    pdf = saved.files.find((file) => file.name === path.basename(pdfPath));
    record(
      '多文件选择保留两份完整原件',
      txt?.size === fixtureText.length &&
        pdf?.size === fixturePdf.length &&
        saved.usedBytes === fixtureText.length + fixturePdf.length,
    );
    record(
      'TXT 与 PDF SHA-256 对应实际内容',
      txt?.sha256 === sha256(fixtureText) && pdf?.sha256 === sha256(fixturePdf),
    );
    record(
      '下载 API 返回完整 TXT/PDF 字节',
      (await binary(txt.id)).equals(fixtureText) && (await binary(pdf.id)).equals(fixturePdf),
    );
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    await page.click('[aria-label="下载：' + txt.name + '"]');
    await until(() => fs.existsSync(path.join(downloads, txt.name)), '界面下载未产生文件');
    record('界面下载的原文件逐字节一致', fs.readFileSync(path.join(downloads, txt.name)).equals(fixtureText));
    await cdp.detach();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-file-id="' + txt.id + '"]');
    record(
      '刷新后服务器文件仍可下载',
      (await listing()).files.length === 2 && (await binary(pdf.id)).equals(fixturePdf),
    );
    await capture('1440-file-vault-uploaded');
  });

  await scenario('文件重命名关联与查找', async () => {
    if (!txt) throw new Error('前置 TXT 不可用');
    await visit('/files?focus=' + txt.id);
    await page.waitForSelector('[role="dialog"][aria-label="科研文件详情"]');
    await clickText('[role="dialog"] button', '重命名与关联');
    await page.waitForSelector('[role="dialog"] input');
    await fill('[role="dialog"] input', '已关联的研究记录.txt');
    await page.select('[role="dialog"] select', projectId);
    await clickText('[role="dialog"] button', '保存');
    await until(
      async () =>
        (await listing()).files.some(
          (file) => file.id === txt.id && file.name === '已关联的研究记录.txt' && file.projectId === projectId,
        ),
      '重命名与关联未写入服务器',
    );
    txt = (await listing()).files.find((file) => file.id === txt.id);
    record('编辑信息保持原始字节不变', (await binary(txt.id)).equals(fixtureText));
    await visit('/files?project=' + projectId);
    await page.waitForSelector('[data-file-id="' + txt.id + '"]');
    record(
      '项目筛选精确显示已关联文件',
      await page.$$eval('[aria-label="科研文件列表"] [data-file-id]', (rows) => rows.length === 1),
    );
    await fill('[aria-label="搜索科研文件"]', '不存在的检索词');
    record('搜索排除不匹配文件', !(await page.$('[data-file-id="' + txt.id + '"]')));
    await fill('[aria-label="搜索科研文件"]', '研究记录');
    await page.waitForSelector('[data-file-id="' + txt.id + '"]');
    record('搜索恢复精确命中', true);
    await visit('/projects/' + projectId);
    const href = await page.$$eval('main a', (links) =>
      links.find((link) => link.textContent.trim() === '科研文件')?.getAttribute('href'),
    );
    record('项目工具栏直接进入项目内文件页', href === '/projects/' + projectId + '?tab=files', href || '缺少入口');
  });

  await scenario('上传失败可重试且没有假成功', async () => {
    await visit('/files');
    failNextUpload = true;
    await upload('input[aria-label="上传科研文件"]', retryPath);
    await until(
      async () => page.$eval('[aria-label="上传队列"]', (el) => el.textContent.includes('验收：暂时无法保存')),
      '上传失败没有显示在保留队列',
    );
    record(
      '失败保留原文件选择且没有空壳记录',
      !(await listing()).files.some((file) => file.name === 'retry-notes.txt') &&
        Boolean(await page.$('[aria-label="取消上传：retry-notes.txt"]')),
    );
    await capture('1440-file-upload-retry');
    await clickText('[aria-label="上传队列"] button', '重试');
    await until(async () => (await listing()).files.some((file) => file.name === 'retry-notes.txt'), '原选择不能重试');
    const saved = (await listing()).files.find((file) => file.name === 'retry-notes.txt');
    record('不重新选文件即可重试且完整保存', (await binary(saved.id)).equals(fs.readFileSync(retryPath)));
  });

  await scenario('类型筛选、排序与刷新保留', async () => {
    await visit('/files');
    await page.waitForSelector('.files-type-tabs');
    await page.click('.files-type-tabs button:nth-child(3)');
    await until(async () => Boolean(await page.$('.files-empty')), '图片类型空状态没有出现');
    record(
      '没有匹配类型时提供清除筛选',
      await page.$eval(
        '.files-empty',
        (el) => el.textContent.includes('没有匹配的文件') && el.textContent.includes('清除筛选'),
      ),
    );
    await clickText('.files-empty button', '清除筛选');
    await page.waitForSelector('[aria-label="科研文件列表"]');
    await page.select('[aria-label="文件排序"]', 'size');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[aria-label="科研文件列表"]');
    const sizes = new Map((await listing()).files.map((f) => [f.id, f.size]));
    const ordered = await page.$$eval('[data-file-id]', (els) => els.map((el) => el.dataset.fileId));
    record(
      '大小排序刷新后保留且顺序正确',
      (await page.$eval('[aria-label="文件排序"]', (el) => el.value)) === 'size' &&
        ordered.every((id, i) => i === 0 || sizes.get(ordered[i - 1]) >= sizes.get(id)),
    );
    record(
      '已有文件时上传区折叠并避免重复上传按钮',
      Boolean(await page.$('.files-upload-zone.is-compact')) &&
        (await page.$$eval('.files-upload-zone button', (buttons) => buttons.length === 0)),
    );
  });

  await scenario('PDF 原件可视化翻页和缩放', async () => {
    await visit('/files?focus=' + pdf.id);
    await until(
      async () =>
        page
          .$eval('.pdf-preview canvas', (canvas) => canvas.dataset.page === '1' && canvas.width > 0)
          .catch(() => false),
      'PDF 第一页未绘制',
    );
    const ink = await page.$eval('.pdf-preview canvas', (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] && pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200) count++;
      return count;
    });
    record('PDF 正文实际绘制而非空白画布', ink > 50, '非白色像素=' + ink);
    await page.click('[aria-label="PDF 下一页"]');
    await until(
      async () => page.$eval('.pdf-preview canvas', (canvas) => canvas.dataset.page === '2').catch(() => false),
      'PDF 第二页未绘制',
    );
    record('PDF 翻页边界正确', await page.$eval('[aria-label="PDF 下一页"]', (button) => button.disabled));
    const fit = await page.$eval('.pdf-preview canvas', (canvas) => canvas.getBoundingClientRect().width);
    await page.select('[aria-label="PDF 缩放"]', '2');
    await until(
      async () =>
        page.$eval('.pdf-preview canvas', (canvas, fit) => canvas.getBoundingClientRect().width > fit * 1.8, fit),
      'PDF 放大未生效',
    );
    record(
      'PDF 放大限制在阅读器内部滚动',
      (await page.$eval('.pdf-preview-viewport', (el) => el.scrollWidth > el.clientWidth)) &&
        (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)),
    );
    await page.select('[aria-label="PDF 缩放"]', '1');
    await until(
      async () =>
        page.$eval(
          '.pdf-preview canvas',
          (canvas, fit) => Math.abs(canvas.getBoundingClientRect().width - fit) < 2,
          fit,
        ),
      'PDF 无法恢复适应宽度',
    );
    await until(
      async () => page.$eval('.pdf-preview-viewport', (el) => el.getAttribute('aria-busy') === 'false'),
      'PDF 渲染没有结束',
    );
    await delay(350);
    const stableWidth = await page.$eval('.pdf-preview canvas', (canvas) => canvas.getBoundingClientRect().width);
    await delay(200);
    record(
      '适应宽度后画布稳定，不因滚动条反复重绘',
      await page.$eval(
        '.pdf-preview-viewport',
        (el, width) =>
          el.getAttribute('aria-busy') === 'false' &&
          Math.abs(el.querySelector('canvas').getBoundingClientRect().width - width) < 1,
        stableWidth,
      ),
    );
    await capture('1440-pdf-reader');
    await closeDrawer();
  });

  await scenario('Word 正文预览', async () => {
    await visit('/files');
    await upload('input[aria-label="上传科研文件"]', docxPath);
    await until(
      async () => (await listing()).files.some((f) => f.name === 'research-methods.docx'),
      'Word 文件没有保存',
    );
    const word = (await listing()).files.find((f) => f.name === 'research-methods.docx');
    await visit('/files?focus=' + word.id);
    await until(
      async () =>
        page
          .$eval(
            '.file-preview pre',
            (el, token) => el.textContent.includes(token) && el.textContent.includes('实验方案'),
            docxToken,
          )
          .catch(() => false),
      'Word 正文没有完成真实解析',
    );
    record('浏览器预览实际 DOCX 的中英文正文', true);
    record('Word 预览保留原件字节不变', (await binary(word.id)).equals(fs.readFileSync(docxPath)));
    await capture('1440-docx-preview');
    await closeDrawer();
  });

  await scenario('文件库 TXT 交给 AI', async () => {
    if (!txt) throw new Error('前置 TXT 不可用');
    await visit('/files?focus=' + txt.id);
    await page.waitForSelector('[role="dialog"][aria-label="科研文件详情"]');
    await clickText('[role="dialog"] a', '交给 AI');
    await page.waitForSelector('[aria-label="待发送附件"]');
    await until(
      async () =>
        page.$eval(
          '[aria-label="待发送附件"]',
          (el, name) => el.textContent.includes(name) && el.textContent.includes('可读取'),
          txt.name,
        ),
      '文件库入口没有准备可读附件',
    );
    await page.click('[aria-label="资料与模型"]');
    await page.waitForSelector('#ai-scope');
    record(
      '文件库 AI 入口带入关联课题',
      await page.$eval('#ai-scope', (el, id) => el.value === 'project:' + id, projectId),
    );
    await clickText('[role="dialog"] button', '完成');
    await page.waitForSelector('[role="dialog"][aria-label="资料与模型设置"]', { hidden: true });
    const request = await send('[vault-text] 读取科研记录');
    record('模型收到 TXT 实际正文', JSON.stringify(request.messages).includes(textToken));
    record('已发送附件提供原件入口', Boolean(await page.$('[aria-label="已发送附件"]')));
    await capture('1440-studio-text-evidence');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[aria-label="已发送附件"] .studio-attachment-main');
    await page.click('[aria-label="已发送附件"] .studio-attachment-main');
    await until(
      async () =>
        page
          .$eval(
            '.studio-attachment-dialog .file-preview pre',
            (el, token) => el.textContent.includes(token),
            textToken,
          )
          .catch(() => false),
      '历史文字附件刷新后不能读取正文',
    );
    record('刷新后的文字附件预览真实原件内容', true);
    record('聊天附件可直接下载原件', Boolean(await page.$('.studio-attachment-dialog-actions button')));
    await capture('1440-history-text-preview');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.studio-attachment-dialog', { hidden: true });
  });

  await scenario('工作室上传失败可重新添加', async () => {
    await visit('/ai?scope=workspace');
    await page.waitForSelector('input[aria-label="上传 AI 附件"]');
    failNextUpload = true;
    await upload('input[aria-label="上传 AI 附件"]', aiRetryPath);
    await until(
      async () => page.$eval('.ai-studio-compose-area', (el) => el.textContent.includes('验收：暂时无法保存')),
      'AI 上传失败没有清晰反馈',
    );
    record(
      'AI 上传失败不显示假附件或创建空记录',
      !(await page.$('[aria-label="待发送附件"]')) &&
        !(await listing()).files.some((file) => file.name === 'studio-retry.txt'),
    );
    await fill('textarea[aria-label="向 AI 提问"]', '文件没有上传完成时不能当作成功发送');
    record(
      '附件上传失败时阻止误发没有附件的提问',
      await page.$eval('[aria-label="发送"]', (button) => button.disabled),
    );
    await clickText('.ai-studio-compose-area button', '重试上传');
    await until(
      async () => page.$eval('[aria-label="待发送附件"]', (el) => el.textContent.includes('可读取')).catch(() => false),
      'AI 上传失败后不能重新添加同一文件',
    );
    const saved = (await listing()).files.filter((file) => file.name === 'studio-retry.txt');
    record(
      'AI 重试保存一份完整文件',
      saved.length === 1 && (await binary(saved[0].id)).equals(fs.readFileSync(aiRetryPath)),
    );
  });

  await scenario('工作室上传 PDF 提取正文', async () => {
    await visit('/ai?scope=workspace');
    await page.waitForSelector('input[aria-label="上传 AI 附件"]');
    await upload('input[aria-label="上传 AI 附件"]', aiPdfPath);
    await until(
      async () =>
        Boolean(await page.$('[aria-label="待发送附件"]')) &&
        page.$eval(
          '[aria-label="待发送附件"]',
          (el) => el.textContent.includes('studio-evidence.pdf') && el.textContent.includes('可读取'),
        ),
      '有效 PDF 未提取成可读附件',
    );
    record(
      'AI 上传先保存 PDF 原件到文件库',
      (await listing()).files.some((file) => file.name === 'studio-evidence.pdf' && file.sha256 === sha256(fixturePdf)),
    );
    const request = await send('[studio-pdf] 概括 PDF 证据');
    record('模拟模型收到 PDF 的实际提取正文', JSON.stringify(request.messages).includes(pdfToken));
    await capture('1440-studio-pdf-evidence');
  });

  await scenario('粘贴图片与草稿消息引用恢复', async () => {
    await visit('/ai?scope=workspace');
    await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
    const dataUrl = await makePicture();
    const originalBytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    await page.evaluate((dataUrl) => {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (value) => value.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'clipboard-study.png', { type: 'image/png' }));
      document
        .querySelector('textarea[aria-label="向 AI 提问"]')
        .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, dataUrl);
    await until(async () => Boolean(await page.$('[aria-label="待发送附件"] img')), '粘贴图片没有成为真实图片附件');
    picture = (await listing()).files.find((file) => file.name === 'clipboard-study.png');
    record(
      '粘贴原图逐字节保存到当前账号文件库',
      picture?.sha256 === sha256(originalBytes) && (await binary(picture.id)).equals(originalBytes),
    );
    await fill('textarea[aria-label="向 AI 提问"]', '[image-evidence] 分析这张实验图');
    await until(
      async () =>
        (await storedConversations()).some((conversation) =>
          conversation.draftAttachments?.some((a) => a.id === picture.id),
        ),
      '图片草稿引用未持久保存',
    );
    const before = await storedConversations();
    record(
      '草稿只持久保存附件引用',
      !JSON.stringify(before).includes('data:image/') && !JSON.stringify(before).includes(textToken),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await until(
      async () =>
        page.$eval('[aria-label="待发送附件"] img', (img) => img.complete && img.naturalWidth > 0).catch(() => false),
      '刷新草稿后图片预览无法重建',
    );
    record(
      '刷新后草稿图片通过原文件恢复',
      await page.$eval('textarea[aria-label="向 AI 提问"]', (el) => el.value.includes('[image-evidence]')),
    );
    await layout('1440-studio-image-draft');
    const request = await send('[image-evidence] 分析这张实验图');
    const imageParts = request.messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url') : [],
    );
    const url = imageParts.at(-1)?.image_url?.url || '';
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    record(
      '模型收到真实 image_url 数据',
      Boolean(match) && Buffer.from(match[2], 'base64').length > 100,
      match ? match[1] + ' / ' + Buffer.from(match[2], 'base64').length + ' bytes' : '缺少有效图片',
    );
    await until(
      async () =>
        (await storedConversations()).some((conversation) =>
          conversation.messages.some((message) => message.attachments?.some((a) => a.id === picture.id)),
        ),
      '已发送图片引用未持久保存',
    );
    const saved = await storedConversations();
    record(
      '已发送消息仅保存附件引用',
      !JSON.stringify(saved).includes('data:image/') && !JSON.stringify(saved).includes(pdfToken),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await until(
      async () =>
        page.$eval('[aria-label="已发送附件"] img', (img) => img.complete && img.naturalWidth > 0).catch(() => false),
      '刷新消息后图片引用没有恢复',
    );
    record('刷新后已发送图片可恢复预览', true);
    await page.click('[aria-label="已发送附件"] .studio-attachment-main');
    await page.waitForSelector('.studio-attachment-dialog .file-preview img');
    record(
      '历史图片支持放大与查看原文件',
      await page.$eval(
        '.studio-attachment-file-link',
        (el, id) => el.getAttribute('href') === '/files?focus=' + id,
        picture.id,
      ),
    );
    await capture('1440-studio-image-preview');
    await page.keyboard.press('Escape');
    const followup = await send('[image-followup] 再核对一次图片');
    record(
      '刷新后的历史图片重新读取并发送给模型',
      followup.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/')),
      ),
    );
  });

  await scenario('从现有科研文件选择附件', async () => {
    if (!txt) throw new Error('前置 TXT 不可用');
    await visit('/ai?scope=workspace');
    await page.click('[aria-label="选择科研文件"]');
    await page.waitForSelector('[role="dialog"][aria-label="科研文件选择"]');
    await until(
      async () => page.$eval('.studio-file-picker', (el, name) => el.textContent.includes(name), txt.name),
      '已有文件列表未加载',
    );
    await fill('[aria-label="科研文件选择"] [aria-label="搜索科研文件"]', '已关联');
    await page.click('.studio-file-picker button');
    await until(
      async () =>
        page.$eval('.studio-file-picker button', (button) => button.disabled && button.textContent.includes('已附带')),
      '选择已有文件没有附带',
    );
    await clickText('[aria-label="科研文件选择"] button', '完成');
    await page.waitForSelector('[aria-label="科研文件选择"]', { hidden: true });
    record(
      '已有文件不复制保存且预备可读内容',
      (await listing()).files.filter((file) => file.name === txt.name).length === 1 &&
        (await page.$eval('[aria-label="待发送附件"]', (el) => el.textContent.includes('可读取'))),
    );
    const request = await send('[existing-file] 使用已经保存的记录');
    record('已有文件实际正文进入模型请求', JSON.stringify(request.messages).includes(textToken));
  });

  await scenario('普通用户文件越权防护', async () => {
    if (!txt) throw new Error('前置 TXT 不可用');
    const otherContext = await browser.createBrowserContext();
    try {
      const otherPage = await otherContext.newPage();
      await otherPage.goto(base, { waitUntil: 'networkidle0' });
      const other = await api(
        '/api/auth/signup',
        { email: 'files-other@example.test', password: 'Research2026!' },
        'POST',
        otherPage,
      );
      const attack = await otherPage.evaluate(
        async ({ id, ownerId }) => {
          const list = await (await fetch('/api/files')).json();
          const download = await fetch('/api/files/' + id + '/content');
          const remove = await fetch('/api/files/' + id, { method: 'DELETE', headers: { 'x-rw-client': 'rw' } });
          const spoof = await fetch('/api/files/' + id + '/content', { headers: { 'x-file-owner': ownerId } });
          return { files: list.files, download: download.status, remove: remove.status, spoof: spoof.status };
        },
        { id: txt.id, ownerId: owner.id },
      );
      record('另一普通账号看不到当前用户文件', other.user.role === 'member' && attack.files.length === 0);
      record('越权文件下载与删除均拒绝', attack.download === 404 && attack.remove === 404, JSON.stringify(attack));
      record('伪造 owner 不能越过当前会话身份', attack.spoof === 409);
      record('越权尝试未破坏原件', (await binary(txt.id)).equals(fixtureText));
    } finally {
      await otherContext.close();
    }
  });

  await scenario('文件选择搜索空状态和附件上限', async () => {
    await visit('/ai?scope=workspace');
    await page.click('[aria-label="选择科研文件"]');
    await page.waitForSelector('.studio-file-picker > button');
    await fill('.studio-file-picker [aria-label="搜索科研文件"]', '没有这个文件_8547');
    await until(
      async () => page.$eval('.studio-file-picker', (el) => el.textContent.includes('没有匹配的文件')),
      '选择器没有搜索空状态',
    );
    await clickText('.studio-file-picker button', '清空搜索');
    await page.waitForSelector('.studio-file-picker > button');
    record('搜索无结果时可以一键恢复文件列表', true);
    for (let count = 1; count <= 6; count++) {
      const choice = await page.$('.studio-file-picker > button:not(:disabled)');
      if (!choice) throw new Error('未到附件上限已没有可选文件');
      await choice.click();
      await until(
        async () =>
          page.$eval(
            '.studio-file-picker-status',
            (el, count) => el.textContent.includes('已附带 ' + count + ' / 6') && !el.querySelector('[role="status"]'),
            count,
          ),
        '第 ' + count + ' 个附件没有准备完成',
      );
    }
    record(
      '六个附件后禁用继续附带，已选项明确标记',
      await page.$$eval(
        '.studio-file-picker > button',
        (buttons) =>
          buttons.every((button) => button.disabled) &&
          buttons.filter((button) => button.textContent.includes('已附带')).length === 6,
      ),
    );
    await clickText('[aria-label="科研文件选择"] button', '完成');
    await page.waitForSelector('[aria-label="科研文件选择"]', { hidden: true });
    await page.setViewport({ width: 390, height: 500 });
    await layout('390x500-six-attachments');
    await page.setViewport({ width: 1440, height: 1000 });
  });

  await scenario('批量文件关联、压缩包与 AI 对比', async () => {
    await page.setViewport({ width: 1440, height: 1000 });
    await visit('/files');
    await clickText('.page-head button', '多选');
    await page.click('[data-file-id="' + txt.id + '"] .file-name-button');
    record(
      '多选模式点击文件名即可选中，不会误开预览',
      (await page.$eval(
        '[data-file-id="' + txt.id + '"] .file-name-button',
        (el) => el.getAttribute('aria-pressed') === 'true',
      )) && !(await page.$('[aria-label="科研文件详情"]')),
    );
    await page.click('[data-file-id="' + pdf.id + '"] [role="checkbox"]');
    record(
      '多选只包含指定文件',
      await page.$eval('[aria-label="文件批量操作"]', (el) => el.textContent.includes('已选 2 个')),
    );
    const patchStart = filePatches.length;
    failPatchId = pdf.id;
    await clickText('[aria-label="文件批量操作"] button', '关联项目');
    await page.waitForSelector('[role="dialog"] select');
    await page.select('[role="dialog"] select', projectId);
    await clickText('[role="dialog"] button', '保存关联');
    await until(
      async () =>
        page.$eval('[role="dialog"] [role="alert"]', (el) => el.textContent.includes('1 个失败')).catch(() => false),
      '批量失败没有清晰反馈',
    );
    record(
      '部分关联失败只保留失败文件',
      await page.$eval(
        '.files-assignment-list',
        (el, name) => el.children.length === 1 && el.textContent.includes(name),
        pdf.name,
      ),
    );
    await clickText('[role="dialog"] button', '重试失败项');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    const patches = filePatches.slice(patchStart);
    record(
      '批量重试不重复更新成功文件',
      patches.filter((id) => id === txt.id).length === 1 && patches.filter((id) => id === pdf.id).length === 2,
    );
    record(
      '批量关联在服务器真实保存',
      (await listing()).files.filter((f) => [txt.id, pdf.id].includes(f.id)).every((f) => f.projectId === projectId),
    );
    await clickText('.page-head button', '多选');
    await page.click('[data-file-id="' + txt.id + '"] [role="checkbox"]');
    await page.click('[data-file-id="' + pdf.id + '"] [role="checkbox"]');
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    await clickText('[aria-label="文件批量操作"] button', '打包下载');
    await until(() => fs.readdirSync(downloads).some((name) => name.endsWith('.zip')), '批量压缩包没有下载');
    const zipped = await JSZip.loadAsync(
      fs.readFileSync(
        path.join(
          downloads,
          fs.readdirSync(downloads).find((name) => name.endsWith('.zip')),
        ),
      ),
    );
    record(
      '界面导出的ZIP包含两份完整原字节',
      Object.keys(zipped.files).length === 2 &&
        (await zipped.file(txt.name).async('nodebuffer')).equals(fixtureText) &&
        (await zipped.file(pdf.name).async('nodebuffer')).equals(fixturePdf),
    );
    await cdp.detach();
    await capture('1440-file-batch-selection');
    await page.setViewport({ width: 390, height: 500 });
    await page.$eval('[aria-label="文件批量操作"]', (el) => el.scrollIntoView({ block: 'start' }));
    await layout('390x500-batch-selection');
    const pinnedTop = await page.$eval('[aria-label="文件批量操作"]', (el) => el.getBoundingClientRect().top);
    await page.$eval('#main-content', (el) => {
      el.scrollTop += 80;
    });
    await delay(100);
    record(
      '滚动选择文件时批量操作栏持续可见',
      await page.$eval(
        '[aria-label="文件批量操作"]',
        (el, top) => {
          const box = el.getBoundingClientRect();
          return Math.abs(box.top - top) < 2 && box.top >= 64 && box.bottom < innerHeight;
        },
        pinnedTop,
      ),
    );
    await capture('390x500-file-batch-selection');
    await page.setViewport({ width: 1440, height: 1000 });
    await clickText('[aria-label="文件批量操作"] button', '交给 AI');
    await until(
      async () =>
        page.$$eval('[aria-label="待发送附件"] .studio-attachment', (nodes) => nodes.length === 2).catch(() => false),
      '多文件入口没有完整附带两份文件',
    );
    await page.click('[aria-label="资料与模型"]');
    await page.waitForSelector('#ai-scope');
    record(
      '同项目多文件自动带入项目范围',
      await page.$eval('#ai-scope', (el, id) => el.value === 'project:' + id, projectId),
    );
    await clickText('[role="dialog"] button', '完成');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    record(
      '连续成功通知不堆叠遮挡发送按钮',
      (await page.$$eval('.toast-viewport [data-state="open"]', (items) => items.length <= 1)) &&
        (await page.$eval('[aria-label="发送"]', (el) => {
          const box = el.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === el;
        })),
    );
    const request = await send('[batch-compare] 对比这两份科研资料');
    const serialized = JSON.stringify(request.messages);
    record('多文件对比将两份实际正文交给模型', serialized.includes(textToken) && serialized.includes(pdfToken));
    await capture('1440-file-batch-ai');
  });

  await scenario('项目内直接管理科研文件', async () => {
    await visit('/projects/' + projectId);
    await until(
      async () =>
        page
          .$eval('[aria-label="项目科研文件"]', (el, name) => el.textContent.includes(name), txt.name)
          .catch(() => false),
      '项目概览没有关联文件',
    );
    record('项目概览显示真实文件摘要', true);
    await capture('1440-project-files-overview');
    await page.click('[role="tab"][data-state="inactive"]:last-child');
    await page.waitForSelector('.files-embedded');
    record(
      '项目文件页保持项目范围且不显示跨项目选择器',
      (await page.$eval('.files-embedded [aria-label="科研文件列表"]', (el) => el.children.length === 2)) &&
        !(await page.$('[aria-label="按关联项目筛选文件"]')),
    );
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['PROJECT_FILE_BYTES_3106'], 'project-context.txt', { type: 'text/plain' }));
      document.querySelector('input[aria-label="上传科研文件"]').files = transfer.files;
      document.querySelector('input[aria-label="上传科研文件"]').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(
      async () => (await listing()).files.some((f) => f.name === 'project-context.txt'),
      '项目内上传没有保存',
    );
    const added = (await listing()).files.find((f) => f.name === 'project-context.txt');
    record(
      '项目内上传自动关联当前项目且保留原字节',
      added.projectId === projectId && (await binary(added.id)).equals(Buffer.from('PROJECT_FILE_BYTES_3106')),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-file-id="' + added.id + '"]');
    record('刷新后项目文件标签与数据保留', new URL(page.url()).searchParams.get('tab') === 'files');
    await capture('1440-project-files-tab');
    await page.setViewport({ width: 390, height: 500 });
    await layout('390x500-project-files-tab');
    record(
      '项目文件页收起冗长项目头，保留文件操作空间',
      await page.$eval('.project-identity', (el) => el.getBoundingClientRect().height < 180),
    );
    await capture('390x500-project-files-tab');
    await page.setViewport({ width: 1440, height: 1000 });
  });

  await scenario('完整删除流程', async () => {
    await visit('/files');
    const disposable = (await listing()).files.find((file) => file.name === 'retry-notes.txt');
    if (!disposable) throw new Error('重试文件不存在');
    await page.click('[aria-label="文件操作：retry-notes.txt"]');
    await clickText('[role="menuitem"]', '删除文件');
    await page.waitForSelector('[role="dialog"]');
    record(
      '删除前明确确认文件名',
      await page.$eval('[role="dialog"]', (el) => el.textContent.includes('retry-notes.txt')),
    );
    await clickText('[role="dialog"] button', '删除文件');
    await until(async () => !(await listing()).files.some((file) => file.id === disposable.id), '删除没有写入服务器');
    record(
      '确认删除后原文件不可下载',
      await page.evaluate(async (id) => (await fetch('/api/files/' + id + '/content')).status === 404, disposable.id),
    );
  });

  await scenario('拖入文件真实保存', async () => {
    await visit('/files?project=' + projectId);
    await page.waitForSelector('[data-testid="file-drop-zone"]');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['DROPPED_RESEARCH_BYTES_7523'], 'dropped-research.txt', { type: 'text/plain' }));
      document.querySelector('[data-testid="file-drop-zone"]').dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
    await until(
      async () => (await listing()).files.some((file) => file.name === 'dropped-research.txt'),
      '拖入文件没有保存',
    );
    const saved = (await listing()).files.find((file) => file.name === 'dropped-research.txt');
    record(
      '拖放文件保存原字节并关联当前项目',
      saved.projectId === projectId && (await binary(saved.id)).equals(Buffer.from('DROPPED_RESEARCH_BYTES_7523')),
    );
  });

  await scenario('桌面与手机布局', async () => {
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
      [390, 500],
    ]) {
      const size = width + 'x' + height;
      await page.setViewport({ width, height });
      await visit('/files');
      await page.waitForSelector('[aria-label="科研文件列表"]');
      await layout(`${size}-file-vault`);
      if (picture) {
        await visit('/files?focus=' + picture.id);
        await page.waitForSelector('[aria-label="科研文件详情"]');
        await delay(220);
        await until(
          async () => page.$eval('.file-preview img', (img) => img.complete && img.naturalWidth > 0).catch(() => false),
          '文件库图片未完成安全预览',
        );
        record(
          width + 'px 文件详情预览保持在屏内',
          await page.$eval('[aria-label="科研文件详情"]', (el) => {
            const box = el.getBoundingClientRect();
            return box.left >= -1 && box.right <= innerWidth + 1;
          }),
        );
        await capture(size + '-file-vault-image-preview');
        await closeDrawer();
      }
      if (width === 390 && height === 500) {
        await visit('/files?focus=' + pdf.id);
        await until(
          async () => page.$eval('.pdf-preview canvas', (canvas) => canvas.dataset.page === '1').catch(() => false),
          '手机 PDF 未绘制',
        );
        await delay(350);
        record(
          '390x500 PDF 阅读控件与页面保持在屏内',
          await page.$eval('.pdf-preview', (el) => {
            const box = el.getBoundingClientRect();
            const canvas = el.querySelector('canvas').getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth + 1 &&
              canvas.width <= el.clientWidth &&
              el.querySelector('.pdf-preview-viewport').getAttribute('aria-busy') === 'false'
            );
          }),
        );
        await capture('390x500-pdf-reader');
        await closeDrawer();
      }
      await visit('/ai?scope=workspace');
      await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
      await layout(`${size}-studio-empty`);
      await page.click('[aria-label="选择科研文件"]');
      await page.waitForSelector('[aria-label="科研文件选择"]');
      await delay(220);
      await until(
        async () => page.$eval('.studio-file-picker', (el, name) => el.textContent.includes(name), txt.name),
        '布局检查文件选择未加载',
      );
      record(
        width + 'px 文件选择抽屉保持在屏内',
        await page.$eval('[aria-label="科研文件选择"]', (el) => {
          const box = el.getBoundingClientRect();
          return box.left >= -1 && box.right <= innerWidth + 1;
        }),
      );
      await capture(size + '-studio-file-picker');
      await fill('[aria-label="科研文件选择"] [aria-label="搜索科研文件"]', 'clipboard-study.png');
      await page.click('.studio-file-picker button');
      await until(
        async () => page.$eval('.studio-file-picker button', (button) => button.disabled),
        '布局检查选图片失败',
      );
      await clickText('[aria-label="科研文件选择"] button', '完成');
      await page.waitForSelector('[aria-label="科研文件选择"]', { hidden: true });
      await until(async () => Boolean(await page.$('[aria-label="待发送附件"] img')), '布局检查图片预览未加载');
      await layout(`${size}-studio-image-attached`);
    }
  });
  record('所有页面无运行时异常', errors.length === 0, errors.join('\n'));
  record('浏览器未访问外部服务', blockedExternal.length === 0, blockedExternal.join('\n'));
} catch (error) {
  record('隔离验收环境', false, String(error));
  await capture('environment-failure').catch(() => {});
} finally {
  await browser?.close();
  for (const child of [preview, backend])
    if (child && child.exitCode === null) {
      const done = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await done;
    }
  await new Promise((resolve) => mock.close(resolve));
  fs.writeFileSync(
    path.join(output, 'report.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results, modelRequests, errors, blockedExternal, diagnostics },
      null,
      2,
    ),
  );
  const resolved = path.resolve(temporary),
    tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('research-files-verification-'))
    throw new Error('拒绝清理非本次临时目录');
  fs.rmSync(resolved, { recursive: true, force: true });
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
