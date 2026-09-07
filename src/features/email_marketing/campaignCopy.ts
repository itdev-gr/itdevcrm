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

/** Whatever shape the `campaign_stats` RPC's `by_status` breakdown takes. */
export type CampaignTargetStats = { by_status: Record<string, number> };

/**
 * The ONE "final send target" derivation for a campaign, from its
 * `campaign_stats` payload — every recipient row EXCEPT the ones excluded
 * before send (`status === 'suppressed'`). Before the fix (final-review.md,
 * Important-2) StepReview derived this from `by_status.pending` alone
 * (correct only in the instant right after a build — it drains to 0 as
 * sending progresses, and reads a flat, false "0" once a campaign
 * finishes) while CampaignDetailPage derived it as `sum − suppressed`
 * (constant across the whole life of a build, so it reads the same number
 * before, during and after a send). This is that second, correct
 * definition, extracted once so the two screens can no longer disagree.
 *
 * Returns `null` — never a stale or zero-by-coincidence number — when there
 * is no stats payload yet, OR when `preparedAt` is `null` (the campaign's
 * last recipient build has been invalidated: an audience was
 * attached/detached, imported into, or the segment edited since). An absent
 * number is honest; a stale one is not (final-review.md, Important-1b).
 */
export function campaignTargetCount(
  stats: CampaignTargetStats | null | undefined,
  preparedAt: string | null | undefined,
): number | null {
  if (!stats || preparedAt == null) return null;
  return Object.entries(stats.by_status).reduce((sum, [status, n]) => (status === 'suppressed' ? sum : sum + n), 0);
}
