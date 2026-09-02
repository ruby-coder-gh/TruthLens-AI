import { describe, it, expect } from 'vitest';
import { startOfDayIso, endOfDayIso } from './dates';

describe('startOfDayIso', () => {
  it('appends the first instant of the day to a bare YYYY-MM-DD date', () => {
    expect(startOfDayIso('2026-08-01')).toBe('2026-08-01T00:00:00.000');
  });

  it('passes an empty string through unchanged', () => {
    expect(startOfDayIso('')).toBe('');
  });
});

describe('endOfDayIso', () => {
  it('appends the last instant of the day to a bare YYYY-MM-DD date', () => {
    expect(endOfDayIso('2026-08-31')).toBe('2026-08-31T23:59:59.999');
  });

  it('passes an empty string through unchanged', () => {
    expect(endOfDayIso('')).toBe('');
  });

  it('makes the selected end day inclusive in a >= / <= backend comparison', () => {
    const endOfSelectedDay = new Date(`${endOfDayIso('2026-08-31')}Z`);
    const rowCreatedLateOnSelectedDay = new Date('2026-08-31T23:00:00.000Z');
    const rowCreatedNextDay = new Date('2026-09-01T00:00:00.000Z');

    expect(rowCreatedLateOnSelectedDay.getTime()).toBeLessThanOrEqual(endOfSelectedDay.getTime());
    expect(rowCreatedNextDay.getTime()).toBeGreaterThan(endOfSelectedDay.getTime());
  });
});
