// deno-lint-ignore-file no-explicit-any
// Marketing campaign sender. Entirely separate from supabase/functions/send-email/:
// own queue (email_campaign_recipients), own cron (drain_campaign_sends,
// 20260907220000_campaign_queue_ops.sql), own auth secret
// (CAMPAIGN_DRAIN_SECRET — never EMAIL_DRAIN_SECRET, so campaigns can be
// killed in an emergency without taking transactional email down). The only
// files this task shares with the transactional system are
// send-email/identities.ts (additive only — the `marketing` identity) and
// _shared/emailMarkup.ts (deliberately dual-runtime, imported read-only via
// render.ts). send-email/index.ts and templates.ts are NOT imported here and
// NOT modified.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { IDENTITIES, type Identity } from '../send-email/identities.ts';
import { timingSafeEqual } from '../_shared/timing.ts';
import { renderCampaignEmail, campaignTags, unsubscribeHeaders } from './render.ts';

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

function buildUnsubscribeUrl(recipientId: string, token: string): string {
  return `${APP_BASE}/api/campaign-unsubscribe?r=${recipientId}&t=${token}`;
}

function resolveIdentity(campaign: CampaignRow): { from: string; replyTo: string } {
  const id = IDENTITIES[campaign.identity as Identity] ?? IDENTITIES.marketing;
  const replyTo = (campaign.reply_to ?? '').trim() || id.replyTo;
  return { from: id.from, replyTo };
}

function buildBatchItem(campaign: CampaignRow, identity: { from: string; replyTo: string }, recipient: RecipientRow) {
  const unsubscribeUrl = buildUnsubscribeUrl(recipient.id, recipient.unsubscribe_token);
  const { html, text } = renderCampaignEmail({
    bodyMd: campaign.body_md,
    heroImageUrl: campaign.hero_image_url,
    displayName: recipient.display_name,
    unsubscribeUrl,
  });
  return {
    from: identity.from,
    reply_to: identity.replyTo,
    to: recipient.email_lower,
    subject: campaign.subject,
    html,
    text,
    tags: campaignTags(campaign.id, recipient.id),
    headers: unsubscribeHeaders(unsubscribeUrl),
  };
}

/** One `email_campaigns` row whose `send_window`/`send_days` (Athens time)
 *  currently allow sending, oldest-started first. Exactly one campaign is
 *  ever chosen per drain() call — see the loop below for why. */
async function pickSendableCampaign(): Promise<CampaignRow | null> {
  const { data } = await admin
    .from('email_campaigns')
    .select('id, status, identity, subject, body_md, hero_image_url, reply_to, send_window_start, send_window_end, send_days, started_at')
    .eq('status', 'sending')
    .order('started_at', { ascending: true, nullsFirst: true });
  for (const c of (data ?? []) as CampaignRow[]) {
    if (inSendWindow(c)) return c;
  }
  return null;
}

/** Return a whole chunk to 'pending' with the error recorded — never mark
 *  any of its rows sent. Mirrors recover_stale_campaign_claims's reset shape
 *  (status back to 'pending', claimed_at cleared); attempts stays as
 *  claim_campaign_recipients already incremented it. */
async function releaseChunk(chunk: RecipientRow[], error: string): Promise<void> {
  const ids = chunk.map((r) => r.id);
  await admin
    .from('email_campaign_recipients')
    .update({ status: 'pending', claimed_at: null, error: error.slice(0, 2000) })
    .in('id', ids);
}

/** Mark a successfully-accepted chunk sent, one row per recipient (Resend's
 *  batch response order matches the request array order). This is
 *  bookkeeping for a batch whose HTTP call has ALREADY completed — it is not
 *  the "concurrent batches" the drain() loop below must never do, so running
 *  these per-row writes in parallel is safe. */
async function markChunkSent(chunk: RecipientRow[], resendIds: (string | null)[]): Promise<void> {
  const nowIso = new Date().toISOString();
  await Promise.all(
    chunk.map((r, i) =>
      admin
        .from('email_campaign_recipients')
        .update({ status: 'sent', sent_at: nowIso, resend_id: resendIds[i] ?? null, error: null })
        .eq('id', r.id),
    ),
  );
}

async function writeHeartbeat(sentCount: number, note: string): Promise<void> {
  await admin.from('email_campaign_heartbeat').upsert({
    id: true,
    ran_at: new Date().toISOString(),
    sent_count: sentCount,
    note,
  });
}

/** After a send pass: pause the campaign if its bounce or complaint rate
 *  (over everything ever sent for it) exceeds the configured ceiling.
 *  `.eq('status','sending')` guards against clobbering a status a concurrent
 *  admin action (pause/cancel) already changed. */
