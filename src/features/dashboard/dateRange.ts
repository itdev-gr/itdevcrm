// Dashboard period boundaries in the USER'S timezone (Greece), not UTC.
//
// Why: leads.created_at is a timestamptz; filtering it with `YYYY-MM-DDT00:00:00Z`
// classified every lead created 00:00–03:00 Athens time into the PREVIOUS day —
// 23% of all leads (1,536/6,586, measured 2026-08-31) sat on the wrong side of a
// period boundary. `rangeFor` likewise derived "today" from UTC, so between
// midnight and 03:00 local the presets still showed the previous month/year.
//
// The browser runs in the user's timezone, so `new Date(y, m, d)` IS local
// midnight and `.toISOString()` is the exact UTC instant to compare against
// timestamptz. Day arithmetic goes through the Date constructor's overflow
// handling, which is DST-correct (no naive +24h).

export type DashboardRange = { from: string; to: string };

/** Local calendar day of `d` as YYYY-MM-DD (never UTC). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * The UTC instants that bound the LOCAL days [from … to] inclusive:
 * local midnight starting `from`, and local midnight after `to` (exclusive
 * upper bound — use with `.lt()`, so 23:59:59.999 is never lost).
 */
export function localDayBounds(range: DashboardRange): { fromIso: string; toIsoExclusive: string } {
  const [fy = 1970, fm = 1, fd = 1] = range.from.split('-').map(Number);
  const [ty = 1970, tm = 1, td = 1] = range.to.split('-').map(Number);
  return {
    fromIso: new Date(fy, fm - 1, fd).toISOString(),
    toIsoExclusive: new Date(ty, tm - 1, td + 1).toISOString(),
  };
}

export type RangePreset = 'this_month' | 'last_month' | 'last_6_months' | 'this_year' | 'last_12_months';

/** Preset → local-calendar date range (both ends inclusive, YYYY-MM-DD). */
export function rangeFor(preset: RangePreset, now: Date = new Date()): DashboardRange {
  const to = isoDay(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === 'this_month') return { from: isoDay(new Date(y, m, 1)), to };
  if (preset === 'last_month')
    return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
  if (preset === 'this_year') return { from: `${y}-01-01`, to };
  const months = preset === 'last_6_months' ? 5 : 11;
  return { from: isoDay(new Date(y, m - months, 1)), to };
}
