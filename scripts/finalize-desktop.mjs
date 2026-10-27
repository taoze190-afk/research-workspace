import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const names = [`Yanxu-Setup-${version}-x64.exe`, `Yanxu-Portable-${version}-x64.exe`];
const lines = [];
for (const name of names) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(output, name))) hash.update(chunk);
  lines.push(hash.digest('hex') + '  ' + name);
  console.log(name + ' · ' + (fs.statSync(path.join(output, name)).size / 1024 / 1024).toFixed(1) + ' MB');
}
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
fs.copyFileSync(path.join(root, 'docs', 'desktop-windows.md'), path.join(output, '桌面版使用说明.md'));
