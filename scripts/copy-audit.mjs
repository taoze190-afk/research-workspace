// 盘点界面上还剩下的成句中文（>14 个字符的文本节点），用于「介绍性文字全删除」的复查。
import fs from 'node:fs';
import path from 'node:path';

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})('src');

const node = />([^<>{}\n]{12,})</g;
const attr = /(hint|title|description|placeholder)=("[^"]{14,}"|'[^']{14,}'|\{`[^`]{14,}`\})/g;
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    for (const re of [node, attr]) {
      let m;
      while ((m = re.exec(line))) {
        const text = (m[1] ?? m[0]).replace(/^[">]|["<]$/g, '').trim();
        if (/[\u4e00-\u9fff]/.test(text) && text.length >= 12 && !/^[\s]*$/.test(text)) {
          hits.push(`${f}:${i + 1}  ${text}`);
        }
      }
      re.lastIndex = 0;
    }
  });
}
console.log(hits.join('\n'));
console.log(`\n共 ${hits.length} 处`);
