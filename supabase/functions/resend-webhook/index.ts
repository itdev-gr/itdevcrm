import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { verifyWebhookSignature, statusForResendEvent } from './verify.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const admin = createClient(URL, SERVICE_KEY);
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!URL || !SERVICE_KEY || !SECRET) return json({ error: 'misconfigured' }, 500);

  const payload = await req.text();
  const ok = await verifyWebhookSignature({
    secret: SECRET,
    msgId: req.headers.get('svix-id') ?? req.headers.get('webhook-id') ?? '',
    timestamp: req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp') ?? '',
    signatureHeader: req.headers.get('svix-signature') ?? req.headers.get('webhook-signature') ?? '',
    payload,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return json({ error: 'invalid signature' }, 401);

  const evt = JSON.parse(payload) as { type?: string; data?: { email_id?: string } };
  const mapped = evt.type ? statusForResendEvent(evt.type) : null;
  const emailId = evt.data?.email_id;
  if (!mapped || !emailId) return json({ ok: true, ignored: true });

  const patch: Record<string, unknown> = { status: mapped.status };
  if (mapped.stamp) patch[mapped.stamp] = new Date().toISOString();
  await admin.from('email_log').update(patch).eq('resend_id', emailId);
  return json({ ok: true });
});
