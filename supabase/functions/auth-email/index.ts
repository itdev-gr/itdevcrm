// Supabase Auth "send email" hook receiver. Auth POSTs here (signed,
// standard-webhooks) instead of emailing the user itself; we deliver via the
// send-email function so templates, identities, and email_log stay unified.
// Deployed with --no-verify-jwt: callers authenticate via webhook signature.
import { verifyWebhookSignature, buildRecoveryEmail, type SendEmailHookPayload } from './hook.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !HOOK_SECRET) return json({ error: 'Server misconfigured' }, 500);

  const payloadText = await req.text();
  const ok = await verifyWebhookSignature({
    secret: HOOK_SECRET,
    msgId: req.headers.get('webhook-id') ?? '',
    timestamp: req.headers.get('webhook-timestamp') ?? '',
    signatureHeader: req.headers.get('webhook-signature') ?? '',
    payload: payloadText,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(payloadText) as SendEmailHookPayload;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const email = buildRecoveryEmail(payload, SUPABASE_URL);
  if (!email) {
    // Only recovery is wired; never log the payload (it carries the token).
    const action = payload.email_data?.email_action_type;
    if (action === 'recovery') {
      console.warn('auth-email: recovery payload missing required fields');
    } else {
      console.warn('auth-email: unhandled email_action_type', action);
    }
    return json({ skipped: true });
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: 'internal',
      to: email.to,
      templateKey: email.templateKey,
      data: email.data,
    }),
  });
  const result = (await res.json().catch(() => ({}))) as { status?: string };
  if (!res.ok || result.status === 'failed') return json({ error: 'send_failed' }, 500);
  return json({ sent: true });
});
