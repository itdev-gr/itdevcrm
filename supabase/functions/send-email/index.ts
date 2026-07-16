// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { IDENTITIES, type Identity } from './identities.ts';
import { renderTemplate, renderDbTemplate, LOGO_URL } from './templates.ts';
import { renderSignatureHtml } from '../_shared/signature.ts';
import { validateAttachmentRefs, fetchAttachments, type AttachmentRef, type ResendAttachment } from './attachments.ts';
import { decryptToken, refreshAccessToken, buildMime, sendGmail } from '../_shared/google.ts';
import { timingSafeEqual } from '../_shared/timing.ts';
import { parseRecipientList, deptBccFor } from '../_shared/recipients.ts';

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
  attachments?: AttachmentRef[];
  cc?: string[] | string;
  bcc?: string[] | string;
};

async function sendOne(input: SendInput): Promise<{ status: 'sent' | 'failed' | 'skipped'; resendId?: string; error?: string }> {
  const { identity, to, templateKey, data = {}, dedupeKey = null } = input;
  const userCc = parseRecipientList(input.cc) ?? [];
  const userBcc = parseRecipientList(input.bcc) ?? [];
  // Idempotency: never send the same dedupe_key twice. Check every already-
  // attempted-delivery state, not just 'sent' — the Resend webhook flips a
  // freshly-sent log row to 'delivered' (or 'bounced'/'complained') within
  // seconds, so a crash-window re-send from the 5-min stale-claim recovery
  // must still see it as done. (Matches the reconciler's status set.)
  if (dedupeKey) {
    const { data: prior } = await admin
      .from('email_log').select('id').eq('dedupe_key', dedupeKey)
      .in('status', ['sent', 'delivered', 'bounced', 'complained']).limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  // Closed-client guard: never email a client whose engagement is finished.
  // `internal` identity goes to staff distribution lists, not client mailboxes,
  // so it stays exempt. Anything else that matches a `done` client is skipped
  // and logged so admins can see it in Email Health.
  if (identity !== 'internal' && typeof to === 'string' && to) {
    const { data: closed } = await admin
      .from('clients')
      .select('id')
      .eq('status', 'done')
      .ilike('email', to)
      .limit(1);
    if (closed && closed.length > 0) {
      await admin.from('email_log').insert({
        identity, to_email: to, template_key: templateKey, status: 'failed',
        dedupe_key: dedupeKey, error: 'blocked: client closed (status=done)',
      });
      return { status: 'skipped' };
    }
  }
  const id = IDENTITIES[identity];
  if (!id) return { status: 'failed', error: `unknown identity ${identity}` };

  // Department routing: technical onboarding emails are SENT FROM support@ and
  // copied to support@; other accounting-identity emails copy accounting@.
  let cc: string | undefined;
  let fromOverride: string | undefined;
  let replyToOverride: string | undefined;
  if (templateKey === 'webseo_gsc_access' || templateKey === 'localseo_gbp_access') {
    fromOverride = 'ITDEV Support <support@itdev.gr>';
    replyToOverride = 'support@itdev.gr';
    cc = 'support@itdev.gr';
  } else if (identity === 'accounting') {
    cc = 'accounting@itdev.gr';
  } else if (
    [
      'lead_welcome',
      'noanswer_day0', 'noanswer_day2', 'noanswer_day5', 'noanswer_day10',
      'offer_followup_day2', 'offer_followup_day5', 'offer_followup_day10',
      'reengage_90d',
      'scheduled_confirm', 'scheduled_reminder', 'scheduled_noshow',
    ].includes(templateKey) &&
    typeof data.owner_email === 'string' &&
    data.owner_email
  ) {
    // Sales emails: CC the lead's assigned rep (if one is set).
    cc = data.owner_email;
  }

  let rendered;
  // Hoisted so the success branch can read `client_facing` when deciding
  // whether to mirror the send into the captured-email threads.
  let dbTpl: { subject: string; body: string; client_facing: boolean } | null = null;
  try {
    // Admin-edited templates take precedence; built-ins are the fallback
    // (and the only path for `custom` / internal_* keys without a row).
    const { data: dbRow } = await admin
      .from('email_templates')
      .select('subject, body, client_facing')
      .eq('key', templateKey)
      .maybeSingle();
    dbTpl = dbRow;
    rendered = dbTpl ? renderDbTemplate(dbTpl, data) : renderTemplate(templateKey, data);
  } catch (e) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error: String(e) });
    return { status: 'failed', error: String(e) };
  }

  const dry = input.dryRun || DRY_RUN;
  if (dry) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: 'dry-run', dedupe_key: dedupeKey });
    return { status: 'sent', resendId: 'dry-run' };
  }

  let attachments: ResendAttachment[] = [];
  if (input.attachments && input.attachments.length > 0) {
    try {
      attachments = await fetchAttachments(admin.storage, validateAttachmentRefs(input.attachments));
    } catch (e) {
      await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error: String(e) });
      return { status: 'failed', error: String(e) };
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromOverride ?? id.from, reply_to: replyToOverride ?? id.replyTo, to,
      ...((cc || userCc.length > 0)
        ? { cc: [...(cc ? [cc] : []), ...userCc] }
        : {}),
      ...(userBcc.length > 0 ? { bcc: userBcc } : {}),
      subject: rendered.subject, html: rendered.html, text: rendered.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error });
    return { status: 'failed', error };
  }
  const body = await res.json().catch(() => ({}));
  await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: body.id ?? null, dedupe_key: dedupeKey });

  // Mirror client-facing sends into the captured-email threads (spec 07-10):
  // filing decides ownership; unknown parties are skipped, errors never
  // affect the send result.
  if (identity !== 'internal' && dbTpl?.client_facing !== false) {
    try {
      const fromEmail = (fromOverride ?? id.from).replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase();
      const { data: fil } = await admin.rpc('resolve_email_filing', {
        p_from: fromEmail, p_to: to, p_subject: rendered.subject,
      });
      const f = Array.isArray(fil) ? fil[0] : null;
      if (f) {
        const mirrorMessageId = `resend:${body.id ?? crypto.randomUUID()}`;
        await admin.from('email_messages').upsert({
          message_id: mirrorMessageId,
          direction: 'outbound', from_email: fromEmail, from_name: 'ITDEV (automated)',
          to_email: to, subject: rendered.subject, body_text: rendered.text ?? null,
          sent_at: new Date().toISOString(),
          client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id,
          department: f.department, staff_user_id: f.staff_user_id,
          cc_emails: [...(cc ? [cc.toLowerCase()] : []), ...userCc].join(',') || null,
        }, { onConflict: 'message_id', ignoreDuplicates: true });
        if (userBcc.length > 0) {
          const { data: mrow } = await admin
            .from('email_messages')
            .select('id')
            .eq('message_id', mirrorMessageId)
            .maybeSingle();
          if (mrow) {
            await admin.from('email_message_bcc').upsert(
              { message_pk: mrow.id, bcc_emails: userBcc.join(',') },
              { onConflict: 'message_pk' },
            );
          }
        }
      }
    } catch (_e) { /* thread mirroring must never fail a send */ }
  }

  return { status: 'sent', resendId: body.id };
}

