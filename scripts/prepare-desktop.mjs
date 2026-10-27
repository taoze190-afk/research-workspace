import { chromeExecutable } from './browser.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.desktop-build');
if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('请在 Windows x64 上使用 Node.js 24 或更新版本打包桌面版');
await fs.mkdir(path.join(output, 'runtime'), { recursive: true });
await fs.mkdir(path.join(output, 'app', 'desktop'), { recursive: true });
for (const name of ['main.cjs', 'runtime.cjs'])
  await fs.copyFile(path.join(root, 'desktop', name), path.join(output, 'app', 'desktop', name));
const appPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(
  path.join(output, 'app', 'package.json'),
  JSON.stringify(
    {
      name: appPackage.name,
      version: appPackage.version,
      description: appPackage.description,
      author: appPackage.author,
      main: 'desktop/main.cjs',
    },
    null,
    2,
  ),
);
await fs.mkdir(path.join(output, 'backend', 'desktop'), { recursive: true });
await fs.cp(path.join(root, 'server', 'src'), path.join(output, 'backend', 'server', 'src'), { recursive: true });
await fs.mkdir(path.join(output, 'backend', 'src', 'domain'), { recursive: true });
await fs.copyFile(
  path.join(root, 'src', 'domain', 'platform.ts'),
  path.join(output, 'backend', 'src', 'domain', 'platform.ts'),
);
await fs.writeFile(path.join(output, 'backend', 'package.json'), JSON.stringify({ private: true, type: 'module' }));
for (const name of ['backend.mjs', 'static.mjs'])
  await fs.copyFile(path.join(root, 'desktop', name), path.join(output, 'backend', 'desktop', name));
await fs.copyFile(process.execPath, path.join(output, 'runtime', 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
try {
  await fs.copyFile(nodeLicense, path.join(output, 'runtime', 'LICENSE-Node.txt'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  let cached = false;
  try {
    const previous = JSON.parse(await fs.readFile(path.join(output, 'runtime', 'version.json'), 'utf8'));
    const text = await fs.readFile(path.join(output, 'runtime', 'LICENSE-Node.txt'), 'utf8');
    cached = previous.node === process.version && text.startsWith('Node.js is licensed');
  } catch {
    /* 首次构建需要下载当前 Node 版本的许可证 */
  }
  if (!cached) {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('无法取得内置 Node 运行环境的许可证');
    const license = await response.text();
    if (!license.startsWith('Node.js is licensed')) throw new Error('Node 许可证内容无效');
    await fs.writeFile(path.join(output, 'runtime', 'LICENSE-Node.txt'), license);
  }
}
const metadata = {
  node: process.version,
  arch: process.arch,
  sha256: crypto
    .createHash('sha256')
    .update(await fs.readFile(process.execPath))
    .digest('hex'),
  preparedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(output, 'runtime', 'version.json'), JSON.stringify(metadata, null, 2));

// 沿用现有品牌图标，生成 Windows 支持的多尺寸 ICO。
const browser = await puppeteer.launch({
  executablePath: chromeExecutable(),
  headless: true,
});
try {
  const page = await browser.newPage();
  const svg = await fs.readFile(path.join(root, 'public', 'favicon.svg'), 'utf8');
  const images = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    images.push({ size, bytes: Buffer.from(await page.screenshot({ omitBackground: true })) });
  }
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => {
    const at = 6 + index * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  await fs.writeFile(path.join(output, 'icon.ico'), Buffer.concat([header, ...images.map((image) => image.bytes)]));
} finally {
  await browser.close();
}
console.log(`桌面资源已准备：Node ${process.version}，仅包含程序代码与构建资源`);
