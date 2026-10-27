import type { Recurrence, Task } from './types';
import { addDays, diffDays, localToday, pad2 } from './date';

/**
 * 重复任务的下一期日期：从「原截止日」和「今天」里较晚的那个起算。
 * 已过期的每周任务完成后不会连补好几期，只排下一期。
 */

const INTERVAL_DAYS: Record<Exclude<Recurrence, 'none' | 'monthly'>, number> = {
  weekly: 7,
  biweekly: 14,
};

/** 下个月的同一天；没有那一天（1/31 → 2月）就收到月末。 */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const targetY = y + Math.floor((m - 1 + months) / 12);
  const targetM = ((m - 1 + months) % 12) + 1;
  const lastDay = new Date(targetY, targetM, 0).getDate();
  return `${targetY}-${pad2(targetM)}-${pad2(Math.min(d, lastDay))}`;
}

export function nextOccurrenceDate(dueDate: string, recurrence: Recurrence, today = localToday()): string {
  // 已过期（dueDate 早于今天）就从今天起算，避免完成后连补好几期
  const base = diffDays(today, dueDate) < 0 ? today : dueDate;
  if (recurrence === 'monthly') return addMonths(base, 1);
  if (recurrence === 'none') return base;
  return addDays(base, INTERVAL_DAYS[recurrence]);
}

/** 任务没有截止日时，从今天起算下一期。 */
export function nextDueFor(task: Task, today = localToday()): string {
  return nextOccurrenceDate(task.dueDate ?? today, task.recurrence, today);
}
