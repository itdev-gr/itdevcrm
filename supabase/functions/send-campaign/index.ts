// deno-lint-ignore-file no-explicit-any
// Marketing campaign sender. Entirely separate from supabase/functions/send-email/:
// own queue (email_campaign_recipients), own cron (drain_campaign_sends,
// 20260907220000_campaign_queue_ops.sql), own auth secret
// (CAMPAIGN_DRAIN_SECRET — a distinct env var, kept out of any future
// caller's hands even though the cron itself authenticates with the
// service-role key; see Q7/Minor-6 in task-5-review.md). The only files this
// task shares with the transactional system are send-email/identities.ts
// (additive only — the `marketing` identity) and _shared/emailMarkup.ts
// (deliberately dual-runtime, imported read-only via render.ts).
// send-email/index.ts and templates.ts are NOT imported here and NOT
// modified.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { IDENTITIES } from '../send-email/identities.ts';
import { timingSafeEqual } from '../_shared/timing.ts';
import {
  renderCampaignEmail,
  campaignTags,
  unsubscribeHeaders,
  buildCampaignBatchItem,
  buildUnsubscribeUrl,
  type CampaignForBatch,
} from './render.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
// Deliberately its own secret — see file header. Set once in the project's
// edge function secrets, never shared with EMAIL_DRAIN_SECRET.
const CAMPAIGN_DRAIN_SECRET = Deno.env.get('CAMPAIGN_DRAIN_SECRET') ?? '';
// Same source of truth as send-email/templates.ts's APP_BASE, duplicated
// (not imported) to keep this function's dependency surface limited to
// identities.ts + the dual-runtime render helpers.
const APP_BASE = Deno.env.get('APP_URL') ?? 'https://www.itdevcrm.com';

const admin = createClient(URL, SERVICE_KEY);

const RESEND_CHUNK_SIZE = 100;
const CHUNK_SLEEP_MS = 250; // ≤4 req/s, leaving ≥6/s of Resend's 10/s team cap for transactional mail.
const RESEND_FETCH_TIMEOUT_MS = 20_000; // Comfortably under the edge function's own wall-clock budget.
// The lease window PER RENEWAL, not a whole-invocation budget: the loop
// below renews it (extendDrainLock) after every chunk, so this only needs to
// comfortably exceed the worst realistic SINGLE chunk — one
// RESEND_FETCH_TIMEOUT_MS fetch, up to 100 parallel per-row writes, and a
// couple of PostgREST round-trips — not the whole (batch_slice-sized,
// admin-editable, unbounded) invocation. See the lock migrations
// (20260907240000, 20260907250000) for why this is a fenced lease, not a
// literal Postgres advisory lock.
const DRAIN_LOCK_LEASE_MS = 90_000;

type CampaignRow = {
  id: string;
  status: string;
  identity: string;
  subject: string;
  body_md: string;
  hero_image_url: string | null;
  reply_to: string | null;
  send_window_start: string;
  send_window_end: string;
  send_days: number[];
  started_at: string | null;
};

type RecipientRow = {
  id: string;
  email_lower: string;
  display_name: string | null;
  unsubscribe_token: string;
};

