import type { Dataset } from './types';
import { experimentStatusLabels } from './types';
import { addDays, formatShortDate, localToday, pad2 } from './date';
import { isOpenTask } from './progress';

/**
 * 组会周报：把「本周完成的任务 / 实验进展 / 新增文献 / 下周截止」拼成 Markdown。
 * 只用真实时间戳（completedAt、updatedAt、createdAt、dueDate），没有任何推断。
 */

export function weekRangeOf(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  const from = addDays(today, day === 0 ? -6 : 1 - day);
  return { from, to: addDays(from, 6) };
}

const dayOf = (ts: number): string => {
  const dt = new Date(ts);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

const dash = '-';

export function buildWeeklyReport(data: Dataset, today = localToday()): string {
  const { from, to } = weekRangeOf(today);
  const nextFrom = addDays(to, 1);
  const nextTo = addDays(to, 7);
  const inRange = (key: string, a: string, b: string) => key >= a && key <= b;

  const projectName = (id: string | null) => data.projects.find((p) => p.id === id && p.deletedAt === null)?.name;
  const withProject = (name: string, projectId: string | null) => {
    const p = projectName(projectId);
    return p ? `${name}（${p}）` : name;
  };

  const doneTasks = data.tasks
    .filter((t) => t.deletedAt === null && t.status === 'done' && t.completedAt && inRange(dayOf(t.completedAt), from, to))
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));

  const experiments = data.experiments
    .filter((e) => e.deletedAt === null && inRange(dayOf(e.updatedAt), from, to))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const newReferences = data.references
    .filter((r) => r.deletedAt === null && inRange(dayOf(r.createdAt), from, to))
    .sort((a, b) => a.createdAt - b.createdAt);

  const upcoming = data.tasks
    .filter((t) => t.deletedAt === null && isOpenTask(t) && t.dueDate && inRange(t.dueDate, nextFrom, nextTo))
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));

  const lines: string[] = [`# 周报（${from} ~ ${to}）`, ''];

  lines.push('## 本周完成的任务', '');
  if (doneTasks.length === 0) lines.push('本周没有完成的任务。', '');
  for (const t of doneTasks) {
    lines.push(`${dash} ${withProject(t.title, t.projectId)}（${formatShortDate(dayOf(t.completedAt!))} 完成）`);
  }
  if (doneTasks.length) lines.push('');

  lines.push('## 实验进展', '');
  if (experiments.length === 0) lines.push('本周没有更新的实验。', '');
  for (const e of experiments) {
    const status = experimentStatusLabels[e.status];
    lines.push(`${dash} ${withProject(e.title || '未命名实验', e.projectId)} · ${status}`);
  }
  if (experiments.length) lines.push('');

  lines.push('## 新增文献', '');
  if (newReferences.length === 0) lines.push('本周没有新增文献。', '');
  for (const r of newReferences) {
    const meta = [r.authors, r.venue].filter(Boolean).join(' · ');
    lines.push(`${dash} ${r.title || '未命名条目'}${meta ? `（${meta}）` : ''}`);
  }
  if (newReferences.length) lines.push('');

  lines.push('## 下周截止', '');
  if (upcoming.length === 0) lines.push('下周没有到期任务。', '');
  for (const t of upcoming) {
    lines.push(`${dash} ${withProject(t.title, t.projectId)}（${formatShortDate(t.dueDate)} 截止）`);
  }
  if (upcoming.length) lines.push('');

  return lines.join('\n').trimEnd() + '\n';
}
