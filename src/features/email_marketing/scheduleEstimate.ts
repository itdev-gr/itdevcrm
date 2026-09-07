// Pure arithmetic for "when does this campaign finish sending" — the owner's
// mental model is "press send, done tonight"; for a large audience against a
// modest daily cap the real answer is days (or weeks, with the warm-up
// ladder in play), not hours, and StepSchedule must show that plainly rather
// than let him discover it days into a campaign that's still "sending".
//
// Fix-pass note (task-4-review.md, Important-1): an earlier version divided
// targetCount by a single flat daily cap. That undercounts the number of
// send-days needed whenever the send-campaign edge function's own pacing
// (campaign_daily_budget, 20260907220000_campaign_queue_ops.sql) constrains a
// day BELOW the cap — which it always does for the first several days of the
// warm-up ladder, and every day the cap sits above the ladder's current rung.
// A flat estimate is therefore an EARLY date, not a safe floor: exactly the
// wrong direction for a screen whose whole job is correcting "done tonight"
// optimism. This version walks forward day by day instead, so it can only
// finish sending as fast as the real pacer would ever allow.
//
// What it deliberately still does NOT model: the live `warmup_started_on`
// date (whether warm-up has actually begun for the sending domain — if not,
// the real pacer sits at the ladder's first rung indefinitely, which only
// makes the true finish date LATER than this function's own estimate, never
// earlier), the hourly cap, or send-window clock time within a day. Every
// omitted factor can only push the real finish later — see the day_index
// comment below for why ladder progression itself is the one factor modeled
// eagerly (from day 0) rather than pessimistically.

export const DEFAULT_DAILY_CAP = 500; // Mirrors email_marketing_settings.daily_cap's
// schema default (20260907200000_campaign_tables.sql:129) — used only when
// the live settings row hasn't loaded yet (StepSchedule fetches it via
// useEmailMarketingSettings and passes the real value once available).

export const DEFAULT_WARMUP_LADDER: readonly number[] = [500, 1000, 2000, 3000, 5000, 7500, 10000];
// Mirrors email_marketing_settings.warmup_ladder's schema default
// (20260907200000_campaign_tables.sql:133) — same fallback role as
// DEFAULT_DAILY_CAP above.

// Safety valve against an infinite loop for a pathological input (e.g. a
// cap so small relative to the target that convergence would take more than
// ten years of send-days) — returns "no estimate" rather than hang.
const MAX_LOOKAHEAD_DAYS = 3650;

export type CampaignCompletionEstimate = {
  /** Calendar days from `now` (inclusive) until sending finishes — e.g. 1
   *  means "finishes today". */
  days: number;
  /** Calendar date sending is expected to finish. */
  date: Date;
};

export type CompletionEstimateParams = {
  /** The campaign's effective daily cap — already resolved by the caller as
   *  campaign.daily_cap ?? live-settings.daily_cap ?? DEFAULT_DAILY_CAP. */
  dailyCap: number;
  /** ISO day-of-week values (1=Mon..7=Sun) sending is allowed on — matches
   *  email_campaigns.send_days and send-campaign/index.ts's own isoDow. */
  sendDays: readonly number[];
  /** The platform warm-up ladder (email_marketing_settings.warmup_ladder),
   *  or DEFAULT_WARMUP_LADDER while live settings haven't loaded. Must be
   *  non-empty — campaign_daily_budget itself returns 0 budget for an empty
   *  ladder (20260907220000:121-124), which this mirrors by returning null. */
  warmupLadder?: readonly number[];
};

function isoWeekday(d: Date): number {
  const day = d.getDay(); // 0=Sun..6=Sat, local time
  return day === 0 ? 7 : day;
}

/**
 * Estimated completion date for a campaign, from its final recipient target,
 * its effective daily cap, its allowed send days, and the platform's
 * warm-up ladder — walking forward day by day (skipping non-send-days, and
 * clamping each send-day's allowance to `min(warmupLadder[dayIndex], dailyCap)`,
 * with `dayIndex` counted from `now` itself and clamped at the ladder's last
 * rung) until the target is exhausted, exactly mirroring how
 * `campaign_daily_budget` paces a live send.
 *
 * Returns `null` — never a nonsense date — when there is nothing to
 * estimate: a zero/negative/non-finite target, a non-positive/non-finite
 * cap, no allowed send days at all, an empty warm-up ladder, or (the
 * MAX_LOOKAHEAD_DAYS safety valve) an input so extreme it wouldn't converge
 * within ten years.
 */
export function estimateCampaignCompletion(
  targetCount: number,
  params: CompletionEstimateParams,
  now: Date = new Date(),
): CampaignCompletionEstimate | null {
  if (!Number.isFinite(targetCount) || targetCount <= 0) return null;
  if (!Number.isFinite(params.dailyCap) || params.dailyCap <= 0) return null;
  const sendDays = new Set(params.sendDays ?? []);
  if (sendDays.size === 0) return null; // Can never send — no estimate, not a guess.
  const ladder =
    params.warmupLadder && params.warmupLadder.length > 0 ? params.warmupLadder : DEFAULT_WARMUP_LADDER;

  let remaining = targetCount;
  for (let offset = 0; offset < MAX_LOOKAHEAD_DAYS; offset++) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() + offset);
    if (!sendDays.has(isoWeekday(day))) continue;

    const ladderIdx = Math.min(offset, ladder.length - 1);
    const allowance = Math.min(ladder[ladderIdx]!, params.dailyCap);
    remaining -= allowance;
    if (remaining <= 0) {
      return { days: offset + 1, date: day };
    }
  }
  return null;
}