type SettingsRow = {
  paused: boolean;
  batch_slice: number;
  max_bounce_rate: number;
  max_complaint_rate: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every Supabase write in this file must be checked — a discarded `{error}`
 *  is exactly how I-3 happens (mail physically sent, DB write silently
 *  fails, row stays 'sending', gets re-sent 30 minutes later). Logs loudly
 *  and returns whether the write actually succeeded; callers must act on the
 *  return value rather than assuming success. */
function logDbError(context: string, error: { message: string } | null): boolean {
  if (!error) return true;
  console.error(`send-campaign: DB WRITE FAILED (${context}): ${error.message}`);
  return false;
}

/** Athens-local ISO day-of-week (1=Mon..7=Sun, matching `extract(isodow ...)`
 *  used elsewhere in this codebase, e.g. 20260831240000_ud_business_hours_due.sql)
 *  and "HH:MM" for lexicographic comparison against send_window_start/end. */
function athensParts(d: Date = new Date()): { isoDow: number; hhmm: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ISO_DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { isoDow: ISO_DOW[weekday] ?? 0, hhmm: `${hour}:${minute}` };
}

function inSendWindow(campaign: CampaignRow, now: Date = new Date()): boolean {
  const { isoDow, hhmm } = athensParts(now);
  if (!campaign.send_days.includes(isoDow)) return false;
  const start = String(campaign.send_window_start).slice(0, 5);
  const end = String(campaign.send_window_end).slice(0, 5);
  return hhmm >= start && hhmm <= end;
}

/** Campaign sending is restricted to the `marketing` identity ONLY (review
 *  fix pass, Minor M-2: the owner's rule is that marketing must stay
 *  separate from transactional identities like accounting/sales — an
 *  `email_campaigns.identity` value of anything else is a misconfiguration,
 *  never a legitimate choice, however it got there). */
function resolveIdentity(campaign: CampaignRow): { from: string; replyTo: string } {
  const id = IDENTITIES.marketing;
  const replyTo = (campaign.reply_to ?? '').trim() || id.replyTo;
  return { from: id.from, replyTo };
}

function toBatchCampaign(campaign: CampaignRow): CampaignForBatch {
  return { id: campaign.id, subject: campaign.subject, body_md: campaign.body_md, hero_image_url: campaign.hero_image_url };
}

/** One `email_campaigns` row whose `send_window`/`send_days` (Athens time)
 *  currently allow sending, oldest-started first. Exactly one campaign is
 *  ever chosen per drain() call — see the loop below for why. */
async function pickSendableCampaign(): Promise<CampaignRow | null> {
  const { data, error } = await admin
    .from('email_campaigns')
    .select('id, status, identity, subject, body_md, hero_image_url, reply_to, send_window_start, send_window_end, send_days, started_at')
    .eq('status', 'sending')
    .order('started_at', { ascending: true, nullsFirst: true });
  if (!logDbError('pickSendableCampaign', error)) return null; // fail closed: no read → nothing to send this tick
  for (const c of (data ?? []) as CampaignRow[]) {
    if (inSendWindow(c)) return c;
  }
  return null;
}

/** Return a whole chunk to 'pending' with the error recorded — never mark
 *  any of its rows sent. Mirrors recover_stale_campaign_claims's reset shape
 *  (status back to 'pending', claimed_at cleared); attempts stays as
 *  claim_campaign_recipients already incremented it. Returns whether the
 *  write itself succeeded (I-3) — a caller must not assume the rows are
 *  actually back to 'pending' just because this was called.
 *
 *  CALLERS MUST PASS AT MOST RESEND_CHUNK_SIZE (100) ROWS. This builds an
 *  `id=in.(…)` filter in the request's query string; a few hundred UUIDs
 *  there runs into the ~8KB request-line limit typical of the gateway in
 *  front of PostgREST (review fix, New Important-2 — this bit a caller that
 *  passed it batch_slice-many rows in one call). Anything larger than one
 *  chunk must go through releaseRows() below, which slices it first. */
async function releaseChunk(chunk: RecipientRow[], errorText: string): Promise<boolean> {
  if (chunk.length === 0) return true;
  const ids = chunk.map((r) => r.id);
  const { error } = await admin
    .from('email_campaign_recipients')
    .update({ status: 'pending', claimed_at: null, error: errorText.slice(0, 2000) })
    .in('id', ids);
  return logDbError(`releaseChunk(${ids.length} rows)`, error);
}

/** Release an arbitrary number of rows back to 'pending', in ≤RESEND_CHUNK_SIZE
 *  (100) -id batches per releaseChunk() call — see that function's doc
 *  comment for why a single unbounded `id=in.(…)` filter is unsafe. Used
 *  wherever more than one chunk's worth of already-claimed rows must be
 *  released at once (a 429's unattempted tail, or rows abandoned because
 *  this invocation lost its drain lock lease mid-send). Returns the total
 *  count of rows whose release write failed. */
async function releaseRows(rows: RecipientRow[], errorText: string): Promise<number> {
  let writeErrors = 0;
  for (let i = 0; i < rows.length; i += RESEND_CHUNK_SIZE) {
    const slice = rows.slice(i, i + RESEND_CHUNK_SIZE);
    if (!(await releaseChunk(slice, errorText))) writeErrors += slice.length;
  }
  return writeErrors;
}

/** DO NOT collapse this with releaseChunk/releaseRows above.
 *
 *  releaseChunk/releaseRows are for rows whose Resend call actually went out
 *  (fetch threw, returned a non-429 error, returned a length-mismatched
 *  body, or the 429 itself) — those are real attempts, so they keep the
 *  `attempts` increment claim_campaign_recipients already applied.
 *
 *  This function is for rows that were claimed but this invocation never
 *  even built a request for: the untried tail released after a 429 on an
 *  earlier chunk, and rows abandoned because the invocation lost its drain
 *  lock lease before it reached them. For those, `attempts` must be given
 *  back — otherwise a run of transient 429s can exhaust attempts<3 on people
 *  who were never contacted, after which failExhaustedRecipients marks them
 *  'failed' and maybeCompleteCampaign reports the campaign 'sent' with them
 *  silently dropped (I-3). postgrest-js can't express `attempts = attempts -
 *  1` via a plain `.update()`, so this calls the
 *  release_unattempted_campaign_recipients RPC (20260907260000) instead. */
async function releaseChunkUnattempted(chunk: RecipientRow[], errorText: string): Promise<boolean> {
  if (chunk.length === 0) return true;
  const ids = chunk.map((r) => r.id);
  const { error } = await admin.rpc('release_unattempted_campaign_recipients', {
    p_ids: ids,
    p_error: errorText.slice(0, 2000),
  });
  return logDbError(`releaseChunkUnattempted(${ids.length} rows)`, error);
}

/** releaseRows's un-attempted counterpart — see releaseChunkUnattempted's
 *  doc comment for which release path this is for. Batches the same way
 *  releaseRows does; not strictly required for an RPC call (no query-string
 *  length limit here), but kept consistent so the two release paths behave
 *  the same way under a large slice. */
async function releaseRowsUnattempted(rows: RecipientRow[], errorText: string): Promise<number> {
  let writeErrors = 0;
  for (let i = 0; i < rows.length; i += RESEND_CHUNK_SIZE) {
    const slice = rows.slice(i, i + RESEND_CHUNK_SIZE);
    if (!(await releaseChunkUnattempted(slice, errorText))) writeErrors += slice.length;
  }
  return writeErrors;
}

/** Mark a successfully-accepted chunk sent, one row per recipient (Resend's
 *  batch response order matches the request array order — checked by the
 *  caller before this is reached). This is bookkeeping for a batch whose
 *  HTTP call has ALREADY completed — it is not the "concurrent batches" the
 *  drain() loop below must never do, so running these per-row writes in
 *  parallel is safe. Returns the count of rows whose write FAILED — the
 *  caller must treat that as "mail sent, DB state unknown", not success. */
async function markChunkSent(chunk: RecipientRow[], resendIds: (string | null)[]): Promise<number> {
  const nowIso = new Date().toISOString();
  const results = await Promise.all(
    chunk.map((r, i) =>
      admin
        .from('email_campaign_recipients')
        .update({ status: 'sent', sent_at: nowIso, resend_id: resendIds[i] ?? null, error: null })
        .eq('id', r.id),
    ),
  );
  let writeErrors = 0;
  results.forEach((res, i) => {
    if (
      !logDbError(
        `markChunkSent(recipient ${chunk[i]?.id}) — MAIL WAS ALREADY SENT TO RESEND, row status could not be updated`,
        res.error,
      )
    ) {
      writeErrors++;
    }
  });
  return writeErrors;
}

async function writeHeartbeat(sentCount: number, note: string): Promise<void> {
  const { error } = await admin.from('email_campaign_heartbeat').upsert({
    id: true,
    ran_at: new Date().toISOString(),
    sent_count: sentCount,
    note,
  });
  logDbError('writeHeartbeat', error);
}

/** Atomic, self-expiring, FENCED lease so overlapping drain() invocations
 *  (the cron fires every minute, fire-and-forget, and does not wait for the
 *  previous call — see migration 20260907240000 for the full reasoning and
 *  why this is a lease rather than a literal pg_try_advisory_lock) can never
 *  both believe they hold the lock. Mints a fresh random token and writes it
 *  alongside the expiry (migration 20260907250000); every later
 *  extend/release call must present this same token, so an invocation whose
 *  lease was reassigned to someone else (because its own lease expired
 *  first) can no longer extend or release the NEW owner's lease — the
 *  New Important-1 bug from fix-2-review.md. Returns the token on success,
 *  or null if the lease is already held. Fails closed: any error acquiring
 *  the lease is treated as "not acquired", never as "acquired". */
async function tryAcquireDrainLock(): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + DRAIN_LOCK_LEASE_MS).toISOString();
  const token = crypto.randomUUID();
  const { data, error } = await admin
    .from('email_campaign_heartbeat')
    .update({ lock_expires_at: leaseUntilIso, lock_token: token })
    .eq('id', true)
    .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
    .select('id');
  if (!logDbError('tryAcquireDrainLock', error)) return null;
  return (data ?? []).length > 0 ? token : null;
}

