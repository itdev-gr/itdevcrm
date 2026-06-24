import { describe, it, expect } from 'vitest';
import { computeTaskBadges } from './taskBadge';

const tk = (iso: string) => ({ created_at: iso });

describe('computeTaskBadges', () => {
  it('totals personal + assigned open tasks', () => {
    const r = computeTaskBadges(
      [tk('2026-06-01T00:00:00Z'), tk('2026-06-02T00:00:00Z')],
      [tk('2026-06-03T00:00:00Z')],
      null,
    );
    expect(r.total).toBe(3);
  });

  it('counts everything as new when never opened (seen = null)', () => {
    const r = computeTaskBadges([tk('2026-06-01T00:00:00Z')], [tk('2026-06-03T00:00:00Z')], null);
    expect(r.newCount).toBe(2);
  });

  it('counts only tasks created after the last-seen time as new', () => {
    const r = computeTaskBadges(
      [tk('2026-06-01T00:00:00Z'), tk('2026-06-03T00:00:00Z')], // 1 before, 1 after
      [tk('2026-06-04T00:00:00Z')], // after
      '2026-06-02T12:00:00Z',
    );
    expect(r.total).toBe(3);
    expect(r.newCount).toBe(2);
  });

  it('is zero new when every task predates last-seen', () => {
    const r = computeTaskBadges([tk('2026-06-01T00:00:00Z')], [], '2026-06-10T00:00:00Z');
    expect(r.newCount).toBe(0);
  });
});
