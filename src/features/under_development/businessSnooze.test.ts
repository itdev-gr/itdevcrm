import { describe, it, expect } from 'vitest';
import { nextBusinessAt10 } from './businessSnooze';

describe('nextBusinessAt10', () => {
  const wed = new Date(2026, 8, 2, 15, 0); // Wed Sep 2 2026, local
  const fri = new Date(2026, 8, 4, 15, 0); // Fri Sep 4 2026
  it('weekday + 1 → next day 10:00 local', () => {
    expect(nextBusinessAt10(1, wed)).toBe(new Date(2026, 8, 3, 10, 0, 0, 0).toISOString());
  });
  it('Friday + 1 (Saturday) rolls to Monday 10:00', () => {
    expect(nextBusinessAt10(1, fri)).toBe(new Date(2026, 8, 7, 10, 0, 0, 0).toISOString());
  });
  it('Friday + 2 (Sunday) rolls to Monday 10:00', () => {
    expect(nextBusinessAt10(2, fri)).toBe(new Date(2026, 8, 7, 10, 0, 0, 0).toISOString());
  });
  it('+7 lands a weekday and stays', () => {
    expect(nextBusinessAt10(7, wed)).toBe(new Date(2026, 8, 9, 10, 0, 0, 0).toISOString());
  });
});
