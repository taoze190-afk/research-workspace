/**
 * 日期语义：截止日期一律用本地日期字符串 YYYY-MM-DD，绝不经过 UTC 转换。
 * 时间戳（createdAt / updatedAt / deletedAt）统一存本地时区无关的 epoch 毫秒，只在展示时格式化。
 */

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** 两个 YYYY-MM-DD 之间的天数差（b - a），只用日期部分，避免夏令时造成的 ±1。 */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

export function formatDate(date: string | null): string {
  if (!date || !isValidDateString(date)) return '';
  const [y, m, d] = date.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function formatShortDate(date: string | null): string {
  if (!date || !isValidDateString(date)) return '';
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function relativeDayLabel(date: string | null, today = localToday()): string {
  if (!date || !isValidDateString(date)) return '';
  const delta = diffDays(today, date);
  if (delta === 0) return '今天';
  if (delta === 1) return '明天';
  if (delta === -1) return '昨天';
  if (delta === 2) return '后天';
  if (delta < 0) return `${-delta} 天前`;
  if (delta <= 7) return `${delta} 天后`;
  return formatShortDate(date);
}

export function weekdayLabel(date: string, today = localToday()): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  if (diffDays(today, date) === 0) return `今天 · ${names[target.getDay()]}`;
  return names[target.getDay()];
}

/** 该日期所在周的周一（本地周，周一起头）。 */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}