/** Pushes this invocation's lease expiry back out, ONLY if `token` still
 *  matches the lease's current `lock_token` — i.e. only if nothing has
 *  reassigned the lease since this invocation acquired (or last renewed) it.
 *  Called after every chunk in the send loop so a legitimately slow drain
 *  (a large batch_slice, a sluggish Resend) keeps its lock instead of losing
 *  it mid-send, rather than solving this by guessing a bigger fixed lease
 *  length. Returns whether the renewal actually landed; the caller MUST
 *  treat `false` — including a DB error, fail-closed — as "no longer holds
 *  the lock" and stop sending immediately rather than continue unfenced. */
async function extendDrainLock(token: string): Promise<boolean> {
  const leaseUntilIso = new Date(Date.now() + DRAIN_LOCK_LEASE_MS).toISOString();
  const { data, error } = await admin
    .from('email_campaign_heartbeat')
    .update({ lock_expires_at: leaseUntilIso })
    .eq('id', true)
    .eq('lock_token', token)
    .select('id');
  if (!logDbError('extendDrainLock', error)) return false; // fail closed: unknown state, treat as lost
  return (data ?? []).length > 0;
}

/** Clears the lease, but ONLY when `token` still matches — so an invocation
 *  whose lease already expired and was legitimately reassigned to a newer
 *  invocation matches zero rows here and leaves that newer lease alone,
 *  instead of the pre-fix unconditional clear that let a stale invocation
 *  evict a live one. */
