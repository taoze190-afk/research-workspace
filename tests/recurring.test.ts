import { describe, expect, it } from 'vitest';
import { nextDueFor, nextOccurrenceDate } from '@/domain/recurring';
import { makeTask } from './factory';

const TODAY = '2026-10-24';

describe('重复任务的下一期', () => {
  it('每周/每两周从原截止日顺延（截止日还没到）', () => {
    expect(nextOccurrenceDate('2026-10-28', 'weekly', TODAY)).toBe('2026-11-04');
    expect(nextOccurrenceDate('2026-10-28', 'biweekly', TODAY)).toBe('2026-11-11');
  });

  it('已过期的截止日从今天起算，不连补几期', () => {
    expect(nextOccurrenceDate('2026-10-01', 'weekly', TODAY)).toBe('2026-10-31');
    expect(nextOccurrenceDate('2026-10-15', 'monthly', TODAY)).toBe('2026-11-24');
  });

  it('每月同一天，缺那一天就收月末', () => {
    expect(nextOccurrenceDate('2026-12-31', 'monthly', TODAY)).toBe('2027-01-31');
    expect(nextOccurrenceDate('2027-01-31', 'monthly', TODAY)).toBe('2027-02-28');
  });

  it('没有截止日的任务从今天排下一期', () => {
    const task = makeTask({ dueDate: null, recurrence: 'weekly' });
    expect(nextDueFor(task, TODAY)).toBe('2026-10-31');
  });

  it('有截止日按截止日推，跨月也准', () => {
    const task = makeTask({ dueDate: '2026-10-28', recurrence: 'weekly' });
    expect(nextDueFor(task, TODAY)).toBe('2026-11-04');
  });
});
