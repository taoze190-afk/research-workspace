import { chromeExecutable } from './browser.mjs';
// 独立浏览器验收 AI 工作室：只使用演示数据与本地模拟模型，不连接真实账号或模型。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'shots', 'ai-studio');
const chrome = chromeExecutable();
const viewports = [
  [1440, 1000],
  [1280, 1000],
  [768, 900],
  [390, 900],
  [390, 500],
];
const focusRemoveOnly = process.argv.includes('--focus-remove');
const results = [];
const modelRequests = [];
const failedOnce = new Set();
const activeResponses = new Set();
let browser;
let preview;
let profile;
let fixtureServer;
let previewOutput = '';
fs.mkdirSync(output, { recursive: true });

function record(name, passed, detail = '', scenario = '') {
  const result = { scenario, name, passed, detail };
  results.push(result);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${scenario ? `${scenario} ` : ''}${name}${detail ? `: ${detail}` : ''}`);
  return passed;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function reservePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForPreview(base) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (preview.exitCode !== null) throw new Error(`Vite preview 已退出：${previewOutput}`);
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Vite preview 启动超时：${previewOutput}`);
}

function createFixtureServer() {
  return http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404);
      response.end();
      return;
    }
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      const question = body.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? '';
      const entry = { question, messages: body.messages, model: body.model, stream: body.stream, aborted: false };
      modelRequests.push(entry);
      if (question.includes('[失败后重试]') && !failedOnce.has(question)) {
        failedOnce.add(question);
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: '本地模拟：暂时不可用' } }));
        return;
      }
      const chunks = question.includes('[长回答]')
        ? [
            '## 研究计划与验证路径\n\n',
            ...Array.from(
              { length: 38 },
              (_, i) =>
                `### ${i + 1}. 第 ${i + 1} 项研究检查\n\n先明确研究问题，再记录实验方法、数据来源与判断标准。根据当前项目逐步验证假设，保留每一次观察与结果，区分已知事实和需要补充的证据。每个阶段都应安排可复核的任务与完成条件。\n\n`,
            ),
          ]
        : question.includes('[停止]')
          ? Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段正在生成的模拟回答。\n\n`)
          : [
              question.includes('[失败后重试]')
                ? '重试成功，沿用同一轮问题和已有历史。'
                : '已收到问题，这是本地模拟模型的回答。',
            ];
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      activeResponses.add(response);
      let index = 0;
      const tick = () => {
        if (response.destroyed) return;
        if (index >= chunks.length) {
          response.end('data: [DONE]\n\n');
          return;
        }
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] })}\n\n`);
      };
      const timer = setInterval(tick, question.includes('[停止]') ? 180 : 26);
      response.on('close', () => {
        clearInterval(timer);
        activeResponses.delete(response);
        entry.aborted = index < chunks.length;
      });
      tick();
    });
  });
}

async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) =>
      [...document.querySelectorAll(sel)].find(
        (element) => element.textContent.replace(/\s+/g, '') === needle.replace(/\s+/g, ''),
      ),
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new Error(`找不到按钮：${text}`);
  }
  await element.click();
  await handle.dispose();
}

async function fill(page, text) {
  await page.$eval(
    'textarea[aria-label="向 AI 提问"]',
    (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    text,
  );
}

async function send(page, text) {
  await fill(page, text);
  await page.focus('textarea[aria-label="向 AI 提问"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
}

async function waitForIdle(page) {
  await page.waitForSelector('button[aria-label="发送"]', { visible: true, timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'false');
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        right: Math.round(box.right),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const main = document.querySelector('main');
    const studio = document.querySelector('.ai-studio');
    const outerScroll = {
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      mainHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
    };
    const composer = rect('.ai-studio-composer');
    const textarea = rect('textarea[aria-label="向 AI 提问"]');
    const send = rect('button[aria-label="发送"], button[aria-label="停止生成"]');
    const overflowing = [...document.querySelectorAll('.ai-studio *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
      })
      .slice(0, 6)
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        className: String(element.className),
        right: Math.round(element.getBoundingClientRect().right),
      }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      composer,
      textarea,
      send,
      inputVisible: Boolean(
        composer &&
          textarea &&
          send &&
          composer.top >= 0 &&
          composer.bottom <= innerHeight + 1 &&
          textarea.top >= 0 &&
          send.bottom <= innerHeight + 1,
      ),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        main.scrollWidth <= main.clientWidth + 1 &&
        studio.scrollWidth <= studio.clientWidth + 1 &&
        overflowing.length === 0,
      noOuterVerticalScroll:
        outerScroll.documentHeight <= innerHeight + 1 &&
        outerScroll.bodyHeight <= innerHeight + 1 &&
        outerScroll.mainScrollHeight <= outerScroll.mainHeight + 1,
      outerScroll,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: main.clientWidth,
      mainScrollWidth: main.scrollWidth,
      overflowing,
    };
  });
}

