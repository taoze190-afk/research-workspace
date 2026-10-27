import { describe, expect, it } from 'vitest';
import { currentMonth, monthGrid, shiftMonth } from '@/domain/calendar';

describe('月历网格', () => {
  it('周一起头，42 格，前后月补位', () => {
    const days = monthGrid('2026-10'); // 2026-10-01 是周四
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(days[3]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(days.filter((d) => d.inMonth)).toHaveLength(31);
    expect(days[41]).toEqual({ date: '2026-11-08', inMonth: false });
  });

  it('周日开头的月份也归位到周一', () => {
    const days = monthGrid('2026-11'); // 2026-11-01 是周日
    expect(days[0]).toEqual({ date: '2026-10-26', inMonth: false });
    expect(days[6]).toEqual({ date: '2026-11-01', inMonth: true });
  });

  it('跨年平移月份不串行', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-10', 3)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('当前月取 YYYY-MM', () => {
    expect(currentMonth('2026-10-24')).toBe('2026-10');
  });
});
