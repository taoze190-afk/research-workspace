import { chromeExecutable } from './browser.mjs';
// AI 读写闭环验收：临时账号、临时 SQLite、独立 Chrome、本地模型；不接触正式数据或模型。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'research-ai-integration-v2-'));
const output = path.join(root, 'shots', 'ai-integration-v2');
const results = [];
const modelRequests = [];
const errors = [];
const blockedExternal = [];
const diagnostics = [];
let backend, preview, browser, base, page;
fs.mkdirSync(output, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
async function until(predicate, message, attempts = 80) {
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
const stamp = Date.now();
const row = (id) => ({ id, createdAt: stamp, updatedAt: stamp, deletedAt: null, isDemo: false });
const ids = {
  project: 'ai-v2-project',
  task: 'ai-v2-task',
  subtask: 'ai-v2-subtask',
  milestone: 'ai-v2-milestone',
  experiment: 'ai-v2-experiment',
  reference: 'ai-v2-reference',
};
const fixture = {
  projects: [
    {
      ...row(ids.project),
      name: '闭环测试课题',
      question: '已知研究问题 A',
      goal: '完成可复核的研究闭环',
      status: 'active',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      favorite: true,
    },
  ],
  tasks: [
    {
      ...row(ids.task),
      title: '现有待处理任务',
      description: '任务上下文标记 B',
      status: 'todo',
      priority: 'medium',
      dueDate: '2026-11-01',
      projectId: ids.project,
      sourceExperimentId: null,
      referenceId: null,
      completedAt: null,
      recurrence: 'none',
    },
  ],
  subtasks: [{ ...row(ids.subtask), taskId: ids.task, title: '当前子任务标记 C', done: false, sortOrder: 0 }],
  milestones: [
    {
      ...row(ids.milestone),
      projectId: ids.project,
      title: '既有里程碑标记 D',
      dueDate: '2026-11-03',
      done: false,
      sortOrder: 0,
    },
  ],
  experiments: [
    {
      ...row(ids.experiment),
      projectId: ids.project,
      title: '实验上下文标记 E',
      status: 'active',
      experimentDate: '2026-10-25',
      purpose: '验证真实读写',
      hypothesis: '顺序追加不会覆盖',
      dataSources: [{ id: 'source-v2', kind: 'metric', label: '准确率 0.82' }],
      method: '固定对照步骤',
      results: '原始结果',
      observations: '观察记录',
      conclusion: '',
      nextStep: '下一步待填写',
      repoUrl: '',
      commit: '',
      sourceExperimentId: null,
    },
  ],
  references: [
    {
      ...row(ids.reference),
      title: '文献上下文标记 F',
      authors: '测试作者',
      year: 2025,
      venue: '本地验收资料',
      doi: '10.1234/source-fixture',
      url: '',
      readingStatus: 'reading',
      favorite: false,
      noteQuestion: '文献问题标记 G',
      noteMethod: '对照分析',
      noteFindings: '已有发现',
      noteLimits: '',
      noteRelevance: '',
    },
  ],
  projectReferences: [{ ...row('ai-v2-project-reference'), projectId: ids.project, referenceId: ids.reference }],
  tags: [],
  entityTags: [],
};
const action = (value) => '```action\n' + JSON.stringify(value) + '\n```';
const createTaskTitle = 'AI 已创建的验证任务';
const milestoneTitle = 'AI 已创建的验证里程碑';
const experimentTitle = 'AI 已创建的验证实验';
const referenceTitle = 'AI 已创建的验证文献';
const retryTitle = '存储失败后重试的任务';
const atomicTitles = ['原子操作第一项', '原子操作第二项'];
const relayTitle = '联动继续拆分任务';
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
  const rawQuestion = body.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const question = (typeof rawQuestion === 'string' ? rawQuestion : rawQuestion.find((part) => part.type === 'text')?.text || '').split('\n\n【用户附件：')[0];
  modelRequests.push({ question, messages: body.messages, model: body.model, at: Date.now() });
  let content = '已读取当前账号资料。这是用于验收的本地模拟回答。';
  if (question.includes('[project-flow]'))
    content =
      '已准备以下研究操作。\n' +
      [
        {
          action: 'create_task',
          title: createTaskTitle,
          description: '根据当前课题创建',
          priority: 'high',
          dueDate: '2026-11-04',
        },
        {
          action: 'update_task',
          taskId: ids.task,
          changes: { status: 'done', priority: 'urgent', dueDate: '2026-11-05' },
        },
        { action: 'create_milestones', items: [{ title: milestoneTitle, dueDate: '2026-11-10' }] },
        {
          action: 'create_experiment',
          title: experimentTitle,
          purpose: '从课题自动建立实验',
          hypothesis: '可保存且可重访',
        },
        {
          action: 'create_reference',
          title: referenceTitle,
          authors: '固定测试来源',
          year: 2025,
          doi: '10.1234/verified-study',
        },
      ]
        .map(action)
        .join('\n');
  if (question.includes('[append-flow]'))
    content =
      '建议补充两个观察结果。\n' +
      [
        { action: 'update_experiment', field: 'results', value: '顺序追加结果 A' },
        { action: 'update_experiment', field: 'results', value: '顺序追加结果 B' },
      ]
        .map(action)
        .join('\n');
  if (question.includes('[retry-flow]'))
    content = '请保存这个任务。\n' + action({ action: 'create_task', title: retryTitle });
  if (question.includes('[atomic-flow]'))
    content =
      '这两项必须一起执行。\n' + atomicTitles.map((title) => action({ action: 'create_task', title })).join('\n');
  if (question.includes('[invalid-flow]'))
    content = '测试不支持的操作。\n```action\n{bad JSON}\n```\n' + action({ action: 'delete_all_data' });
  if (question.includes('[relay-create]'))
    content = '准备下一步。\n' + action({ action: 'create_task', title: relayTitle });
  if (question.includes('[relay-split]'))
    content = '拆为两步。\n' + action({ action: 'add_subtasks', items: ['检查资料完整性', '核对验证指标'] });
  if (question.includes('[reference-state]'))
    content =
      '按明确要求标记已读并关联项目。\n' +
      [
        { action: 'set_reading_status', referenceId: ids.reference, readingStatus: 'read' },
        { action: 'link_reference_project', referenceId: ids.reference, projectId: ids.project },
      ]
        .map(action)
        .join('\n');
  if (question.includes('[experiment-state]'))
    content =
      '按明确要求完成实验。\n' +
      action({ action: 'set_experiment_status', experimentId: ids.experiment, status: 'done' });
  if (question.includes('[handoff-saved]'))
    content = '第一轮准备好了。\n' + action({ action: 'create_task', title: '副驾驶交接已保存' });
  if (question.includes('[handoff-pending]'))
    content = '第二轮等待采纳。\n' + action({ action: 'create_task', title: '副驾驶交接待处理' });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

async function api(url, body, method = 'POST', target = page) {
  return target.evaluate(
    async (url, body, method) => {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-rw-client': 'rw' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(result)}`);
      return result;
    },
    url,
    body,
    method,
  );
}
const snapshot = async () => (await api('/api/snapshot', undefined, 'GET')).data;
async function table(name) {
  return page.evaluate(async (name) => {
    const database = await new Promise((resolve, reject) => {
      const r = indexedDB.open('research-workspace');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = database.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
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
async function clickText(selector, text, clickCount = 1) {
  const handle = await page.evaluateHandle(
    (selector, text) =>
      [...document.querySelectorAll(selector)].find(
        (el) => el.textContent.trim().replace(/\s+/g, '') === text.replace(/\s+/g, ''),
      ),
    selector,
    text,
  );
  if (!handle.asElement()) throw new Error('没有找到操作：' + text);
  await handle.asElement().click({ clickCount });
  await handle.dispose();
}
async function send(text) {
  await paceModelRequest();
  await page.click('textarea[aria-label="向 AI 提问"]');
  await page.type('textarea[aria-label="向 AI 提问"]', text);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await until(async () => modelRequests.some((r) => r.question === text), '模型未收到请求：' + text);
  await page.waitForFunction(() => document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'false');
}
async function capture(name) {
  // 等待抽屉入场结束，截图不能把过渡帧误作半透明阅读面。
  await delay(220);
  await page.screenshot({ path: path.join(output, name + '.png') });
}
async function paceModelRequest() {
  const recent = modelRequests.filter((r) => r.at > Date.now() - 61_000);
  if (recent.length >= 8) {
    const remaining = recent[recent.length - 8].at + 61_000 - Date.now();
    console.log('INFO 遵循临时服务器模型频率限制，等待 ' + Math.ceil(remaining / 1000) + ' 秒');
    await delay(Math.max(0, remaining));
  }
}
async function layout(name) {
  const info = await page.evaluate(() => {
    const main = document.getElementById('main-content');
    const composer = document.querySelector('.ai-studio-composer')?.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      noOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1,
      composerVisible: !composer || (composer.top >= 0 && composer.bottom <= innerHeight + 1),
      openPanel: Boolean(document.querySelector('.ai-studio-inspector')),
    };
  });
  record(name + ' 无横向溢出', info.noOverflow, JSON.stringify(info));
  if (await page.$('.ai-studio')) {
    record(name + ' 输入区首屏可用', info.composerVisible);
    record(name + ' 默认不展开冗长侧栏', !info.openPanel);
  }
  await capture(name);
}
async function scenario(name, fn) {
  try {
    await fn();
  } catch (error) {
    record(name, false, String(error));
    await capture(name + '-failure').catch(() => {});
  }
}
async function failNextAdd(title) {
  await page.evaluate((title) => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (record, ...args) {
      if (this.name === 'tasks' && record?.title === title) {
        IDBObjectStore.prototype.add = original;
        throw new DOMException('本地验收：模拟一次存储失败', 'QuotaExceededError');
      }
      return original.call(this, record, ...args);
    };
  }, title);
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
    AI_API_KEY: 'temporary-fixture-key',
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
  }, '临时服务启动失败');
  browser = await puppeteer.launch({
    executablePath: chromeExecutable(),
    userDataDir: path.join(temporary, 'chrome'),
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-features=OverlayScrollbar'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateTimezone('Asia/Shanghai');
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith(base) || request.url().startsWith('data:')) return request.continue();
    blockedExternal.push(request.url());
    return request.abort();
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await api('/api/auth/signup', { email: 'ai-owner@example.test', password: 'Research2026!' });
  await api('/api/backup/import', { mode: 'replace', data: fixture });
  await api(
    '/api/admin/settings',
    { allowSignup: true, ai: { provider: 'custom', model: 'isolated-integration-model', enabled: true } },
    'PATCH',
  );
  await page.evaluate(() => localStorage.setItem('rw.prefs.v1', JSON.stringify({ theme: 'light', demoLoadedAt: 1 })));
  await visit('/');
  record(
    '临时账号与固定研究资料已就绪',
    (await snapshot()).projects.some((p) => p.id === ids.project),
  );
  record('未借用正式 SQLite 数据库', path.resolve(env.DATA_DIR).startsWith(path.resolve(temporary) + path.sep));

  await scenario('设置对齐', async () => {
    for (const width of [1440, 1920]) {
      await page.setViewport({ width, height: 1000 });
      await visit('/settings');
      for (const collapsed of [false, true]) {
        const toggle = collapsed ? '[aria-label="收起侧栏"]' : '[aria-label="展开侧栏"]';
        if (await page.$(toggle)) await page.click(toggle);
        await delay(100);
        const position = await page.evaluate(() => {
          const main = document.querySelector('main').getBoundingClientRect();
          const settings = document.querySelector('.settings-page').getBoundingClientRect();
          return {
            mainLeft: main.left,
            settingsLeft: settings.left,
            inset: settings.left - main.left,
            viewport: innerWidth,
          };
        });
        record(
          `${width}px 设置${collapsed ? '折叠' : '展开'}导航后贴近内容边缘`,
          position.inset >= 15 && position.inset <= 36,
          JSON.stringify(position),
        );
        await layout(`${width}-settings-${collapsed ? 'collapsed' : 'expanded'}`);
      }
    }
    if (await page.$('[aria-label="展开侧栏"]')) await page.click('[aria-label="展开侧栏"]');
  });

  await page.setViewport({ width: 1440, height: 1000 });
  await scenario('项目读取与多模块写入', async () => {
    await visit(`/projects/${ids.project}`);
    const assist = await page.evaluateHandle(() =>
      [...document.querySelectorAll('main a,main button')].find((el) => el.textContent.trim() === 'AI 协助'),
    );
    if (!assist.asElement()) throw new Error('项目详情缺少 AI 协助入口');
    await assist.asElement().click();
    await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
    record('项目入口进入安排下一步工作流', new URL(page.url()).searchParams.get('workflow') === 'next-steps');
    await page.click('[aria-label="资料与模型"]');
    await page.waitForSelector('[role="dialog"][aria-label="资料与模型设置"]');
    record(
      '业务入口带入当前项目',
      await page.$eval('#ai-scope', (el, id) => el.value === 'project:' + id, ids.project),
    );
    await clickText('[role="dialog"] button', '完成');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.$eval('textarea[aria-label="向 AI 提问"]', (el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await send('[project-flow] 读取课题并准备实际操作');
    const request = modelRequests.find((r) => r.question.includes('[project-flow]'));
    const context = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    record(
      '项目请求包含任务、子任务、里程碑、实验与文献',
      [ids.project, ids.task, ids.subtask, ids.milestone, ids.experiment, ids.reference, '文献问题标记 G'].every(
        (token) => context.includes(token),
      ),
    );
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    record('采纳前不会提前写入', !(await snapshot()).tasks.some((t) => t.title === createTaskTitle));
    const previewText = await page.$eval('[aria-label="AI 提议的动作"]', (el) => el.textContent);
    record(
      '执行前呈现真实动作预览',
      [createTaskTitle, '现有待处理任务', milestoneTitle, experimentTitle, referenceTitle].every((token) =>
        previewText.includes(token),
      ),
    );
    await capture('1440-project-action-preview');
    await clickText('[aria-label="AI 提议的动作"] button', '全部采纳', 2);
    await until(
      async () => (await snapshot()).references.some((r) => r.title === referenceTitle),
      '采纳后记录没有同步到临时SQLite',
    );
    const saved = await snapshot();
    record('双击不会重复创建任务', saved.tasks.filter((t) => t.title === createTaskTitle).length === 1);
    record(
      '任务准确更新状态、优先级和日期',
      saved.tasks.some(
        (t) => t.id === ids.task && t.status === 'done' && t.priority === 'urgent' && t.dueDate === '2026-11-05',
      ),
    );
    record(
      '任务与里程碑写入当前项目',
      saved.tasks.find((t) => t.title === createTaskTitle)?.projectId === ids.project &&
        saved.milestones.some((m) => m.title === milestoneTitle && m.projectId === ids.project),
    );
    record(
      '实验与文献写入并关联项目',
      saved.experiments.some((e) => e.title === experimentTitle && e.projectId === ids.project) &&
        saved.projectReferences.some(
          (link) =>
            link.projectId === ids.project &&
            link.referenceId === saved.references.find((r) => r.title === referenceTitle)?.id,
        ),
    );
    record(
      '已执行动作明确禁用',
      await page.$$eval(
        '[aria-label="AI 提议的动作"] button',
        (buttons) =>
          buttons.filter((button) => button.textContent.includes('已执行')).length >= 5 &&
          buttons.filter((button) => button.textContent.includes('已执行')).every((button) => button.disabled),
      ),
    );
    await capture('1440-project-actions-done');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    record(
      '刷新工作室保留执行状态且不重复写入',
      (await page.$$eval(
        '[aria-label="AI 提议的动作"] button',
        (buttons) => buttons.filter((button) => button.textContent.includes('已执行')).length >= 5,
      )) && (await snapshot()).tasks.filter((t) => t.title === createTaskTitle).length === 1,
    );
    await visit(`/projects/${ids.project}`);
    record(
      '刷新项目后可见 AI 新建里程碑',
      await page.$eval('main', (el, title) => el.textContent.includes(title), milestoneTitle),
    );
    await visit(`/tasks?filter=all&q=${encodeURIComponent(createTaskTitle)}`);
    record('刷新任务模块后可见 AI 任务', Boolean(await page.$(`button[title="${createTaskTitle}"]`)));
  });

  await scenario('编辑器读取与顺序追加', async () => {
    await visit(`/experiments/${ids.experiment}`);
    const resultField = await page.evaluateHandle(() => {
      const label = [...document.querySelectorAll('label')].find((el) => el.textContent.trim() === '结果');
      return label ? document.getElementById(label.htmlFor) : null;
    });
    if (!resultField.asElement()) throw new Error('找不到实验结果字段');
    await resultField.asElement().click();
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type('原始结果（离开前刚编辑）');
    const assist = await page.evaluateHandle(() =>
      [...document.querySelectorAll('main a,main button')].find((el) => el.textContent.trim() === 'AI 协助'),
    );
    if (!assist.asElement()) throw new Error('实验缺少AI协助');
    await assist.asElement().click();
    await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
    await page.$eval('textarea[aria-label="向 AI 提问"]', (el) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await send('[append-flow] 把两个观察追加到实验');
    record(
      'AI 入口读取刚保存的编辑内容',
      modelRequests
        .find((r) => r.question.includes('[append-flow]'))
        .messages.some((m) => m.content.includes('原始结果（离开前刚编辑）')),
    );
    await clickText('[aria-label="AI 提议的动作"] button', '全部采纳');
    await until(
      async () =>
        (await snapshot()).experiments.find((e) => e.id === ids.experiment)?.results.includes('顺序追加结果 B'),
      '追加结果未保存',
    );
    const saved = (await snapshot()).experiments.find((e) => e.id === ids.experiment).results;
    record(
      '连续动作保留旧文本与前一动作内容',
      ['原始结果（离开前刚编辑）', '顺序追加结果 A', '顺序追加结果 B'].every((token) => saved.includes(token)) &&
        saved.indexOf('顺序追加结果 A') < saved.indexOf('顺序追加结果 B'),
    );
    await visit(`/experiments/${ids.experiment}`);
    await clickText('main button', '预览');
    record(
      '刷新实验预览可见真实追加结果',
      await page.$eval(
        'main',
        (el) => el.textContent.includes('顺序追加结果 A') && el.textContent.includes('顺序追加结果 B'),
      ),
    );
    await capture('1440-experiment-written-result');
  });

  await scenario('单条失败保留与重试', async () => {
    await visit(`/ai?scope=project:${ids.project}`);
    await send('[retry-flow] 创建一条可重试任务');
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    await failNextAdd(retryTitle);
    await clickText('[aria-label="AI 提议的动作"] button', '采纳');
    await until(
      async () =>
        page.$$eval(
          '[aria-label="AI 提议的动作"]',
          (elements, title) => elements.some((el) => el.textContent.includes(title) && el.textContent.includes('重试')),
          retryTitle,
        ),
      '失败后没有保留重试入口',
    );
    record(
      '失败动作仍保留且未误报已执行',
      await page.$$eval(
        '[aria-label="AI 提议的动作"]',
        (elements, title) => elements.some((el) => el.textContent.includes(title) && el.textContent.includes('重试')),
        retryTitle,
      ),
    );
    record('失败没有部分保存记录', !(await table('tasks')).some((t) => t.title === retryTitle));
    await capture('1440-action-failed-retry');
    await clickText('[aria-label="AI 提议的动作"] button', '重试', 2);
    await until(async () => (await snapshot()).tasks.some((t) => t.title === retryTitle), '重试后任务未同步');
    record('重试成功且双击只创建一次', (await snapshot()).tasks.filter((t) => t.title === retryTitle).length === 1);
  });

  await scenario('多动作原子回滚与重试', async () => {
    await visit(`/ai?scope=project:${ids.project}`);
    await send('[atomic-flow] 原子创建两条任务');
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    await failNextAdd(atomicTitles[1]);
    await clickText('[aria-label="AI 提议的动作"] button', '全部采纳');
    await until(
      async () =>
        page.$$eval(
          '[aria-label="AI 提议的动作"]',
          (elements, title) => elements.some((el) => el.textContent.includes(title) && el.textContent.includes('重试')),
          atomicTitles[0],
        ),
      '原子失败后缺少重试状态',
    );
    record('任一写入失败整组本地事务回滚', !(await table('tasks')).some((t) => atomicTitles.includes(t.title)));
    record('回滚没有上传任何部分记录', !(await snapshot()).tasks.some((t) => atomicTitles.includes(t.title)));
    await capture('1440-atomic-rollback');
    await clickText('[aria-label="AI 提议的动作"] button', '全部采纳');
    await until(async () => {
      const saved = await snapshot();
      return atomicTitles.every((title) => saved.tasks.some((t) => t.title === title));
    }, '原子重试后任务未同步');
    const saved = await snapshot();
    record(
      '整组重试后每项仅保存一次',
      atomicTitles.every((title) => saved.tasks.filter((t) => t.title === title).length === 1),
    );
  });

  await scenario('无效操作可见反馈', async () => {
    const before = await snapshot();
    await visit(`/ai?scope=project:${ids.project}`);
    await send('[invalid-flow] 验证无效动作提示');
    const text = await page.$eval('main', (el) => el.textContent);
    record('坏JSON与未知操作有可见反馈', /无法解析|格式|识别|解析失败/.test(text) && /不支持|未知|未支持/.test(text));
    record(
      '无效操作不能执行',
      await page.$$eval('[aria-label="AI 提议的动作"] button', (buttons) =>
        buttons.filter((b) => ['采纳', '全部采纳'].includes(b.textContent.trim())).every((b) => b.disabled),
      ),
    );
    record('无效操作没有改动研究记录', JSON.stringify(before) === JSON.stringify(await snapshot()));
    await capture('1440-invalid-actions');
  });

  await scenario('结果接力与来源回执', async () => {
    await visit(`/ai?scope=project:${ids.project}`);
    await send('[relay-create] 创建一个后续任务');
    await page.click('[aria-label="查看本轮资料"]');
    await page.waitForSelector('[role="dialog"][aria-label="联动资料"]');
    const sources = await page.$$eval('.studio-source-list a', (links) => links.map((a) => a.textContent));
    record(
      '本轮资料包含实际发送的子任务与里程碑',
      sources.some((s) => s.includes('当前子任务标记 C')) && sources.some((s) => s.includes('既有里程碑标记 D')),
    );
    await capture('1440-workflow-source-trace');
    await clickText('[role="dialog"] button', '完成');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await clickText('[aria-label="AI 提议的动作"] button', '采纳');
    await until(async () => (await snapshot()).tasks.some((t) => t.title === relayTitle), '接力任务没有同步');
    const task = (await snapshot()).tasks.find((t) => t.title === relayTitle);
    await clickText('[aria-label="AI 提议的动作"] button', '继续跟进');
    record(
      '跟进结果进入真实任务及拆分工作流',
      new URL(page.url()).searchParams.get('scope') === 'task:' + task.id &&
        new URL(page.url()).searchParams.get('workflow') === 'task-breakdown',
    );
    await page.$eval('textarea[aria-label="向 AI 提问"]', (el) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await send('[relay-split] 将当前任务拆为两个子任务');
    record(
      '接力请求读取新任务与当前任务工作流',
      JSON.stringify(modelRequests.find((r) => r.question.includes('[relay-split]')).messages).includes(task.id),
    );
    await clickText('[aria-label="AI 提议的动作"] button', '采纳');
    await until(
      async () => (await snapshot()).subtasks.filter((t) => t.taskId === task.id).length === 2,
      '拆分没有落到原任务',
    );
    record('新子任务写入真实接力任务', (await snapshot()).subtasks.filter((t) => t.taskId === task.id).length === 2);
    await page.click('[aria-label="忽略全部提议"]');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[aria-label="查看操作记录"]');
    await page.click('[aria-label="查看操作记录"]');
    await page.waitForSelector('.studio-operation-ledger');
    record(
      '收起并刷新后仍保留已保存回执',
      await page.$eval(
        '.studio-operation-ledger',
        (el) => el.textContent.includes('已保存') && Boolean(el.querySelector('a')),
      ),
    );
    await capture('1440-workflow-operation-ledger');
    await clickText('[role="dialog"] button', '完成');
  });

  await scenario('文献实验状态联动', async () => {
    const original = (await snapshot()).references.find((r) => r.id === ids.reference);
    await visit(`/ai?scope=reference:${ids.reference}`);
    await send('[reference-state] 标记文献已读并关联到已有项目');
    await clickText('[aria-label="AI 提议的动作"] button', '全部采纳');
    await until(
      async () => (await snapshot()).references.find((r) => r.id === ids.reference)?.readingStatus === 'read',
      '阅读状态未同步',
    );
    const after = await snapshot();
    record(
      '文献状态落库且保留原笔记',
      after.references.find((r) => r.id === ids.reference).noteFindings === original.noteFindings,
    );
    record(
      '复用现有文献关联不产生重复',
      after.projectReferences.filter(
        (r) => r.projectId === ids.project && r.referenceId === ids.reference && r.deletedAt === null,
      ).length === 1,
    );
    await visit(`/ai?scope=experiment:${ids.experiment}`);
    await send('[experiment-state] 将当前实验标记为完成');
    await clickText('[aria-label="AI 提议的动作"] button', '采纳');
    await until(
      async () => (await snapshot()).experiments.find((e) => e.id === ids.experiment)?.status === 'done',
      '实验状态未同步',
    );
    record(
      '实验状态保存且不改写已有结果',
      (await snapshot()).experiments.find((e) => e.id === ids.experiment).results.includes('顺序追加结果 B'),
    );
  });

  await scenario('项目文件显式附带', async () => {
    const file = await page.evaluate(async (projectId) => {
      const response = await fetch('/api/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-rw-client': 'rw',
          'x-file-name': 'project-evidence.txt',
          'x-file-type': 'text/plain',
          'x-project-id': projectId,
        },
        body: '只在明确附带后读取的文件证据 H',
      });
      if (!response.ok) throw new Error('临时文件创建失败');
      return response.json();
    }, ids.project);
    let reads = 0;
    const onRequest = (request) => {
      if (request.url().includes('/api/files/' + file.id + '/content')) reads++;
    };
    page.on('request', onRequest);
    await visit(`/ai?scope=project:${ids.project}`);
    await page.click('[aria-label="联动资料"]');
    await clickText('[role="tab"]', '科研文件');
    await page.waitForSelector('.studio-linked-files');
    record(
      '项目联动目录可见但未读取原件',
      reads === 0 &&
        (await page.$eval('.studio-linked-files', (el) => el.textContent.includes('project-evidence.txt'))),
    );
    await clickText('.studio-linked-files button', '附带');
    await until(async () => Boolean(await page.$('[aria-label="待发送附件"]')), '选中文件没有附带');
    record('明确附带后才读取原件', reads === 1);
    await clickText('[role="dialog"] button', '完成');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await send('[file-explicit] 结合附带资料分析当前课题');
    record(
      '模型收到明确附带的原件正文',
      JSON.stringify(modelRequests.find((r) => r.question.includes('[file-explicit]')).messages).includes('文件证据 H'),
    );
    page.off('request', onRequest);
  });

  await scenario('副驾驶完整转入工作室', async () => {
    await visit(`/projects/${ids.project}`);
    await page.click('[aria-label="AI 科研副驾驶"]');
    await page.waitForSelector('[aria-label="向 AI 副驾驶提问"]');
    await paceModelRequest();
    await page.type('[aria-label="向 AI 副驾驶提问"]', '[handoff-saved] 安排第一轮工作');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    await clickText('[aria-label="AI 提议的动作"] button', '采纳');
    await until(async () => (await snapshot()).tasks.some((t) => t.title === '副驾驶交接已保存'), '副驾驶第一轮未同步');
    await paceModelRequest();
    await page.type('[aria-label="向 AI 副驾驶提问"]', '[handoff-pending] 安排第二轮工作');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    await page.type('[aria-label="向 AI 副驾驶提问"]', '转入后保留的草稿');
    await clickText('[role="dialog"] a', '在工作室打开');
    await page.waitForSelector('textarea[aria-label="向 AI 提问"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    record(
      '交接保留讨论与草稿',
      (await page.$eval(
        'main',
        (el) => el.textContent.includes('第一轮准备好了') && el.textContent.includes('第二轮等待采纳'),
      )) && (await page.$eval('textarea[aria-label="向 AI 提问"]', (el) => el.value === '转入后保留的草稿')),
    );
    record(
      '交接区分已执行与待采纳',
      Boolean(await page.$('[aria-label="已执行：新建任务"]')) &&
        Boolean(await page.$('[aria-label="采纳：新建任务"]')),
    );
    await page.click('[aria-label="采纳：新建任务"]');
    await until(async () => (await snapshot()).tasks.some((t) => t.title === '副驾驶交接待处理'), '转入后操作未保存');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[aria-label="AI 提议的动作"]');
    const saved = await snapshot();
    record(
      '转入操作刷新后不会重复执行',
      ['副驾驶交接已保存', '副驾驶交接待处理'].every(
        (title) => saved.tasks.filter((t) => t.title === title).length === 1,
      ) &&
        (await page.$$eval(
          '[aria-label="已执行：新建任务"]',
          (buttons) => buttons.length === 2 && buttons.every((b) => b.disabled),
        )),
    );
    await capture('1440-copilot-studio-handoff');
  });

  await scenario('简洁工作室和移动端', async () => {
    for (const [width, height] of [
      [1440, 1000],
      [390, 900],
      [390, 500],
    ]) {
      await page.setViewport({ width, height });
      await visit('/ai');
      await layout(`${width}x${height}-studio`);
      await page.click('[aria-label="资料与模型"]');
      await page.waitForSelector('[role="dialog"][aria-label="资料与模型设置"]');
      record(
        `${width}x${height} 模型与资料可按需打开`,
        Boolean(await page.$('#ai-source')) && Boolean(await page.$('#ai-scope')),
      );
      await capture(`${width}x${height}-studio-settings`);
      await clickText('[role="dialog"] button', '完成');
      await page.waitForSelector('[role="dialog"]', { hidden: true });
    }
  });

  await scenario('当前账号数据隔离', async () => {
    const other = await browser.createBrowserContext();
    const otherPage = await other.newPage();
    await otherPage.setViewport({ width: 1440, height: 1000 });
    await otherPage.goto(base, { waitUntil: 'networkidle0' });
    await api('/api/auth/signup', { email: 'ai-other@example.test', password: 'Research2026!' }, 'POST', otherPage);
    await otherPage.evaluate(() =>
      localStorage.setItem('rw.prefs.v1', JSON.stringify({ theme: 'light', demoLoadedAt: 1 })),
    );
    await otherPage.goto(base + '/ai', { waitUntil: 'networkidle0' });
    await otherPage.waitForSelector('textarea[aria-label="向 AI 提问"]');
    await otherPage.type('textarea[aria-label="向 AI 提问"]', '[isolation] 汇总当前工作区');
    await otherPage.click('[aria-label="发送"]');
    await until(
      async () => modelRequests.some((r) => r.question === '[isolation] 汇总当前工作区'),
      '隔离账号模型调用未完成',
    );
    const request = modelRequests.find((r) => r.question === '[isolation] 汇总当前工作区');
    const all = JSON.stringify(request.messages);
    record(
      '另一账号的摘要不包含首账号研究记录',
      !Object.values(ids).some((id) => all.includes(id)) && !all.includes('闭环测试课题'),
    );
    await other.close();
  });
  record('所有页面无运行时异常', errors.length === 0, errors.join('\n'));
  record('浏览器没有请求外部服务', blockedExternal.length === 0, blockedExternal.join('\n'));
} catch (error) {
  record('验收环境', false, String(error));
  await capture('environment-failure').catch(() => {});
} finally {
  await browser?.close();
  for (const process of [preview, backend])
    if (process && process.exitCode === null) {
      const done = new Promise((resolve) => process.once('exit', resolve));
      process.kill();
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
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith('research-ai-integration-v2-'))
    throw new Error('拒绝清理非本次临时目录');
  fs.rmSync(resolved, { recursive: true, force: true });
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
