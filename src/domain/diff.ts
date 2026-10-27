/**
 * 行级 LCS diff：b 相对 a 的变化，只用于「实验与它的复制来源」对比。
 * 实验正文的量级（几百行）下 O(n·m) 表完全够用，不值得引依赖。
 */

export type DiffRowType = 'same' | 'add' | 'del';

export interface DiffRow {
  type: DiffRowType;
  text: string;
}

/** 空字符串视为零行而不是一行空行，这样「原本没填 → 填了」就是纯新增。 */
const toLines = (s: string): string[] => {
  const text = (s ?? '').replace(/\r\n/g, '\n');
  return text === '' ? [] : text.split('\n');
};

export function diffLines(a: string, b: string): DiffRow[] {
  const left = toLines(a);
  const right = toLines(b);
  const n = left.length;
  const m = right.length;

  // dp[i][j] = left[i..] 与 right[j..] 的最长公共子序列长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      rows.push({ type: 'same', text: left[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: left[i] });
      i += 1;
    } else {
      rows.push({ type: 'add', text: right[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', text: left[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: 'add', text: right[j] });
    j += 1;
  }
  return rows;
}

/** 压掉大段相同行，只留变化处上下各 1 行，便于在对话框里读。 */
export function compactDiff(rows: DiffRow[], context = 1): (DiffRow | { type: 'gap'; count: number })[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.type === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) keep.add(k);
  });
  const out: (DiffRow | { type: 'gap'; count: number })[] = [];
  let gap = 0;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (gap > 0) {
        out.push({ type: 'gap', count: gap });
        gap = 0;
      }
      out.push(row);
    } else {
      gap += 1;
    }
  });
  if (gap > 0) out.push({ type: 'gap', count: gap });
  return out;
}

export function changedFields<T extends string>(fields: [T, string, string][]): T[] {
  return fields.filter(([, a, b]) => a.trim() !== b.trim()).map(([key]) => key);
}
