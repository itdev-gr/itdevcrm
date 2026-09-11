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
// Second fix-pass note (task-4-review-2.md, new Important): the first pass
// above still assumed the warm-up ladder always climbs starting "today".
// It doesn't, on its own — `warmup_started_on` is nullable with no default
// (20260907200000_campaign_tables.sql:132), and nothing wrote it until
// 20260907280000_warmup_starts_on_first_launch.sql (recreates
// `campaign_launch` to set it to `current_date` on first successful launch,
// only when still null). Two real states now exist and both must be modeled
// honestly:
//   - warm-up already started (N days ago, live `warmup_started_on`): index
//     the ladder from that real date.
//   - warm-up not started yet (`warmup_started_on IS NULL`): after the
//     migration above, launching TODAY is exactly what starts it — so the
//     estimate assumes day 0 of the ladder is `now`, matching what
//     `campaign_launch` will actually do the moment the owner clicks
//     «Εκκίνηση».
// What it deliberately still does NOT model: the hourly cap, or send-window
// clock time within a day — both can only push the real finish later, never
// earlier.

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
  /** The live `email_marketing_settings.warmup_started_on` date, or
   *  `null`/`undefined` when it hasn't been set yet. `null` is treated as
   *  "warm-up starts today" — see the header comment above for why that is
   *  the honest assumption post-20260907280000, not an optimistic guess. */
  warmupStartedOn?: Date | null;
  /** false = the campaign opted out of the ramp (email_campaigns.warmup_enabled,
   *  20260911140000): every send-day's allowance is simply `dailyCap`, exactly
   *  as campaign_daily_budget skips the `least(ladder, cap)` clamp. Defaults to
   *  true so every existing caller keeps today's laddered behaviour. */
  warmupEnabled?: boolean;
};

function isoWeekday(d: Date): number {
  const day = d.getDay(); // 0=Sun..6=Sat, local time
  return day === 0 ? 7 : day;
}

/** Whole calendar days from `from`'s local date to `to`'s local date
 *  (can be negative if `to` is earlier). Compares calendar dates, not
 *  elapsed 24h periods, so it's unaffected by DST shifts or time-of-day. */
function calendarDaysBetween(from: Date, to: Date): number {
  const fromUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUTC - fromUTC) / 86_400_000);
}

/**
 * Estimated completion date for a campaign, from its final recipient target,
 * its effective daily cap, its allowed send days, and the platform's
 * warm-up ladder — walking forward day by day (skipping non-send-days, and
 * clamping each send-day's allowance to `min(warmupLadder[ladderIdx], dailyCap)`)
 * until the target is exhausted, exactly mirroring how `campaign_daily_budget`
 * paces a live send.
 *
 * `ladderIdx` is the number of calendar days since warm-up began, clamped at
 * the ladder's last rung: when `warmupStartedOn` is a real date, counted
 * from THAT date; when it's null/undefined, counted from `now` (warm-up
 * begins the day sending actually starts — see the header comment).
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
  const warmupStartedOn = params.warmupStartedOn ?? null;

  let remaining = targetCount;
  for (let offset = 0; offset < MAX_LOOKAHEAD_DAYS; offset++) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() + offset);
    if (!sendDays.has(isoWeekday(day))) continue;

    let allowance = params.dailyCap;
    if (params.warmupEnabled !== false) {
      const ladderDaysSinceStart = warmupStartedOn ? Math.max(0, calendarDaysBetween(warmupStartedOn, day)) : offset;
      const ladderIdx = Math.min(ladderDaysSinceStart, ladder.length - 1);
      allowance = Math.min(ladder[ladderIdx]!, params.dailyCap);
    }
    remaining -= allowance;
    if (remaining <= 0) {
      return { days: offset + 1, date: day };
    }
  }
  return null;
}
