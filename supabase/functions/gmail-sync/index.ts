// gmail-sync: pull each connected user's client email into email_messages.
// Modes:
//   { user_id } .............. sync one user (backfill on first run, else incremental)
//   { mode: 'sweep' } ........ sync every read-scoped user (called by pg_cron every 5 min)
// Auth: Bearer GMAIL_SYNC_SECRET (manual) OR the service-role key (the cron).
// verify_jwt=false (config.toml) so the cron's header-only call reaches it.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { decryptToken, refreshAccessToken, listGmailMessageIds, getGmailMessageFull } from '../_shared/google.ts';
import { timingSafeEqual } from '../_shared/timing.ts';
import { ADOPTION_WINDOW_MS, nearestBySentAt } from '../_shared/emailDedup.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')!;
const SYNC_SECRET = Deno.env.get('GMAIL_SYNC_SECRET') ?? '';
const admin = createClient(URL_, SERVICE_KEY);

const OVERLAP_SEC = 600; // re-scan a 10-min overlap each incremental run; dedup absorbs it.

type SyncResult = { scanned: number; matched: number; stored: number; errors: number };

type CapturedRow = {
  message_id: string; gmail_id: string; thread_id: string | null;
  direction: string; from_email: string; from_name: string | null; to_email: string;
  subject: string | null; body_text: string | null; body_html: string | null; snippet: string | null;
  cc_emails: string | null; sent_at: string | null;
  client_id: string | null; deal_id: string | null; job_id: string | null; lead_id: string | null;
  department: string | null; staff_user_id: string | null; captured_from_user_id: string;
};

// Store a captured message, folding it into its send-time mirror row when one
// exists (spec 2026-07-29-email-mirror-dedup-design.md): send-email writes a
// mirror row per Resend send, and the dept-CC copy of the same email arrives
// here minutes later with the real Message-ID. One logical email must stay
// ONE row, else the Mail tab shows it twice.
async function storeCaptured(row: CapturedRow): Promise<boolean> {
  // (a) Same Message-ID already stored: an earlier sweep of another mailbox
  //     (gmail_id set → done) or a mirror whose custom Message-ID header
  //     survived delivery (gmail_id null → attach the Gmail metadata so the
  //     thread folds and Reply works).
  const { data: existing, error: exErr } = await admin.from('email_messages')
    .select('id, gmail_id').eq('message_id', row.message_id).maybeSingle();
  if (exErr) return false;
  if (existing) {
    if (existing.gmail_id) return true;
    const { error } = await admin.from('email_messages').update({
      gmail_id: row.gmail_id, thread_id: row.thread_id,
      body_text: row.body_text, body_html: row.body_html, snippet: row.snippet,
      captured_from_user_id: row.captured_from_user_id,
    }).eq('id', existing.id);
    return !error;
  }
  // (b) Un-adopted mirror twin stored under a synthetic id: adopt it in
  //     place (keeps the row id, so email_message_bcc children survive).
  if (row.direction === 'outbound' && row.sent_at) {
    const t = new Date(row.sent_at).getTime();
    let q = admin.from('email_messages')
      .select('id, message_id, sent_at, cc_emails')
      .or('message_id.like.resend:*,message_id.like.<crm-*')
      .is('gmail_id', null)
      .eq('to_email', row.to_email)
      .eq('direction', 'outbound')
      .gte('sent_at', new Date(t - ADOPTION_WINDOW_MS).toISOString())
      .lte('sent_at', new Date(t + ADOPTION_WINDOW_MS).toISOString());
    q = row.subject === null ? q.is('subject', null) : q.eq('subject', row.subject);
    q = row.deal_id ? q.eq('deal_id', row.deal_id) : q.is('deal_id', null);
    q = row.lead_id ? q.eq('lead_id', row.lead_id) : q.is('lead_id', null);
    const { data: mirrors } = await q;
    const mirror = nearestBySentAt(mirrors ?? [], row.sent_at);
    if (mirror) {
      // The .eq('message_id', old) guard makes this a 0-row no-op if another
      // sweep adopted the mirror first; we then fall through to the plain
      // upsert, which dedups on the real Message-ID.
      const { data: adopted, error: adoptErr } = await admin.from('email_messages')
        .update({
          message_id: row.message_id, gmail_id: row.gmail_id, thread_id: row.thread_id,
          from_email: row.from_email, from_name: row.from_name,
          body_text: row.body_text, body_html: row.body_html, snippet: row.snippet,
          sent_at: row.sent_at, captured_from_user_id: row.captured_from_user_id,
          cc_emails: row.cc_emails ?? mirror.cc_emails,
        })
        .eq('id', mirror.id).eq('message_id', mirror.message_id)
        .select('id');
      if (!adoptErr && (adopted ?? []).length > 0) return true;
    }
  }
  // (c) First sighting: plain insert (races absorbed by the unique key).
  const { error } = await admin.from('email_messages')
    .upsert(row, { onConflict: 'message_id', ignoreDuplicates: true });
  return !error;
}

