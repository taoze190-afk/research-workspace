import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/lib/theme';

describe('主题解析', () => {
  it('system 跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('显式选择覆盖系统', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
