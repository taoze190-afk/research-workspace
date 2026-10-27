import type { Prefs } from './prefs';

/**
 * 主题解析：'system' 跟随系统，浅/深直接落。
 * <html data-theme> 供 CSS 取值；meta theme-color 供移动端地址栏跟着变色。
 */

export type ThemeMode = Prefs['theme'];
export type ResolvedTheme = 'light' | 'dark';

const BG: Record<ResolvedTheme, string> = { light: '#f8fafc', dark: '#020617' };

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function prefersDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 系统深浅切换时回调；环境不支持 matchMedia（如 jsdom）时退回空订阅。 */
export function onSystemThemeChange(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function applyTheme(mode: ThemeMode, prefersDark = prefersDarkMode()): void {
  const resolved = resolveTheme(mode, prefersDark);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BG[resolved]);
}

/** 页面背景样式：给 body 挂/换 class，四种互斥。 */
export function applyBgStyle(style: 'nebula' | 'glass' | 'plain' | 'dots' | 'grid' | 'aurora'): void {
  const body = document.body;
  body.classList.remove('bg-style-nebula', 'bg-style-glass', 'bg-style-dots', 'bg-style-grid', 'bg-style-aurora');
  if (style !== 'plain') body.classList.add(`bg-style-${style}`);
}
