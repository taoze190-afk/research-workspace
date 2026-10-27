import 'fake-indexeddb/auto';
import { beforeAll, beforeEach } from 'vitest';
import { db } from '@/data/db';
import { resetPrefs, setPrefs } from '@/lib/prefs';

// jsdom 没有 matchMedia：主题与动效媒体查询都靠它，测试环境给个恒浅色的最小实现
// （server.test.ts 跑在 node 环境里，没有 window，直接跳过）
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeAll(async () => {
  // 让 Dexie 在 fake-indexeddb 上完成建表，避免每个用例各自等版本升级。
  await db.open();
});

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  resetPrefs();
  setPrefs({ demoLoadedAt: 1 });
});