async function releaseDrainLock(token: string): Promise<void> {
  const { error } = await admin
    .from('email_campaign_heartbeat')
    .update({ lock_expires_at: null, lock_token: null })
    .eq('id', true)
    .eq('lock_token', token);
  logDbError('releaseDrainLock', error);
}

/** Rows claim_campaign_recipients will never claim again
 *  (`attempts >= 3`, migration 20260907220000:35) but that were left at
 *  'pending' by a release. Without this sweep such rows block campaign
 *  completion forever (C-1) and, because pickSendableCampaign always returns
 *  the single oldest 'sending' campaign, silently starve every campaign
 *  launched afterwards (I-4). Parks them at the schema's existing 'failed'
 *  status, WITHOUT overwriting `error` — the column already holds the real
 *  reason from the last failed attempt. */
async function failExhaustedRecipients(campaignId: string): Promise<void> {
  const { error } = await admin
    .from('email_campaign_recipients')
    .update({ status: 'failed' })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .gte('attempts', 3);
  logDbError(`failExhaustedRecipients(campaign ${campaignId})`, error);
}

/** A campaign is finished when nothing is left `pending` OR `sending` — C-1
 *  fix. The previous check only counted `pending`, so rows still claimed as
 *  `sending` (an in-flight batch, or one stuck by a write failure) were
 *  invisible to it and got silently and permanently dropped while the
 *  campaign reported itself 100% complete. `failed` rows (see
 *  failExhaustedRecipients above) are correctly excluded — they are a
 *  terminal state, not unfinished work. */
async function maybeCompleteCampaign(campaignId: string): Promise<void> {
  const { count: unfinishedCount, error } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'sending']);
  if (!logDbError(`maybeCompleteCampaign/count(campaign ${campaignId})`, error)) return; // fail closed: never mark complete without a confirmed read
  if ((unfinishedCount ?? 0) === 0) {
    const { error: updErr } = await admin
      .from('email_campaigns')
      .update({ status: 'sent', finished_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'sending');
    logDbError(`maybeCompleteCampaign/update(campaign ${campaignId})`, updErr);
  }
}

