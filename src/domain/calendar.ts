import { pad2 } from './date';

/**
 * 月历网格：周一起头，固定 6 行 42 格，前后月的日子照常进格（灰显）。
 * 只做日期数学，不知道任务是什么。
 */

export interface CalendarDay {
  date: string;
  inMonth: boolean;
}

export const WEEK_HEADERS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function currentMonth(today: string): string {
  return today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = m - 1 + delta;
  const targetY = y + Math.floor(total / 12);
  const targetM = ((total % 12) + 12) % 12;
  return `${targetY}-${pad2(targetM + 1)}`;
}

export function monthGrid(month: string): CalendarDay[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const start = new Date(y, m - 1, 1 - mondayOffset);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      inMonth: d.getMonth() === m - 1,
    });
  }
  return days;
}
