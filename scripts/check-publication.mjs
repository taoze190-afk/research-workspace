import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw new Error('没有已跟踪文件；请先将计划公开的源码加入 Git 暂存区');
const issues = [];
const forbidden =
  /(?:^|\/)(?:node_modules|dist|release|shots|test-results|server\/data|\.chrome[^/]*|\.ui-probe|\.desktop-build|\.audit[^/]*|\.server-profile|\.tmp-[^/]*)(?:\/|$)|\.(?:db|sqlite|sqlite3|pfx|p12|pem|key)(?:-(?:wal|shm))?$|(?:^|\/)(?:desktop\.env|desktop-state\.json|desktop-test-state\.json)$/i;
const patterns = [
  ['GitHub credential format', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['provider credential format', /\b(?:sk-[A-Za-z0-9]{24,}|AIza[A-Za-z0-9_-]{35})\b/],
  ['private key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/],
  ['personal machine path', /[C-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|$)|Default(?:[\\/]|$))[^\s'"<>\\/]+[\\/]/i],
];
let bytes = 0;
for (const file of files) {
  if (forbidden.test(file) || (/(?:^|\/)\.env(?:\.|$)|\.env$/i.test(file) && !file.endsWith('.example')))
    issues.push({ file, rule: 'private or generated path' });
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    issues.push({ file, rule: 'tracked file missing' });
    continue;
  }
  const data = fs.readFileSync(absolute);
  bytes += data.length;
  if (data.length > 10 * 1024 * 1024) issues.push({ file, rule: 'source file over 10 MiB' });
  if (data.includes(0) || /\.(?:png|webp|jpg|jpeg|ico|woff2?)$/i.test(file)) continue;
  const text = data.toString('utf8');
  for (const [rule, pattern] of patterns) if (pattern.test(text)) issues.push({ file, rule });
}
if (issues.length) {
  console.error(JSON.stringify({ issues }, null, 2));
  process.exitCode = 1;
} else
  console.log(
    `Public-source check passed: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. No matching private paths or credential formats. This is a bounded check, not a guarantee of absence.`,
  );