/** After a send pass: pause the campaign if its bounce or complaint rate
 *  (over everything ever sent for it) exceeds the configured ceiling.
 *  `.eq('status','sending')` guards against clobbering a status a concurrent
 *  admin action (pause/cancel) already changed. */
async function applyCircuitBreaker(campaignId: string, settings: SettingsRow): Promise<boolean> {
  const { count: sentCount, error: sentErr } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('sent_at', 'is', null);
  if (!logDbError(`applyCircuitBreaker/sentCount(campaign ${campaignId})`, sentErr)) return false;
  const total = sentCount ?? 0;
  if (total === 0) return false;

  const { count: bouncedCount, error: bouncedErr } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('bounced_at', 'is', null);
  const { count: complainedCount, error: complainedErr } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('complained_at', 'is', null);
  if (!logDbError(`applyCircuitBreaker/bouncedCount(campaign ${campaignId})`, bouncedErr)) return false;
  if (!logDbError(`applyCircuitBreaker/complainedCount(campaign ${campaignId})`, complainedErr)) return false;

  const bounceRate = (bouncedCount ?? 0) / total;
  const complaintRate = (complainedCount ?? 0) / total;

  if (bounceRate > settings.max_bounce_rate || complaintRate > settings.max_complaint_rate) {
    const reason =
      bounceRate > settings.max_bounce_rate
        ? `autopause: bounce rate ${(bounceRate * 100).toFixed(2)}% > ${(settings.max_bounce_rate * 100).toFixed(2)}% (${bouncedCount}/${total})`
        : `autopause: complaint rate ${(complaintRate * 100).toFixed(3)}% > ${(settings.max_complaint_rate * 100).toFixed(3)}% (${complainedCount}/${total})`;
    const { error: pauseErr } = await admin
      .from('email_campaigns')
      .update({ status: 'paused', autopause_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'sending');
    return logDbError(`applyCircuitBreaker/pause(campaign ${campaignId})`, pauseErr);
  }
  return false;
}

async function drainLocked(lockToken: string): Promise<Record<string, unknown>> {
  const { data: settingsRow, error: settingsErr } = await admin
    .from('email_marketing_settings')
    .select('paused, batch_slice, max_bounce_rate, max_complaint_rate')
    .eq('id', true)
    .maybeSingle();
  logDbError('drain/settings', settingsErr);
  const settings = settingsRow as SettingsRow | null;
  if (!settings || settings.paused) {
    await writeHeartbeat(0, 'paused');
    return { ok: true, note: 'paused', claimed: 0, sent: 0, failed: 0 };
  }

  const campaign = await pickSendableCampaign();
  if (!campaign) {
    await writeHeartbeat(0, 'no_sendable_campaign');
    return { ok: true, note: 'no_sendable_campaign', claimed: 0, sent: 0, failed: 0 };
  }

  // Identity restriction (review fix, Minor M-2): campaign sending must never
  // go out under a transactional identity (accounting/sales/internal/info).
  // A campaign whose `identity` column isn't 'marketing' is a
  // misconfiguration — paused loudly rather than silently sent or silently
  // skipped, so an admin sees it and fixes the row before resuming.
  if (campaign.identity !== 'marketing') {
    const { error: blockErr } = await admin
      .from('email_campaigns')
      .update({
        status: 'paused',
        autopause_reason: `autopause: identity '${campaign.identity}' is not allowed for campaign sending — marketing only`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaign.id)
      .eq('status', 'sending');
    logDbError(`drain/blockBadIdentity(campaign ${campaign.id})`, blockErr);
    await writeHeartbeat(0, 'blocked_bad_identity');
    return { ok: true, campaignId: campaign.id, note: 'blocked_bad_identity', claimed: 0, sent: 0, failed: 0 };
  }

  const { data: budgetRaw, error: budgetErr } = await admin.rpc('campaign_daily_budget', { p_campaign_id: campaign.id });
  logDbError(`drain/campaign_daily_budget(campaign ${campaign.id})`, budgetErr);
  const budget = typeof budgetRaw === 'number' ? budgetRaw : 0;
  const slice = Math.min(budget, settings.batch_slice);

  let rows: RecipientRow[] = [];
  if (slice > 0) {
    const { data: claimedRaw, error: claimErr } = await admin.rpc('claim_campaign_recipients', {
      p_campaign_id: campaign.id,
      p_limit: slice,
    });
    logDbError(`drain/claim_campaign_recipients(campaign ${campaign.id})`, claimErr);
    rows = (claimedRaw ?? []) as RecipientRow[];
  }

  const identity = resolveIdentity(campaign);
  const batchCampaign = toBatchCampaign(campaign);
  let sent = 0;
  let failed = 0;
  let dbWriteErrors = 0;
  let stoppedOn429 = false;
  let lostLock = false;

  if (rows.length > 0) {
    // ---------------------------------------------------------------------
    // IMPORTANT — do not parallelise this loop.
    //
    // campaign_daily_budget() (20260907220000_campaign_queue_ops.sql) counts
    // ONLY rows already at status='sent'; rows sitting at 'sending' (claimed
    // but not yet resolved) are NOT subtracted from the budget. `slice` above
    // was computed ONCE, from the budget as it stood before this loop started.
    // If two chunks' Resend calls were in flight at the same time, a second
    // drain tick (or a bug that fires chunks concurrently here) could compute
    // the SAME leftover budget and claim on top of what's already in flight,
    // pushing the day's total sent past the configured cap — the exact
    // failure this file exists to prevent. So: exactly one claim-and-send pass
    // per invocation, chunks processed strictly one after another
    // (`for` + `await`, never `Promise.all` across chunks), and the 250ms
    // sleep between them is also what keeps us under Resend's rate limit.
    //
    // This invariant is now ALSO enforced across invocations by the
    // acquire/release lease in drain() below (review fix, I-2) — this
    // comment covers the in-function half of the guarantee; the lease covers
    // the cross-invocation half.
    // ---------------------------------------------------------------------
    for (let i = 0; i < rows.length; i += RESEND_CHUNK_SIZE) {
      // Renew the drain lock before every chunk after the first (the first
      // chunk starts inside the fresh lease tryAcquireDrainLock() just took).
      // Fixes New Important-1(b): a fixed lease length can't safely bound an
      // admin-editable batch_slice, so instead of guessing bigger, the lease
      // is kept alive for as long as this invocation is actually still
      // working. If the renewal doesn't land — including a DB error,
      // fail-closed — this invocation no longer has a proven claim on the
      // lock (another drain may already own it), so it must stop sending
      // immediately and release every row it hasn't yet attempted, rather
      // than keep going unfenced.
      if (i > 0) {
        const stillOwned = await extendDrainLock(lockToken);
        if (!stillOwned) {
          const abandoned = rows.slice(i);
          // Never attempted: no Resend request was ever built for these
          // rows, so give the attempts increment back (I-3).
          const releaseErrors = await releaseRowsUnattempted(
            abandoned,
            'not attempted: this invocation lost its drain lock lease mid-send',
          );
          dbWriteErrors += releaseErrors;
          failed += abandoned.length;
          lostLock = true;
          break;
        }
      }
      const chunk = rows.slice(i, i + RESEND_CHUNK_SIZE);
      const isLastChunk = i + RESEND_CHUNK_SIZE >= rows.length;
      // Sorted so the key is stable regardless of any incidental reordering —
      // a retry of the exact same set of ids must produce the exact same key.
      const idempotencyKey = `${campaign.id}:${await sha256Hex(chunk.map((r) => r.id).sort().join(','))}`;
      const payload = chunk.map((r) => buildCampaignBatchItem(APP_BASE, batchCampaign, identity, r));

      let res: Response;
      try {
        res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
        });
      } catch (e) {
        if (!(await releaseChunk(chunk, `fetch failed: ${String((e as Error).message ?? e)}`))) dbWriteErrors += chunk.length;
        failed += chunk.length;
        if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
        continue;
      }

      if (res.status === 429) {
        const errText = await res.text().catch(() => 'rate limited (429)');
        if (!(await releaseChunk(chunk, `429: ${errText}`.slice(0, 2000)))) dbWriteErrors += chunk.length;
        failed += chunk.length;
        // I-1: every chunk further down the already-claimed slice must also
        // go back to 'pending' now — otherwise those rows sit at 'sending'
        // for up to 30 minutes until recover_stale_campaign_claims notices
        // them, during which they count as neither sent nor pending and can
        // strand the campaign the way C-1 described. Released via
        // releaseRowsUnattempted() (New Important-2, and I-3 below):
        // `remaining` can be up to batch_slice-100 rows, and a single
        // `id=in.(…)`-style filter with that many UUIDs risks a 414 at the
        // gateway — releaseRowsUnattempted slices it into ≤100-id RPC calls
        // instead of one unbounded one.
        const remaining = rows.slice(i + RESEND_CHUNK_SIZE);
        if (remaining.length > 0) {
          // Never attempted: this is the untried TAIL after the chunk that
          // actually got the 429 (that chunk was posted — it keeps its
          // increment via releaseChunk above). Give the attempts increment
          // back for these (I-3).
          const releaseErrors = await releaseRowsUnattempted(
            remaining,
            'not attempted: invocation stopped after a 429 on an earlier chunk',
          );
          dbWriteErrors += releaseErrors;
          failed += remaining.length;
        }
        stoppedOn429 = true;
        break; // Stop the whole invocation immediately — do not retry.
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => `status ${res.status}`);
        if (!(await releaseChunk(chunk, `${res.status}: ${errText}`.slice(0, 2000)))) dbWriteErrors += chunk.length;
        failed += chunk.length;
        if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
        continue;
      }

      const resBody = await res.json().catch(() => null);
      const data = Array.isArray((resBody as any)?.data) ? (resBody as any).data : [];
      // Defensive (review fix, Minor M-5): resend_id is mapped positionally
      // onto the chunk. If the response array is ever a different length
      // than the request, positional mapping could attach the wrong
      // resend_id to the wrong recipient — corrupting every later webhook
      // bounce/complaint attribution for that row. Fail the whole chunk
      // loudly (release, don't guess) rather than risk a mis-assignment.
      if (data.length !== chunk.length) {
        if (
          !(await releaseChunk(
            chunk,
            `resend batch response length mismatch: got ${data.length}, expected ${chunk.length} — refused to positionally assign resend_id`,
          ))
        ) {
          dbWriteErrors += chunk.length;
        }
        failed += chunk.length;
        if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
        continue;
      }
      const resendIds: (string | null)[] = chunk.map((_r, j) => (typeof data[j]?.id === 'string' ? data[j].id : null));
      const writeErrors = await markChunkSent(chunk, resendIds);
      dbWriteErrors += writeErrors;
      sent += chunk.length;

      if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
    }
  }

  // These three run every time a campaign was selected and passed the
  // identity check — including when slice<=0 or nothing was claimed this
  // tick, which is exactly the I-4 scenario (a campaign whose only
  // remaining rows have exhausted their attempts must still get swept to
  // 'failed' so it can complete, rather than being re-selected forever).
  await failExhaustedRecipients(campaign.id);
  await applyCircuitBreaker(campaign.id, settings);
  await maybeCompleteCampaign(campaign.id);

  let note: string;
  if (lostLock) note = 'lost_drain_lock';
  else if (stoppedOn429) note = 'rate_limited_429';
  else if (dbWriteErrors > 0) note = `db_write_errors:${dbWriteErrors}`;
  else if (rows.length === 0) note = slice <= 0 ? 'no_budget' : 'nothing_to_claim';
  else note = 'ok';

  await writeHeartbeat(sent, note);
  return { ok: true, campaignId: campaign.id, claimed: rows.length, sent, failed, dbWriteErrors, stoppedOn429, lostLock };
}