async function applyCircuitBreaker(campaignId: string, settings: SettingsRow): Promise<boolean> {
  const { count: sentCount } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('sent_at', 'is', null);
  const total = sentCount ?? 0;
  if (total === 0) return false;

  const { count: bouncedCount } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('bounced_at', 'is', null);
  const { count: complainedCount } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .not('complained_at', 'is', null);

  const bounceRate = (bouncedCount ?? 0) / total;
  const complaintRate = (complainedCount ?? 0) / total;

  if (bounceRate > settings.max_bounce_rate || complaintRate > settings.max_complaint_rate) {
    const reason =
      bounceRate > settings.max_bounce_rate
        ? `autopause: bounce rate ${(bounceRate * 100).toFixed(2)}% > ${(settings.max_bounce_rate * 100).toFixed(2)}% (${bouncedCount}/${total})`
        : `autopause: complaint rate ${(complaintRate * 100).toFixed(3)}% > ${(settings.max_complaint_rate * 100).toFixed(3)}% (${complainedCount}/${total})`;
    await admin
      .from('email_campaigns')
      .update({ status: 'paused', autopause_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'sending');
    return true;
  }
  return false;
}

async function drain(): Promise<Record<string, unknown>> {
  const { data: settingsRow } = await admin
    .from('email_marketing_settings')
    .select('paused, batch_slice, max_bounce_rate, max_complaint_rate')
    .eq('id', true)
    .maybeSingle();
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

  const { data: budgetRaw } = await admin.rpc('campaign_daily_budget', { p_campaign_id: campaign.id });
  const budget = typeof budgetRaw === 'number' ? budgetRaw : 0;
  const slice = Math.min(budget, settings.batch_slice);
  // Quiet exit, not an error — this is the normal steady state once a
  // campaign has used up today's/this hour's budget.
  if (slice <= 0) {
    await writeHeartbeat(0, 'no_budget');
    return { ok: true, campaignId: campaign.id, note: 'no_budget', claimed: 0, sent: 0, failed: 0 };
  }

  const { data: claimedRaw } = await admin.rpc('claim_campaign_recipients', {
    p_campaign_id: campaign.id,
    p_limit: slice,
  });
  const rows = (claimedRaw ?? []) as RecipientRow[];
  if (rows.length === 0) {
    await writeHeartbeat(0, 'nothing_to_claim');
    return { ok: true, campaignId: campaign.id, claimed: 0, sent: 0, failed: 0 };
  }

  const identity = resolveIdentity(campaign);
  let sent = 0;
  let failed = 0;
  let stoppedOn429 = false;

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
  // ---------------------------------------------------------------------
  for (let i = 0; i < rows.length; i += RESEND_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + RESEND_CHUNK_SIZE);
    const isLastChunk = i + RESEND_CHUNK_SIZE >= rows.length;
    // Sorted so the key is stable regardless of any incidental reordering —
    // a retry of the exact same set of ids must produce the exact same key.
    const idempotencyKey = `${campaign.id}:${await sha256Hex(chunk.map((r) => r.id).sort().join(','))}`;
    const payload = chunk.map((r) => buildBatchItem(campaign, identity, r));

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
      });
    } catch (e) {
      await releaseChunk(chunk, `fetch failed: ${String((e as Error).message ?? e)}`);
      failed += chunk.length;
      if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
      continue;
    }

    if (res.status === 429) {
      const error = await res.text().catch(() => 'rate limited (429)');
      await releaseChunk(chunk, `429: ${error}`.slice(0, 2000));
      failed += chunk.length;
      stoppedOn429 = true;
      break; // Stop the whole invocation immediately — do not retry.
    }

    if (!res.ok) {
      const error = await res.text().catch(() => `status ${res.status}`);
      await releaseChunk(chunk, `${res.status}: ${error}`.slice(0, 2000));
      failed += chunk.length;
      if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
      continue;
    }

    const body = await res.json().catch(() => null);
    const data = Array.isArray((body as any)?.data) ? (body as any).data : [];
    const resendIds: (string | null)[] = chunk.map((_r, j) =>
      typeof data[j]?.id === 'string' ? data[j].id : null,
    );
    await markChunkSent(chunk, resendIds);
    sent += chunk.length;

    if (!isLastChunk) await sleep(CHUNK_SLEEP_MS);
  }

  await applyCircuitBreaker(campaign.id, settings);

  // If the breaker didn't just pause it and nothing pending remains, the
  // campaign is finished.
  const { count: pendingCount } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending');
  if ((pendingCount ?? 0) === 0) {
    await admin
      .from('email_campaigns')
      .update({ status: 'sent', finished_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .eq('status', 'sending');
  }

  await writeHeartbeat(sent, stoppedOn429 ? 'rate_limited_429' : 'ok');
  return { ok: true, campaignId: campaign.id, claimed: rows.length, sent, failed, stoppedOn429 };
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
  const { data: campaignRaw } = await admin
    .from('email_campaigns')
    .select('id, status, identity, subject, body_md, hero_image_url, reply_to, send_window_start, send_window_end, send_days, started_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaignRaw) return { ok: false, error: 'campaign_not_found' };
  const campaign = campaignRaw as CampaignRow;

  const identity = resolveIdentity(campaign);
  const fakeRecipientId = crypto.randomUUID();
  const fakeToken = crypto.randomUUID();
  const unsubscribeUrl = buildUnsubscribeUrl(fakeRecipientId, fakeToken);
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
