import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isValidDateString, localToday, relativeDayLabel } from '@/domain/date';

describe('本地日期语义', () => {
  it('localToday 用的是本地日历，不是 UTC', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(localToday()).toBe(expected);
  });

  it('拒绝不存在的日期，2 月 30 点不算合法', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(isValidDateString('2026-1-2')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
  });

  it('跨月跨年加天数不靠 Date 的 UTC 转换', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('diffDays 只数日历天，时区不影响', () => {
    expect(diffDays('2026-10-23', '2026-10-23')).toBe(0);
    expect(diffDays('2026-10-23', '2026-10-24')).toBe(1);
    expect(diffDays('2026-10-24', '2026-10-23')).toBe(-1);
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('相对标签在边界上说得准', () => {
    expect(relativeDayLabel('2026-10-23', '2026-10-23')).toBe('今天');
    expect(relativeDayLabel('2026-10-24', '2026-10-23')).toBe('明天');
    expect(relativeDayLabel('2026-10-22', '2026-10-23')).toBe('昨天');
    expect(relativeDayLabel('2026-10-29', '2026-10-23')).toBe('6 天后');
    expect(relativeDayLabel('2026-10-30', '2026-10-23')).toBe('7 天后');
    expect(relativeDayLabel('2026-10-31', '2026-10-23')).toBe('10/31');
  });
});
