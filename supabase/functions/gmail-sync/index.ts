// supabase/functions/gmail-sync/index.ts
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!SYNC_SECRET || !timingSafeEqual(token, SYNC_SECRET)) return json({ error: 'forbidden' }, 403);

  const body = (await req.json().catch(() => ({}))) as { user_id?: string; mode?: string };
  if (!body.user_id) return json({ error: 'user_id required' }, 400);

  const { data: acct } = await admin.from('user_google_accounts')
    .select('refresh_token_enc, revoked_at, scopes').eq('user_id', body.user_id).maybeSingle();
  if (!acct || acct.revoked_at) return json({ error: 'not_connected' }, 409);
  if (!String(acct.scopes ?? '').includes('gmail.readonly')) return json({ error: 'no_read_scope' }, 409);

  const refresh = await decryptToken(acct.refresh_token_enc, TOKEN_KEY);
  const access = await refreshAccessToken(refresh, CLIENT_ID, CLIENT_SECRET);
  if (!access) return json({ error: 'token_refresh_failed' }, 502);

  const ids = await listGmailMessageIds(access, 'newer_than:10d', 200);
  let matched = 0, stored = 0;
  for (const id of ids) {
    const m = await getGmailMessageFull(access, id);
    if (!m.from_email || !m.to_email) continue;
    const { data: fil } = await admin.rpc('resolve_email_filing', {
      p_from: m.from_email, p_to: m.to_email, p_subject: m.subject,
    });
    const f = Array.isArray(fil) ? fil[0] : null;
    if (!f) continue;               // not a staff<->client email
    matched++;
    const { error } = await admin.from('email_messages').upsert({
      message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
      direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
      subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
      sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
      client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, department: f.department,
      staff_user_id: f.staff_user_id, captured_from_user_id: body.user_id,
    }, { onConflict: 'message_id', ignoreDuplicates: true });
    if (!error) stored++;
  }
  await admin.from('user_google_sync').upsert({
    user_id: body.user_id, last_synced_at: new Date().toISOString(), backfilled_at: new Date().toISOString(),
  });
  return json({ scanned: ids.length, matched, stored });
});