/** Acquires the cross-invocation fenced lease before doing any work, and
 *  always releases it afterward (even on an uncaught throw) — see
 *  tryAcquireDrainLock/releaseDrainLock and migrations 20260907240000/
 *  20260907250000. If the lease is already held, this is a quiet, expected
 *  exit: it means a previous invocation is still mid-flight (normally
 *  because Resend is slow), not an error. The token minted here is threaded
 *  through drainLocked() so its chunk loop can renew the same lease it
 *  started with (extendDrainLock) — never anyone else's. */
async function drain(): Promise<Record<string, unknown>> {
  const lockToken = await tryAcquireDrainLock();
  if (!lockToken) {
    return { ok: true, note: 'lock_held', claimed: 0, sent: 0, failed: 0 };
  }
  try {
    return await drainLocked(lockToken);
  } finally {
    await releaseDrainLock(lockToken);
  }
}

/** Renders and sends exactly one email to `to`, using the campaign's current
 *  subject/body/hero — so a campaign can be proofed before launch. Not tied
 *  to any real email_campaign_recipients row: the tag/unsubscribe-link
 *  recipient id is a throwaway uuid, so clicking the link in a test send
 *  just shows the generic "invalid link" page instead of mutating a real
 *  subscriber. Bypasses the queue, budget and Idempotency-Key entirely —
 *  this is a single manual send, not part of the paced drain. */