async function drain(): Promise<{ processed: number; sent: number; failed: number }> {
  // Recover any rows a prior drain claimed but never finished (e.g. crash mid-send).
  await admin.rpc('recover_stale_email_claims');
  // Atomically claim pending rows (status -> 'sending', FOR UPDATE SKIP LOCKED) so the
  // instant-send pulse and the cron can drain concurrently without double-sending.
  const { data: rows } = await admin.rpc('claim_email_outbox', { p_limit: 50 });
  let sent = 0, failed = 0;
  for (const r of (rows ?? []) as any[]) {
    const result = await sendOne({ identity: r.identity, to: r.to_email, templateKey: r.template_key, data: r.data, dedupeKey: r.dedupe_key });
    if (result.status === 'failed') {
      failed++;
      // Release back to 'pending' for retry (attempts was already incremented at claim time).
      await admin.from('email_outbox').update({ status: 'pending', last_error: result.error ?? null }).eq('id', r.id);
    } else {
      // 'sent' or 'skipped' (already-sent dedupe) both leave the queue as sent.
      sent++;
      await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
    }
  }
  const nowIso = new Date().toISOString();
  await admin.from('email_drain_heartbeat').upsert({
    id: true,
    last_run_at: nowIso,
    last_ok_at: nowIso,
    processed: (rows ?? []).length,
    sent,
    failed,
    updated_at: nowIso,
  });
  return { processed: (rows ?? []).length, sent, failed };
}

