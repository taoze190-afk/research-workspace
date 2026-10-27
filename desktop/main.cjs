const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { parseEnv } = require('node:util');
const { readState, saveState, isAppUrl, isExternalUrl } = require('./runtime.cjs');

const testing = process.argv.includes('--desktop-test');
const userData =
  testing && process.env.RW_DESKTOP_TEST_DATA
    ? path.resolve(process.env.RW_DESKTOP_TEST_DATA)
    : path.join(app.getPath('appData'), 'YanxuResearch');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
if (testing) app.commandLine.appendSwitch('remote-debugging-port', '0');
app.setAppUserModelId('cn.yanxu.research');
const single = app.requestSingleInstanceLock();
let window,
  backend,
  origin,
  quitting = false,
  cleanExit = false;
if (!single) app.quit();
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});

function log(message) {
  fs.appendFileSync(path.join(app.getPath('userData'), 'desktop.log'), new Date().toISOString() + ' ' + message + '\n');
}
function menu() {
  const root = app.getPath('userData');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '打开数据目录', click: () => void shell.openPath(root) },
          {
            label: '编辑平台模型配置',
            click: () => {
              const file = path.join(root, 'desktop.env');
              if (!fs.existsSync(file))
                fs.writeFileSync(
                  file,
                  '# 保存后重新启动研序，密钥只保存在本机。\n# AI_API_KEY=填写密钥\n# AI_BASE_URL=https://你的模型接口/v1\n# 也可按管理控制台提示配置 DEEPSEEK_API_KEY 等变量。\n',
                );
              const editor = spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' });
              editor.on('error', () => void shell.openPath(root));
              editor.unref();
            },
          },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '刷新' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于研序',
            click: () =>
              void dialog.showMessageBox(window, {
                type: 'info',
                title: '关于研序',
                message: '研序 · 科研管理平台',
                detail: `版本 ${app.getVersion()}\n数据保存在：${root}\n首次使用注册的账号为本机管理员。\n数据备份和迁移说明位于安装包旁的「桌面版使用说明.md」。`,
              }),
          },
        ],
      },
    ]),
  );
}
async function startBackend() {
  const root = app.getPath('userData');
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '.desktop-build');
  const entry = app.isPackaged
    ? path.join(resources, 'backend', 'desktop', 'backend.mjs')
    : path.join(__dirname, 'backend.mjs');
  const runtime = path.join(resources, 'runtime', 'node.exe');
  if (!fs.existsSync(runtime)) throw new Error('内置运行环境缺失，请重新安装。开发时先运行 npm run desktop:prepare。');
  const envFile = path.join(root, 'desktop.env');
  const modelEnvironment = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  backend = fork(entry, [], {
    execPath: runtime,
    windowsHide: true,
    silent: true,
    env: {
      ...process.env,
      ...modelEnvironment,
      RW_DESKTOP_DATA: root,
      RW_DESKTOP_WEB: app.isPackaged ? path.join(resources, 'web') : path.join(__dirname, '..', 'dist'),
      RW_DESKTOP_PORT: String(readState(root).port),
    },
  });
  backend.stdout.on('data', (data) => log(String(data).trim()));
  backend.stderr.on('data', (data) => log(String(data).trim()));
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('本机服务启动超时，请检查数据目录和 desktop.log。')), 20000);
    const finish = (error, port) => {
      clearTimeout(timeout);
      error ? reject(error) : resolve(port);
    };
    backend.once('error', (error) => finish(error));
    backend.once('exit', (code) => {
      if (!origin) finish(new Error('本机服务未能启动，请检查 desktop.log。'));
      else if (!quitting) {
        log('本机服务意外退出：' + code);
        void dialog
          .showMessageBox(window, { type: 'error', message: '本机服务已停止，请重新启动研序。' })
          .then(() => app.quit());
      }
    });
    backend.on('message', (message) => {
      if (message?.type === 'ready' && Number.isInteger(message.port) && message.port >= 1024 && message.port <= 65535)
        finish(null, message.port);
      if (message?.type === 'error')
        finish(
          new Error(
            message.code === 'EADDRINUSE'
              ? '研序上次使用的本机端口被其他程序占用，请关闭冲突程序后重试。请勿删除 desktop-state.json，以免改变本机对话的访问地址。'
              : '本机服务启动失败：' + message.message,
          ),
        );
    });
  });
  saveState(root, port);
  origin = `http://127.0.0.1:${port}`;
  if (testing)
    fs.writeFileSync(
      path.join(root, 'desktop-test-state.json'),
      JSON.stringify({ pid: process.pid, backendPid: backend.pid, origin }),
    );
}
function createWindow() {
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '.desktop-build');
  window = new BrowserWindow({
    title: '研序 · 科研管理平台',
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#f3f7fc',
    show: false,
    icon: path.join(resources, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
      backgroundThrottling: !testing,
    },
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault();
      if (isExternalUrl(url)) void shell.openExternal(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL(), origin)),
  );
  window.webContents.session.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      permission === 'clipboard-sanitized-write' && isAppUrl(requestingOrigin, origin),
  );
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: '保存科研文件',
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
    });
  });
  window.once('ready-to-show', () => {
    if (!testing) window.show();
  });
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(origin).catch((error) => {
    // React 路由或用户导航可能中止首次页面加载，这不代表本机服务故障。
    if (error.code === 'ERR_ABORTED' || error.errno === -3 || quitting) return;
    log(error.message);
    void dialog.showErrorBox('研序启动失败', '界面加载失败，请重新启动。');
    app.quit();
  });
}
if (single)
  app.whenReady().then(async () => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    menu();
    try {
      await startBackend();
      createWindow();
    } catch (error) {
      log(error.message);
      dialog.showErrorBox('研序启动失败', error.message);
      app.quit();
    }
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (cleanExit || !backend || backend.exitCode !== null) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  const force = setTimeout(() => backend.kill(), 5000);
  backend.once('exit', () => {
    clearTimeout(force);
    cleanExit = true;
    app.quit();
  });
  if (backend.connected) backend.send({ type: 'shutdown' });
  else backend.kill();
});
