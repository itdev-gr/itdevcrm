/**
 * Pure text/rate helpers for the email marketing UI. No Supabase, no React —
 * kept this way so every rounding/zero-division/honesty trap can be unit
 * tested without mocking anything.
 */

/** Whatever shape a campaign's counters take, as long as `sent` and an
 *  (optional, not-yet-shipped) `opened` count are present. Matches the
 *  campaign_stats RPC's `sent` field plus a future open-tracking addition. */
export type CampaignRateStats = {
  sent: number;
  opened?: number;
};

/**
 * numerator / denominator, but honest about it: a zero denominator returns
 * `null` instead of `NaN`/`Infinity`/a silently-wrong `0`. Callers must render
 * `null` as "—" (see `formatRate`), never as a rate.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/** `null` → «—»; otherwise a one-decimal percentage. */
export function formatRate(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * The open rate is dishonest to show as "0%" while open tracking is off —
 * that reads as "nobody opened this" when the truth is "we aren't measuring
 * this yet" (Phase 2). So `trackingEnabled === false` must short-circuit to
 * the Greek words for "not measured", never fall through to a computed rate.
 */
export function openRateDisplay(stats: CampaignRateStats, trackingEnabled: boolean): string {
  if (!trackingEnabled) return 'δεν μετράται';
  return formatRate(rate(stats.opened ?? 0, stats.sent));
}