async function openInspector(page, width) {
  if (!(await page.$('[role="dialog"][aria-label="资料与模型设置"]'))) {
    await page.click('button[aria-label="资料与模型"]');
  }
  await page.waitForSelector('[role="dialog"][aria-label="资料与模型设置"]', { visible: true });
}

async function closeInspector(page, width) {
  if (await page.$('[role="dialog"][aria-label="资料与模型设置"]')) {
    await clickText(page, '[role="dialog"][aria-label="资料与模型设置"] button', '完成');
    await page.waitForSelector('[role="dialog"][aria-label="资料与模型设置"]', { hidden: true });
  }
}

async function runScenario(base, modelBase, width, height, theme) {
  const scenario = `${width}${height === 500 ? 'x500' : ''}-${theme}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const blockedExternal = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.emulateTimezone('Asia/Shanghai');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(`${base}/api/`))
      return request.respond({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"isolated-local-preview"}',
      });
    if (url.startsWith(base) || url.startsWith(modelBase) || url.startsWith('data:')) return request.continue();
    blockedExternal.push(url);
    return request.abort();
  });
  await page.evaluateOnNewDocument(
    (selectedTheme, fixtureBase) => {
      localStorage.setItem('rw.mode.v1', 'local');
      localStorage.setItem(
        'rw.prefs.v1',
        JSON.stringify({ ...JSON.parse(localStorage.getItem('rw.prefs.v1') ?? '{}'), theme: selectedTheme }),
      );
      localStorage.setItem(
        'rw.ai.v1',
        JSON.stringify({ enabled: true, baseUrl: `${fixtureBase}/v1`, apiKey: '', model: 'local-visual-fixture' }),
      );
    },
    theme,
    modelBase,
  );
  try {
    await page.goto(base, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', '体验示例');
    await page.waitForSelector('nav[aria-label="概览"]');
    await page.goto(`${base}/ai`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
    await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, {}, theme);
    // 默认工作区会附带当前账号摘要；本场景明确选择“无资料”，保留原先的隐私开关回归。
    await openInspector(page, width);
    await page.focus('#ai-scope');
    await page.select('#ai-scope', 'none');
    await closeInspector(page, width);
    record('主题正确', true, theme, scenario);
    const initialLayout = await inspectLayout(page);
    record('输入区在首屏内', initialLayout.inputVisible, JSON.stringify(initialLayout), scenario);
    record('页面无横向溢出', initialLayout.noHorizontalOverflow, JSON.stringify(initialLayout.overflowing), scenario);
    record(
      '首屏无外层纵向滚动',
      initialLayout.noOuterVerticalScroll,
      JSON.stringify(initialLayout.outerScroll),
      scenario,
    );
    await page.screenshot({ path: path.join(output, `${scenario}-empty.png`) });

    const ordinaryQuestion = `[不附资料] ${scenario} 先讨论研究方法`;
    await send(page, ordinaryQuestion);
    await waitForIdle(page);
    const ordinaryRequest = modelRequests.find((entry) => entry.question === ordinaryQuestion);
    record(
      '明确选择不附带资料后 Ctrl+Enter 可发送',
      Boolean(ordinaryRequest && ordinaryRequest.messages.filter((message) => message.role === 'system').length === 1),
      '',
      scenario,
    );
    await clickText(page, '.ai-studio-heading-actions button', '新对话');
    await page.waitForFunction(() => document.querySelectorAll('.ai-studio-user').length === 0);
    record(
      '新对话保留此前会话历史',
      await page.evaluate(
        (question) =>
          Object.entries(localStorage).some(
            ([key, value]) => key.startsWith('rw.studio.v2.') && value.includes(question),
          ),
        ordinaryQuestion,
      ),
      '',
      scenario,
    );

    await openInspector(page, width);
    const projects = await page.$$eval('#ai-scope optgroup[label="项目"] option', (options) =>
      options.map((option) => ({ value: option.value, label: option.textContent })),
    );
    if (!projects.length) throw new Error('演示项目没有进入资料选择器');
    await page.focus('#ai-scope');
    await page.select('#ai-scope', projects[0].value);
    record(
      '可选择实际演示资料',
      (await page.$eval('#ai-scope', (select) => select.value)) === projects[0].value,
      projects[0].label,
      scenario,
    );
    {
      await page.screenshot({ path: path.join(output, `${scenario}-materials-drawer.png`) });
      record(
        '资料与模型抽屉在屏幕内',
        await page.$eval('[role="dialog"][aria-label="资料与模型设置"]', (element) => {
          const box = element.getBoundingClientRect();
          return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
        }),
        '',
        scenario,
      );
    }
    await closeInspector(page, width);
    {
      record('完成按钮关闭资料抽屉', !(await page.$('[role="dialog"][aria-label="资料与模型设置"]')), '', scenario);
      await delay(80);
      const restoredFocus = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label'),
      }));
      record(
        '资料抽屉关闭后焦点回到打开入口',
        restoredFocus.label === '资料与模型',
        JSON.stringify(restoredFocus),
        scenario,
      );
    }

    const longQuestion = `[长回答] ${scenario} 根据选中项目梳理研究计划`;
    await send(page, longQuestion);
    await page.waitForFunction(() => {
      const thread = document.querySelector('[role="log"]');
      return thread?.scrollHeight - thread?.clientHeight > 300 && thread?.getAttribute('aria-busy') === 'true';
    });
    await page.$eval('[role="log"]', (element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await delay(200);
    const readingPosition = await page.$eval('[role="log"]', (element) => element.scrollTop);
    record('生成中阅读旧回答不会被强制拉回底部', readingPosition <= 2, `scrollTop=${readingPosition}`, scenario);
    await waitForIdle(page);
    const longRequest = modelRequests.find((entry) => entry.question === longQuestion);
    record(
      '模型请求包含实际选中资料',
      Boolean(
        longRequest?.messages.some(
          (message) => message.role === 'system' && message.content.includes(projects[0].label),
        ),
      ),
      '',
      scenario,
    );
    const longLayout = await inspectLayout(page);
    record('长回答后输入区仍在首屏内', longLayout.inputVisible, JSON.stringify(longLayout), scenario);
    record('长回答无横向溢出', longLayout.noHorizontalOverflow, JSON.stringify(longLayout.overflowing), scenario);
    record('长回答无外层纵向滚动', longLayout.noOuterVerticalScroll, JSON.stringify(longLayout.outerScroll), scenario);
    record(
      '向上阅读出现回到最新入口',
      await page.$$eval('.ai-studio-latest', (buttons) =>
        buttons.some((button) => button.textContent.includes('回到最新')),
      ),
      '',
      scenario,
    );
    await page.screenshot({ path: path.join(output, `${scenario}-long-answer.png`) });
    await clickText(page, 'button.ai-studio-latest', '回到最新');
    const bottomDistance = await page.$eval(
      '[role="log"]',
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    record('回到最新按钮滚到回答末尾', bottomDistance <= 2, `bottomDistance=${bottomDistance}`, scenario);

    await openInspector(page, width);
    await page.focus('#ai-scope');
    await page.select('#ai-scope', 'none');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.ai-studio-user').length === 0 &&
        document.querySelector('#ai-scope')?.value === 'none',
    );
    await delay(80);
    const changedFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
    }));
    record('切换资料后选择器仍可继续操作', changedFocus.id === 'ai-scope', JSON.stringify(changedFocus), scenario);
    record(
      '切换资料创建独立会话且旧对话保留',
      await page.evaluate(
        (question) =>
          Object.entries(localStorage).some(
            ([key, value]) => key.startsWith('rw.studio.v2.') && value.includes(question),
          ),
        longQuestion,
      ),
      '',
      scenario,
    );
    await closeInspector(page, width);
    await page.click('button[aria-label="对话记录"]');
    await page.waitForSelector('[role="dialog"][aria-label="对话历史"]');
    const archived = await page.evaluateHandle(
      (prefix) =>
        [...document.querySelectorAll('[role="dialog"][aria-label="对话历史"] button')].find((button) =>
          button.textContent.includes(prefix),
        ),
      longQuestion.slice(0, 16),
    );
    if (!archived.asElement()) throw new Error('对话记录中没有刚才的长回答');
    await archived.asElement().click();
    await archived.dispose();
    await page.waitForSelector('[role="dialog"][aria-label="对话历史"]', { hidden: true });
    await page.waitForFunction(
      (question) =>
        [...document.querySelectorAll('.ai-studio-user')].some(
          (element) =>
            [...element.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent)
              .join('') === question,
        ),
      {},
      longQuestion,
    );
    await openInspector(page, width);
    record(
      '历史记录恢复原资料与完整对话',
      (await page.$eval('#ai-scope', (select) => select.value)) === projects[0].value &&
        (await page.$$eval('.ai-studio-prose', (elements) =>
          elements.some((element) => element.textContent.includes('第 38 项研究检查')),
        )),
      '',
      scenario,
    );
    await closeInspector(page, width);

    if (width === 1440 && theme === 'light') {
      const retryQuestion = `[失败后重试] ${scenario} 继续同一轮问题`;
      await send(page, retryQuestion);
      await page.waitForSelector('.ai-studio-feedback[role="alert"]');
      await clickText(page, '.ai-studio-feedback button', '重试');
      await waitForIdle(page);
      const attempts = modelRequests.filter((entry) => entry.question === retryQuestion);
      record(
        '失败后重试不重复追加用户历史',
        attempts.length === 2 &&
          JSON.stringify(attempts[0].messages) === JSON.stringify(attempts[1].messages) &&
          attempts[1].messages.filter((message) => message.role === 'user' && message.content === retryQuestion)
            .length === 1 &&
          (await page.$$eval(
            '.ai-studio-user',
            (elements, question) =>
              elements.filter(
                (element) =>
                  [...element.childNodes]
                    .filter((n) => n.nodeType === Node.TEXT_NODE)
                    .map((n) => n.textContent)
                    .join('') === question,
              ).length === 1,
            retryQuestion,
          )),
        '',
        scenario,
      );
      const stopQuestion = `[停止] ${scenario} 模拟较慢的回答`;
      await send(page, stopQuestion);
      await page.waitForSelector('button[aria-label="停止生成"]', { visible: true });
      await page.waitForFunction(() => document.querySelectorAll('.ai-studio-prose').length >= 3);
      await page.click('button[aria-label="停止生成"]');
      await waitForIdle(page);
      record(
        '停止生成恢复输入并保留已有内容',
        (await page.$eval('.ai-studio-feedback', (element) => element.textContent.includes('已停止生成'))) &&
          modelRequests.some((entry) => entry.question === stopQuestion && entry.aborted),
        '',
        scenario,
      );
      await page.screenshot({ path: path.join(output, `${scenario}-stopped.png`) });
    }
    await openInspector(page, width);
    await page.focus('#ai-scope');
    await page.select('#ai-scope', 'none');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.ai-studio-user').length === 0 &&
        document.querySelector('#ai-scope')?.value === 'none',
    );
    await delay(80);
    const removedFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
      label: document.activeElement?.getAttribute('aria-label'),
    }));
    record(
      '移除资料后焦点仍在可用控件',
      removedFocus.id === 'ai-scope' || removedFocus.label === '向 AI 提问',
      JSON.stringify(removedFocus),
      scenario,
    );
    await page.screenshot({ path: path.join(output, `${scenario}-removed-materials.png`) });
    await closeInspector(page, width);
    record('无运行时异常', errors.length === 0, errors.join('\n'), scenario);
    record('未访问外部账号或模型服务', blockedExternal.length === 0, blockedExternal.join('\n'), scenario);
  } catch (error) {
    record('场景验收完成', false, String(error), scenario);
    await page.screenshot({ path: path.join(output, `${scenario}-failure.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

try {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html')))
    throw new Error('缺少 dist/index.html，请先运行 npm run build');
  fixtureServer = createFixtureServer();
  const modelPort = await listen(fixtureServer);
  const previewPort = await reservePort();
  const base = `http://127.0.0.1:${previewPort}`;
  const modelBase = `http://127.0.0.1:${modelPort}`;
  preview = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(previewPort),
      '--strictPort',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  preview.stdout.on('data', (data) => {
    previewOutput += String(data);
  });
  preview.stderr.on('data', (data) => {
    previewOutput += String(data);
  });
  await waitForPreview(base);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'research-ai-studio-'));
  browser = await puppeteer.launch({
    executablePath: chrome,
    userDataDir: profile,
    headless: true,
    args: ['--no-first-run', '--hide-scrollbars', '--force-prefers-reduced-motion'],
  });
  for (const [width, height] of viewports)
    for (const theme of ['light', 'dark']) {
      if (focusRemoveOnly && !(width === 390 && height === 500 && theme === 'light')) continue;
      await runScenario(base, modelBase, width, height, theme);
    }
} catch (error) {
  record('验收环境启动', false, String(error));
} finally {
  await browser?.close();
  for (const response of activeResponses) response.destroy();
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  if (preview && preview.exitCode === null) {
    const stopped = new Promise((resolve) => preview.once('exit', resolve));
    preview.kill();
    await stopped;
  }
  if (profile) {
    const resolvedProfile = path.resolve(profile);
    const temporaryRoot = path.resolve(os.tmpdir());
    if (
      !resolvedProfile.startsWith(`${temporaryRoot}${path.sep}`) ||
      !path.basename(resolvedProfile).startsWith('research-ai-studio-')
    )
      throw new Error(`拒绝清理非本次临时目录：${resolvedProfile}`);
    fs.rmSync(resolvedProfile, { recursive: true, force: true });
  }
  fs.writeFileSync(
    path.join(output, focusRemoveOnly ? 'focus-remove-report.json' : 'report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results, modelRequests }, null, 2),
  );
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