async function sendPersonal(uid: string, to: string, data: Record<string, unknown>, dedupeKey: string | null, cc: string[] = [], bcc: string[] = []): Promise<{ status: 'sent' | 'failed' | 'skipped' | 'not_connected'; id?: string; error?: string }> {
  // Reject header injection / malformed recipients before building the MIME message.
  if (/[\r\n]/.test(to) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { status: 'failed', error: 'invalid_recipient' };
  }
  if (dedupeKey) {
    const { data: prior } = await admin.from('email_log').select('id').eq('dedupe_key', dedupeKey).eq('status', 'sent').limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  const { data: acct } = await admin.from('user_google_accounts').select('google_email, refresh_token_enc, revoked_at').eq('user_id', uid).maybeSingle();
  if (!acct || acct.revoked_at) return { status: 'not_connected' };

  // Department archive copy (owner rule 2026-07-13): every personal send is
  // Bcc'd to the sender's department box(es) — Sales→sales@, Accounting→
  // accounting@, Technical→support@. Appended AFTER the caller-bcc admin gate
  // (system copy applies to every sender); deduped against To/Cc so a mail
  // addressed to the box isn't double-delivered.
  const { data: grps } = await admin
    .from('user_groups')
    .select('groups(parent_label)')
    .eq('user_id', uid);
  // The one-to-one FK embed returns `groups` as a single object at runtime, but
  // the generated PostgREST types widen it to an array — normalise both shapes.
  type GroupRow = { parent_label: string | null };
  const labels = ((grps ?? []) as { groups: GroupRow | GroupRow[] | null }[])
    .flatMap((g) => (Array.isArray(g.groups) ? g.groups : g.groups ? [g.groups] : []))
    .map((gr) => gr.parent_label)
    .filter((l): l is string => !!l);
  const visible = new Set([to.toLowerCase(), ...cc.map((c) => c.toLowerCase())]);
  const mergedBcc = [...bcc];
  for (const box of deptBccFor(labels)) {
    if (!visible.has(box) && !mergedBcc.includes(box)) mergedBcc.push(box);
  }

  const subject = String(data.subject ?? '');
  // Personal signature: same fixed layout for everyone, person fields from
  // the sender's profile (owner decision 2026-07-13). Fallbacks keep sends
  // working for a profile with gaps.
  const { data: prof } = await admin
    .from('profiles')
    .select('full_name, job_title, phone, email, avatar_url')
    .eq('user_id', uid)
    .maybeSingle();
  // Photo slot: the user's uploaded avatar when it's a real https URL,
  // else the IT DEV logo (spec: profile-photo-signature).
  const avatar =
    typeof prof?.avatar_url === 'string' && prof.avatar_url.startsWith('https://')
      ? prof.avatar_url
      : null;
  const sig = renderSignatureHtml(avatar ?? LOGO_URL, {
    name: (prof?.full_name ?? '').trim() || acct.google_email,
    title: prof?.job_title ?? null,
    phone: prof?.phone ?? null,
    email: (prof?.email ?? '').trim() || acct.google_email,
  });
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">${String(data.html ?? '')}</div>${sig}`;
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
  const raw = buildMime({ from: acct.google_email, to, subject, html, cc, bcc: mergedBcc });
  const res = await sendGmail(access, raw);
  // Keep the raw Gmail error in email_log for debugging; return a generic code to the client.
  await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: res.ok ? 'sent' : 'failed', resend_id: res.id ?? null, dedupe_key: dedupeKey, error: res.ok ? null : res.error });
  return res.ok ? { status: 'sent', id: res.id } : { status: 'failed', error: 'send_failed' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  // Constant-time compare; guard against empty token matching an unset secret.
  const isServiceRole =
    (token !== '' && timingSafeEqual(token, SERVICE_KEY)) ||
    (DRAIN_SECRET !== '' && timingSafeEqual(token, DRAIN_SECRET));

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
    const cc = parseRecipientList(body.cc);
    const bcc = parseRecipientList(body.bcc);
    if (cc === null || bcc === null) return json({ error: 'invalid_recipient' }, 400);
    if (bcc.length > 0) {
      const { data: prof } = await admin.from('profiles').select('is_admin').eq('user_id', u.user.id).maybeSingle();
      if (!prof?.is_admin) return json({ error: 'bcc_admin_only' }, 403);
    }
    const r = await sendPersonal(u.user.id, body.to, body.data ?? {}, body.dedupeKey ?? null, cc, bcc);
    if (r.status === 'not_connected') return json({ status: 'not_connected' }, 409);
    return json({ status: r.status, id: r.id, error: r.error }, r.status === 'failed' ? 502 : 200);
  }

  // Single-send mode: allow service role OR an authenticated staff user.
  if (!body.identity || !body.to || !body.templateKey) return json({ error: 'Missing identity/to/templateKey' }, 400);
  if (!isServiceRole) {
    const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    // Reject header injection / multi-recipient fan-out on caller-supplied recipients.
    if (/[\r\n,;]/.test(body.to) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.to)) {
      return json({ error: 'invalid_recipient' }, 400);
    }

    // cc/bcc are compose-time fields: honored only on ad-hoc `custom` sends.
    if (String(body.templateKey) !== 'custom' && (body.cc || body.bcc)) {
      return json({ error: 'invalid_recipient' }, 400);
    }
    const ccList = parseRecipientList(body.cc);
    const bccList = parseRecipientList(body.bcc);
    if (ccList === null || bccList === null) return json({ error: 'invalid_recipient' }, 400);
    if (bccList.length > 0) {
      const { data: bccProf } = await admin.from('profiles').select('is_admin').eq('user_id', uid).maybeSingle();
      if (!bccProf?.is_admin) return json({ error: 'bcc_admin_only' }, 403);
    }
    body.cc = ccList;
    body.bcc = bccList;

    // Ad-hoc `custom` composition: lock the sending identity to the caller's own
    // department so a rep can't compose mail as another team. Admins may use any
    // identity; system templates (contract / seo-access / payment) keep their fixed
    // identity because their content comes from escaped DB/built-in templates.
    if (String(body.templateKey) === 'custom') {
      const { data: prof } = await admin.from('profiles').select('is_admin').eq('user_id', uid).maybeSingle();
      if (!prof?.is_admin) {
        const { data: grps } = await admin.from('user_groups').select('groups(code)').eq('user_id', uid);
        const codes = new Set(((grps ?? []) as any[]).map((g) => g.groups?.code).filter(Boolean));
        const allowed = new Set<string>(['internal']);
        if (codes.has('sales')) allowed.add('sales');
        if (codes.has('accounting')) allowed.add('accounting');
        if (!allowed.has(String(body.identity))) {
          return json({ error: 'identity_not_allowed' }, 403);
        }
      }
    }
  }
  const result = await sendOne(body);
  return json(result, result.status === 'failed' ? 502 : 200);
});
