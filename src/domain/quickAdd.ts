import { addDays, diffDays, isValidDateString, localToday, pad2 } from './date';
import type { Priority, Project } from './types';

/**
 * 快速添加的任务行解析：一句话里同时给出标题、日期、优先级和项目。
 * 只做显式标记（!高、#项目、日期词），不做任何猜测；解析不了的词原样留在标题里。
 */

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: Priority;
  projectId: string | null;
}

const PRIORITY_WORDS: Record<string, Priority> = { 紧急: 'urgent', 高: 'high', 中: 'medium', 低: 'low' };

/** 「一」→ getDay() 的 1，依此类推；「日」与「天」都是 0。 */
const WEEKDAY_INDEX: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

const WEEKDAY_RE = /^(?:(下{1,2})?周|星期|礼拜)([一二三四五六日天])$/;
const MD_RE = /^(\d{1,2})[月/\-](\d{1,2})[日号]?$/;
const YMD_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

function buildDate(y: number, m: number, d: number): string | null {
  const value = `${y}-${pad2(m)}-${pad2(d)}`;
  return isValidDateString(value) ? value : null;
}

function parseDateToken(token: string, today: string): string | null {
  if (token === '今天') return today;
  if (token === '明天') return addDays(today, 1);
  if (token === '后天') return addDays(today, 2);
  if (token === '大后天') return addDays(today, 3);

  const weekday = WEEKDAY_RE.exec(token);
  if (weekday) {
    const target = WEEKDAY_INDEX[weekday[2]];
    const step = weekday[1] === '下下' ? 14 : weekday[1] === '下' ? 7 : 0;
    const ahead = (target - dayOfWeek(today) + 7) % 7;
    return addDays(today, step + ahead);
  }

  const ymd = YMD_RE.exec(token);
  if (ymd) return buildDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const md = MD_RE.exec(token);
  if (md) {
    const year = Number(today.slice(0, 4));
    const date = buildDate(year, Number(md[1]), Number(md[2]));
    if (!date) return null;
    return diffDays(today, date) < 0 ? buildDate(year + 1, Number(md[1]), Number(md[2])) : date;
  }
  return null;
}

function matchProject(token: string, projects: Project[]): Project | null {
  const word = token.toLowerCase();
  return (
    projects.find((p) => p.name.toLowerCase() === word) ??
    projects.find((p) => p.name.toLowerCase().startsWith(word)) ??
    projects.find((p) => p.name.toLowerCase().includes(word)) ??
    null
  );
}

export function parseQuickAdd(input: string, projects: Project[], today = localToday()): QuickAddResult {
  const result: QuickAddResult = { title: '', dueDate: null, priority: 'medium', projectId: null };
  const rest: string[] = [];
  const live = projects.filter((p) => p.deletedAt === null);

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    // 优先级支持 !紧急 和 #紧急 两种前缀；# 打不中优先级再当项目名试
    const priority = /^([!#])(紧急|高|中|低)$/.exec(token);
    if (priority) {
      result.priority = PRIORITY_WORDS[priority[2]];
      continue;
    }
    if (token.startsWith('@') && token.length > 1) {
      const project = matchProject(token.slice(1), live);
      if (project) {
        result.projectId = project.id;
        continue;
      }
    }
    if (token.startsWith('#') && token.length > 1) {
      const project = matchProject(token.slice(1), live);
      if (project) {
        result.projectId = project.id;
        continue;
      }
    }
    const date = parseDateToken(token, today);
    if (date) {
      result.dueDate = date;
      continue;
    }
    rest.push(token);
  }

  result.title = rest.join(' ');
  return result;
}
