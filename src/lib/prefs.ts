import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** 页面背景样式：透明玻璃（默认）/ 纯净 / 网格点 / 网格线 / 极光 */
  bgStyle: 'nebula' | 'glass' | 'plain' | 'dots' | 'grid' | 'aurora';
  theme: 'system' | 'light' | 'dark';
  navCollapsed: boolean;
  favoritesCollapsed: boolean;
  taskView: 'list' | 'board' | 'calendar';
  projectView: 'list' | 'card';
  autoSave: boolean;
  backgroundImage: boolean;
  demoLoadedAt: number | null;
  /** 上一次导出完整备份的时间；本地模式靠它提醒别把备份拖太久。 */
  lastBackupAt: number | null;
}

export const defaultPrefs: Prefs = {
  bgStyle: 'nebula',
  theme: 'system',
  navCollapsed: false,
  favoritesCollapsed: false,
  taskView: 'list',
  projectView: 'card',
  autoSave: true,
  backgroundImage: false,
  demoLoadedAt: null,
  lastBackupAt: null,
};

const KEY = 'rw.prefs.v1';
const listeners = new Set<() => void>();
let cache: Prefs = read();

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrefs;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaultPrefs, ...parsed };
  } catch {
    return defaultPrefs;
  }
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 隐私模式或配额已满时仍保留内存中的值，界面不会因为设置写不进去而中断。
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrefs(): Prefs {
  return cache;
}

export function setPrefs(patch: Partial<Prefs>) {
  write({ ...cache, ...patch });
}

export function resetPrefs() {
  write(defaultPrefs);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
