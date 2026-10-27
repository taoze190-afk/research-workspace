import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 所有浏览器验证共用，不依赖开发者个人路径。 */
export function chromeExecutable() {
  const explicit = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error('CHROME_PATH 指向的浏览器不存在');
    return explicit;
  }
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(
            process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
            'Microsoft/Edge/Application/msedge.exe',
          ),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const file of candidates) if (fs.existsSync(file)) return file;
  if (process.platform !== 'win32') {
    for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
      try {
        const file = execFileSync('which', [name], { encoding: 'utf8' }).trim();
        if (file) return file;
      } catch {
        /* 尝试下一个 */
      }
    }
  }
  throw new Error('未找到 Chrome / Chromium，请设置 CHROME_PATH');
}
