// Pure arithmetic for "when does this campaign finish sending" — the owner's
// mental model is "press send, done tonight"; for a large audience against a
// modest daily cap the real answer is days, not hours, and StepSchedule must
// show that plainly rather than let him discover it three days into a
// campaign that's still "sending".
//
// Deliberately simple: total recipients ÷ effective daily cap, rounded up to
// whole send-days, starting from `now`. It does NOT replicate the server's
// warm-up ladder (campaign_daily_budget in
// supabase/migrations/20260907220000_campaign_queue_ops.sql) or the hourly
// cap / send-window / send-day exclusions that function also applies —
// those can only push the real finish date LATER, never earlier, so this
// estimate is a reliable floor: exactly what a confirm-before-you-regret-it
// screen needs, without pretending to be the scheduler's own simulator.

export const DEFAULT_DAILY_CAP = 500; // Mirrors email_marketing_settings.daily_cap's default
// (supabase/migrations/20260907200000_campaign_tables.sql:129) — the cap a
// campaign falls back to while its own daily_cap field is unset (null).

export type CampaignCompletionEstimate = {
  /** Whole send-days needed at the given cap. Always >= 1 when an estimate exists. */
  days: number;
  /** Calendar date sending is expected to finish (same day as `now` when days === 1). */
  date: Date;
};

/**
 * Estimated completion date for a campaign, from its final recipient target
 * and its effective daily cap.
 *
 * Returns `null` — never a nonsense date — when there is nothing to estimate:
 * a zero (or negative/non-finite) target, or a non-positive/non-finite cap.
 */
export function estimateCampaignCompletion(
  targetCount: number,
  dailyCap: number,
  now: Date = new Date(),
): CampaignCompletionEstimate | null {
  if (!Number.isFinite(targetCount) || targetCount <= 0) return null;
  if (!Number.isFinite(dailyCap) || dailyCap <= 0) return null;

  const days = Math.max(1, Math.ceil(targetCount / dailyCap));
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + (days - 1));
  return { days, date };
}
