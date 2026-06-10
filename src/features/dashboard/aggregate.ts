// Pure aggregation helpers for the reporting dashboard. Kept free of
// Supabase/React so the math is unit-testable.

export type LeadLite = {
  owner: string;
  source: string;
  outcome: 'won' | 'lost' | 'open';
  oneTimeValue: number;
  monthlyValue: number;
};

export type CohortRow = {
  key: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  /** won / (won + lost); null when nothing is decided yet. */
  winRate: number | null;
  wonOneTime: number;
  wonMonthly: number;
};

/** Inclusive list of YYYY-MM buckets between two ISO dates. */
export function monthKeys(fromIso: string, toIso: string): string[] {
  const keys: string[] = [];
  let [y, m] = fromIso.slice(0, 7).split('-').map(Number) as [number, number];
  const end = toIso.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    keys.push(key);
    if (key === end || keys.length > 120) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

export function cohortStats(leads: LeadLite[], keyFn: (l: LeadLite) => string): CohortRow[] {
  const byKey = new Map<string, CohortRow>();
  for (const l of leads) {
    const key = keyFn(l);
    let row = byKey.get(key);
    if (!row) {
      row = { key, total: 0, won: 0, lost: 0, open: 0, winRate: null, wonOneTime: 0, wonMonthly: 0 };
      byKey.set(key, row);
    }
    row.total += 1;
    row[l.outcome] += 1;
    if (l.outcome === 'won') {
      row.wonOneTime += l.oneTimeValue;
      row.wonMonthly += l.monthlyValue;
    }
  }
  for (const row of byKey.values()) {
    const decided = row.won + row.lost;
    row.winRate = decided > 0 ? row.won / decided : null;
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total);
}
