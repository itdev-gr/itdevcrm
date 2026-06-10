import { describe, it, expect } from 'vitest';
import { monthKeys, cohortStats, type LeadLite } from './aggregate';

describe('monthKeys', () => {
  it('lists YYYY-MM buckets inclusive of both ends', () => {
    expect(monthKeys('2026-01-15', '2026-04-02')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });
  it('handles a single month and year boundaries', () => {
    expect(monthKeys('2026-06-01', '2026-06-30')).toEqual(['2026-06']);
    expect(monthKeys('2025-11-20', '2026-01-05')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

const lead = (p: Partial<LeadLite>): LeadLite => ({
  owner: 'Alice',
  source: 'manual',
  outcome: 'open',
  oneTimeValue: 0,
  monthlyValue: 0,
  ...p,
});

describe('cohortStats', () => {
  it('groups by key with won/lost/open counts and win rate over decided leads only', () => {
    const leads = [
      lead({ owner: 'Alice', outcome: 'won', oneTimeValue: 1000, monthlyValue: 100 }),
      lead({ owner: 'Alice', outcome: 'won', oneTimeValue: 0, monthlyValue: 50 }),
      lead({ owner: 'Alice', outcome: 'lost' }),
      lead({ owner: 'Alice', outcome: 'open' }),
      lead({ owner: 'Bob', outcome: 'open' }),
    ];
    const rows = cohortStats(leads, (l) => l.owner);
    const alice = rows.find((r) => r.key === 'Alice')!;
    expect(alice).toMatchObject({ total: 4, won: 2, lost: 1, open: 1 });
    // Win rate ignores open leads: 2 / (2 + 1).
    expect(alice.winRate).toBeCloseTo(2 / 3);
    expect(alice.wonOneTime).toBe(1000);
    expect(alice.wonMonthly).toBe(150);
    const bob = rows.find((r) => r.key === 'Bob')!;
    expect(bob.winRate).toBeNull(); // nothing decided yet
  });

  it('sorts by total descending', () => {
    const rows = cohortStats(
      [lead({ owner: 'A' }), lead({ owner: 'B' }), lead({ owner: 'B' })],
      (l) => l.owner,
    );
    expect(rows.map((r) => r.key)).toEqual(['B', 'A']);
  });
});
