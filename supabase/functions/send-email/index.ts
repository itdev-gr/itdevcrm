// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { IDENTITIES, type Identity } from './identities.ts';
import { renderTemplate } from './templates.ts';
import { decryptToken, refreshAccessToken, buildMime, sendGmail } from '../_shared/google.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const DRY_RUN = (Deno.env.get('EMAIL_DRY_RUN') ?? 'false').toLowerCase() === 'true';
const G_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const G_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const G_TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY') ?? '';
const DRAIN_SECRET = Deno.env.get('EMAIL_DRAIN_SECRET') ?? '';

const admin = createClient(URL, SERVICE_KEY);

type SendInput = {
  identity: Identity;
  to: string;
  templateKey: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  dryRun?: boolean;
};

async function sendOne(input: SendInput): Promise<{ status: 'sent' | 'failed' | 'skipped'; resendId?: string; error?: string }> {
  const { identity, to, templateKey, data = {}, dedupeKey = null } = input;
  // Idempotency: never send the same dedupe_key twice.
  if (dedupeKey) {
    const { data: prior } = await admin
      .from('email_log').select('id').eq('dedupe_key', dedupeKey).eq('status', 'sent').limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  const id = IDENTITIES[identity];
  if (!id) return { status: 'failed', error: `unknown identity ${identity}` };

  let rendered;
  try {
    rendered = renderTemplate(templateKey, data);
  } catch (e) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error: String(e) });
    return { status: 'failed', error: String(e) };
  }

  const dry = input.dryRun || DRY_RUN;
  if (dry) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: 'dry-run', dedupe_key: dedupeKey });
    return { status: 'sent', resendId: 'dry-run' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: id.from, reply_to: id.replyTo, to, subject: rendered.subject, html: rendered.html, text: rendered.text }),
  });
  if (!res.ok) {
    const error = await res.text();
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error });
    return { status: 'failed', error };
  }
  const body = await res.json().catch(() => ({}));
  await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: body.id ?? null, dedupe_key: dedupeKey });
  return { status: 'sent', resendId: body.id };
}

async function drain(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: rows } = await admin
    .from('email_outbox').select('*').eq('status', 'pending').lt('attempts', 5)
    .order('created_at', { ascending: true }).limit(50);
  let sent = 0, failed = 0;
  for (const r of rows ?? []) {
    const result = await sendOne({ identity: r.identity, to: r.to_email, templateKey: r.template_key, data: r.data, dedupeKey: r.dedupe_key });
    if (result.status === 'failed') {
      failed++;
      await admin.from('email_outbox').update({ attempts: r.attempts + 1, last_error: result.error ?? null }).eq('id', r.id);
    } else {
      sent++;
      await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq('id', r.id);
    }
  }
  return { processed: (rows ?? []).length, sent, failed };
}

async function sendPersonal(uid: string, to: string, data: Record<string, unknown>, dedupeKey: string | null): Promise<{ status: 'sent' | 'failed' | 'skipped' | 'not_connected'; id?: string; error?: string }> {
  if (dedupeKey) {
    const { data: prior } = await admin.from('email_log').select('id').eq('dedupe_key', dedupeKey).eq('status', 'sent').limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  const { data: acct } = await admin.from('user_google_accounts').select('google_email, refresh_token_enc, revoked_at').eq('user_id', uid).maybeSingle();
  if (!acct || acct.revoked_at) return { status: 'not_connected' };

  const subject = String(data.subject ?? '');
  const html = String(data.html ?? '');
  if (DRY_RUN) {
    await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: 'sent', resend_id: 'dry-run', dedupe_key: dedupeKey });
    return { status: 'sent', id: 'dry-run' };
  }
  const refresh = await decryptToken(acct.refresh_token_enc, G_TOKEN_KEY);
  const access = await refreshAccessToken(refresh, G_CLIENT_ID, G_CLIENT_SECRET);
  if (!access) {
    await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: 'failed', dedupe_key: dedupeKey, error: 'token_refresh_failed' });
    return { status: 'failed', error: 'token_refresh_failed' };
  }
  const raw = buildMime({ from: acct.google_email, to, subject, html });
  const res = await sendGmail(access, raw);
  await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: res.ok ? 'sent' : 'failed', resend_id: res.id ?? null, dedupe_key: dedupeKey, error: res.ok ? null : res.error });
  return res.ok ? { status: 'sent', id: res.id } : { status: 'failed', error: res.error };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === SERVICE_KEY || (DRAIN_SECRET !== '' && token === DRAIN_SECRET);

  const body = (await req.json().catch(() => null)) as (SendInput & { drain?: boolean }) | null;
  if (!body) return json({ error: 'Bad request' }, 400);

  // Drain mode: service role only (the cron pulse).
  if (body.drain) {
    if (!isServiceRole) return json({ error: 'Forbidden' }, 403);
    return json(await drain());
  }

  // Personal send: send as the connected user via Gmail (requires a user JWT).
  if ((body.identity as string) === 'personal') {
    if (isServiceRole) return json({ error: 'personal requires a user' }, 400);
    const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const r = await sendPersonal(u.user.id, body.to, body.data ?? {}, body.dedupeKey ?? null);
    if (r.status === 'not_connected') return json({ status: 'not_connected' }, 409);
    return json({ status: r.status, id: r.id, error: r.error }, r.status === 'failed' ? 502 : 200);
  }

  // Single-send mode: allow service role OR an authenticated admin/staff user.
  if (!isServiceRole) {
    const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);
    // Any authenticated staff member may send; tighten to admin if desired.
  }
  if (!body.identity || !body.to || !body.templateKey) return json({ error: 'Missing identity/to/templateKey' }, 400);
  const result = await sendOne(body);
  return json(result, result.status === 'failed' ? 502 : 200);
});