async function syncOneUser(uid: string): Promise<SyncResult | { skip: string }> {
  const { data: acct } = await admin.from('user_google_accounts')
    .select('refresh_token_enc, revoked_at, scopes').eq('user_id', uid).maybeSingle();
  if (!acct || acct.revoked_at) return { skip: 'not_connected' };
  if (!String(acct.scopes ?? '').includes('gmail.readonly')) return { skip: 'no_read_scope' };

  const refresh = await decryptToken(acct.refresh_token_enc, TOKEN_KEY);
  const access = await refreshAccessToken(refresh, CLIENT_ID, CLIENT_SECRET);
  if (!access) return { skip: 'token_refresh_failed' };

  const { data: shared } = await admin.from('shared_mailboxes')
    .select('user_id').eq('user_id', uid).maybeSingle();

  // Incremental once backfilled: only messages since the last run (minus overlap).
  const { data: cur } = await admin.from('user_google_sync')
    .select('last_synced_at, backfilled_at, backfill_page_token').eq('user_id', uid).maybeSingle();

  // Shared boxes backfill 90 days; staff 60 (2026-08-27: widened from 10 so a
  // filing-rule fix + backfill reset can recover previously-skipped mail —
  // the suffixed-job-code / additional-contacts gap). Both paged 200/run.
  // -in:drafts: Gmail auto-saves a draft the moment a recipient is typed, and
  // those empty no-subject drafts were being captured as real mail (2026-08-25).
  const backfillQ = shared ? 'newer_than:90d -in:drafts' : 'newer_than:60d -in:drafts';
  const backfilling = !cur?.backfilled_at || cur?.backfill_page_token;
  let q = backfillQ;
  let pageToken: string | undefined = cur?.backfill_page_token ?? undefined;
  if (!backfilling && cur?.last_synced_at) {
    const since = Math.floor(new Date(cur.last_synced_at as string).getTime() / 1000) - OVERLAP_SEC;
    q = `after:${since} -in:drafts`;
    pageToken = undefined;
  }

  const { ids, nextPageToken } = await listGmailMessageIds(access, q, 200, pageToken);
  let matched = 0, stored = 0, errors = 0;
  for (const id of ids) {
    // Isolate per-message failures so one malformed message can't abort the run.
    try {
      const m = await getGmailMessageFull(access, id);
      // Belt and braces with the -in:drafts query: never capture drafts.
      if (m.label_ids.includes('DRAFT')) continue;
      if (!m.from_email || !m.to_email) continue;
      const { data: fil } = await admin.rpc('resolve_email_filing', {
        p_from: m.from_email, p_to: m.to_email, p_subject: m.subject,
      });
      const f = Array.isArray(fil) ? fil[0] : null;
      if (!f) {
        // Inbox (2026-09-03): unknown-party inbound on ANY synced mailbox is
        // stored unfiled (all card ids null) so the RECIPIENT can file it.
        // Staff↔staff and noise senders stay dropped, as before.
        const fromLower = m.from_email.toLowerCase();
        if (/no-?reply|newsletter|mailer[-_]?daemon|postmaster/i.test(fromLower)) continue;
        const { data: staffFrom } = await admin
          .from('profiles').select('user_id').eq('email', fromLower).maybeSingle();
        if (staffFrom) continue; // our own copy / internal mail
        const ok = await storeCaptured({
          message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
          direction: 'inbound', from_email: m.from_email, from_name: m.from_name,
          to_email: m.to_email, subject: m.subject, body_text: m.body_text,
          body_html: m.body_html, snippet: m.snippet, cc_emails: m.cc_emails,
          sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
          client_id: null, deal_id: null, job_id: null, lead_id: null,
          department: null, staff_user_id: null, captured_from_user_id: uid,
        });
        if (ok) stored++; else errors++;
        continue;
      }
      matched++;
      const ok = await storeCaptured({
        message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
        direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
        subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
        cc_emails: m.cc_emails,
        sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
        client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id, department: f.department,
        staff_user_id: f.staff_user_id, captured_from_user_id: uid,
      });
      if (ok) stored++; else errors++;
      if (ok && m.bcc_emails) {
        const { data: mrow } = await admin
          .from('email_messages').select('id').eq('message_id', m.message_id).maybeSingle();
        if (mrow) {
          // Union-merge, never overwrite: every Gmail copy carries a PARTIAL
          // Bcc view (a bcc recipient's delivered copy lists only themselves),
          // so the last-swept mailbox would otherwise clobber the sender's
          // full list (found live 2026-07-13 during dept-auto-bcc rollout).
          const { data: prior } = await admin
            .from('email_message_bcc').select('bcc_emails').eq('message_pk', mrow.id).maybeSingle();
          const merged = [
            ...new Set([
              ...(prior?.bcc_emails ? String(prior.bcc_emails).split(',') : []),
              ...m.bcc_emails.split(','),
            ]),
          ].join(',');
          await admin.from('email_message_bcc').upsert(
            { message_pk: mrow.id, bcc_emails: merged },
            { onConflict: 'message_pk' },
          );
        }
      }
      if (ok && m.thread_id && f.direction === 'inbound' && (f.client_id || f.lead_id)) {
        // Automated sends (thread_id null) adopt the reply's Gmail thread so the
        // conversation folds together. Normalized-subject match, same client/lead.
        const norm = (m.subject ?? '').replace(/^((re|fwd?):\s*)+/i, '').trim().toLowerCase();
        if (norm) {
          let adopt = admin.from('email_messages')
            .update({ thread_id: m.thread_id })
            .is('thread_id', null)
            .ilike('subject', `%${norm.replace(/[%_]/g, '\\$&')}`);
          adopt = f.client_id ? adopt.eq('client_id', f.client_id) : adopt.eq('lead_id', f.lead_id);
          await adopt;
        }
      }
    } catch (_e) {
      errors++;
    }
  }
  const morePages = backfilling && !!nextPageToken;
  // During a multi-run backfill, pin last_synced_at to the backfill's START so
  // the first incremental re-covers mail that arrived mid-backfill (pages walk
  // newest→oldest; dedup absorbs the overlap). Incremental runs advance it.
  const lastSynced = backfilling
    ? ((cur?.last_synced_at as string | null) ?? new Date().toISOString())
    : new Date().toISOString();
  await admin.from('user_google_sync').upsert({
    user_id: uid,
    last_synced_at: lastSynced,
    backfilled_at: morePages ? null : ((cur?.backfilled_at as string | null) ?? new Date().toISOString()),
    backfill_page_token: morePages ? nextPageToken : null,
  });
  return { scanned: ids.length, matched, stored, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const authed = (SYNC_SECRET !== '' && timingSafeEqual(token, SYNC_SECRET)) ||
                 (SERVICE_KEY !== '' && timingSafeEqual(token, SERVICE_KEY));
  if (!authed) return json({ error: 'forbidden' }, 403);

  const body = (await req.json().catch(() => ({}))) as { user_id?: string; mode?: string };

  if (body.mode === 'sweep') {
    const { data: users } = await admin.from('user_google_accounts')
      .select('user_id').is('revoked_at', null).ilike('scopes', '%gmail.readonly%');
    const { data: cursors } = await admin.from('user_google_sync')
      .select('user_id, last_synced_at, backfilled_at, backfill_page_token');
    const cur = new Map((cursors ?? []).map((c) => [c.user_id as string, c]));
    // Incremental mailboxes are cheap and must never be starved by a paged
    // backfill (accounting@'s 90d backfill consumed whole runs 07-10..07-13);
    // sync them first (stalest first), then spend what's left on backfills.
    const backfilling = (uid: string) => {
      const c = cur.get(uid);
      return !c?.backfilled_at || !!c?.backfill_page_token;
    };
    const stamp = (uid: string) => (cur.get(uid)?.last_synced_at as string | null) ?? '';
    const ordered = ((users ?? []) as { user_id: string }[]).slice().sort((a, b) =>
      Number(backfilling(a.user_id)) - Number(backfilling(b.user_id))
      || stamp(a.user_id).localeCompare(stamp(b.user_id)));
    const agg = { users: 0, scanned: 0, matched: 0, stored: 0, errors: 0, deferred: 0 };
    const started = Date.now();
    const BUDGET_MS = 90_000; // leave headroom inside the wall limit + 2-min cadence
    for (const u of ordered) {
      if (Date.now() - started > BUDGET_MS) { agg.deferred++; continue; }
      try {
        const r = await syncOneUser(u.user_id);
        if ('skip' in r) continue;
        agg.users++; agg.scanned += r.scanned; agg.matched += r.matched; agg.stored += r.stored; agg.errors += r.errors;
      } catch (_e) {
        agg.errors++;
      }
    }
    return json({ mode: 'sweep', ...agg });
  }

  if (!body.user_id) return json({ error: 'user_id required' }, 400);
  const r = await syncOneUser(body.user_id);
  if ('skip' in r) return json({ error: r.skip }, 409);
  return json(r);
});
