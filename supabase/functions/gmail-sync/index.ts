// gmail-sync: pull each connected user's client email into email_messages.
// Modes:
//   { user_id } .............. sync one user (backfill on first run, else incremental)
//   { mode: 'sweep' } ........ sync every read-scoped user (called by pg_cron every 5 min)
// Auth: Bearer GMAIL_SYNC_SECRET (manual) OR the service-role key (the cron).
// verify_jwt=false (config.toml) so the cron's header-only call reaches it.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { decryptToken, refreshAccessToken, listGmailMessageIds, getGmailMessageFull } from '../_shared/google.ts';
import { timingSafeEqual } from '../_shared/timing.ts';

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

  // Shared boxes backfill 90 days, paged 200/run; staff keep the single-run 10d.
  const backfillQ = shared ? 'newer_than:90d' : 'newer_than:10d';
  const backfilling = !cur?.backfilled_at || cur?.backfill_page_token;
  let q = backfillQ;
  let pageToken: string | undefined = cur?.backfill_page_token ?? undefined;
  if (!backfilling && cur?.last_synced_at) {
    const since = Math.floor(new Date(cur.last_synced_at as string).getTime() / 1000) - OVERLAP_SEC;
    q = `after:${since}`;
    pageToken = undefined;
  }

  const { ids, nextPageToken } = await listGmailMessageIds(access, q, 200, pageToken);
  let matched = 0, stored = 0, errors = 0;
  for (const id of ids) {
    // Isolate per-message failures so one malformed message can't abort the run.
    try {
      const m = await getGmailMessageFull(access, id);
      if (!m.from_email || !m.to_email) continue;
      const { data: fil } = await admin.rpc('resolve_email_filing', {
        p_from: m.from_email, p_to: m.to_email, p_subject: m.subject,
      });
      const f = Array.isArray(fil) ? fil[0] : null;
      if (!f) continue;
      matched++;
      const { error } = await admin.from('email_messages').upsert({
        message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
        direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
        subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
        sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
        client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id, department: f.department,
        staff_user_id: f.staff_user_id, captured_from_user_id: uid,
      }, { onConflict: 'message_id', ignoreDuplicates: true });
      if (!error) stored++; else errors++;
      if (!error && m.thread_id && f.direction === 'inbound' && (f.client_id || f.lead_id)) {
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