async function testSend(campaignId: string, to: string): Promise<{ ok: boolean; error?: string; resendId?: string }> {
  if (!to || /[\r\n]/.test(to) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: 'invalid_recipient' };
  }
  const { data: campaignRaw, error: campaignErr } = await admin
    .from('email_campaigns')
    .select('id, status, identity, subject, body_md, hero_image_url, reply_to, send_window_start, send_window_end, send_days, started_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (!logDbError(`testSend/fetchCampaign(${campaignId})`, campaignErr) || !campaignRaw) {
    return { ok: false, error: 'campaign_not_found' };
  }
  const campaign = campaignRaw as CampaignRow;

  // Same restriction as drain(): a proof send must reflect exactly what a
  // real send would do, and a real send never uses a non-marketing identity.
  if (campaign.identity !== 'marketing') {
    return { ok: false, error: 'identity_not_marketing' };
  }

  const identity = resolveIdentity(campaign);
  const fakeRecipientId = crypto.randomUUID();
  const fakeToken = crypto.randomUUID();
  const unsubscribeUrl = buildUnsubscribeUrl(APP_BASE, fakeRecipientId, fakeToken);
  const { html, text } = renderCampaignEmail({
    bodyMd: campaign.body_md,
    heroImageUrl: campaign.hero_image_url,
    displayName: null,
    unsubscribeUrl,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: identity.from,
      reply_to: identity.replyTo,
      to,
      subject: `[TEST] ${campaign.subject}`,
      html,
      text,
      tags: campaignTags(campaign.id, fakeRecipientId),
      headers: unsubscribeHeaders(unsubscribeUrl),
    }),
    signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const error = await res.text().catch(() => `status ${res.status}`);
    return { ok: false, error };
  }
  const body = await res.json().catch(() => ({}) as any);
  return { ok: true, resendId: (body as any)?.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole =
    (token !== '' && timingSafeEqual(token, SERVICE_KEY)) ||
    (CAMPAIGN_DRAIN_SECRET !== '' && timingSafeEqual(token, CAMPAIGN_DRAIN_SECRET));

  const body = (await req.json().catch(() => null)) as
    | { drain?: boolean; campaignId?: string; test?: boolean; to?: string }
    | null;
  if (!body) return json({ error: 'Bad request' }, 400);

  // Drain mode: the cron pulse only — service role or CAMPAIGN_DRAIN_SECRET.
  if (body.drain) {
    if (!isServiceRole) return json({ error: 'Forbidden' }, 403);
    return json(await drain());
  }

  // Test-send mode: service role, or an authenticated admin (for the future
  // campaign-editor UI's "proof this campaign" button).
  if (body.test && typeof body.campaignId === 'string' && typeof body.to === 'string') {
    if (!isServiceRole) {
      const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await caller.auth.getUser();
      if (!u?.user) return json({ error: 'Unauthorized' }, 401);
      const { data: prof } = await admin.from('profiles').select('is_admin').eq('user_id', u.user.id).maybeSingle();
      if (!prof?.is_admin) return json({ error: 'Forbidden' }, 403);
    }
    const result = await testSend(body.campaignId, body.to);
    return json(result, result.ok ? 200 : 400);
  }

  return json({ error: 'Missing drain, or campaignId/test/to' }, 400);
});
