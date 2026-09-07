import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { verifyWebhookSignature, statusForResendEvent, readTags, campaignEventFor } from './verify.ts';

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

  const evt = JSON.parse(payload) as {
    type?: string;
    data?: { email_id?: string; bounce?: { type?: string }; tags?: unknown };
  };
  const eventType = evt.type ?? '';
  const emailId = evt.data?.email_id;

  // --- Campaign attribution (Task 6) ----------------------------------------
  // Runs BEFORE the existing transactional logic below, and only ever takes
  // over when the event demonstrably belongs to a campaign send: either the
  // Resend tags identify it directly (mkt=1 + recipient id), or — when no
  // usable tags are present — the email_id matches a row we already recorded
  // resend_id for. Anything that matches neither falls straight through,
  // unchanged, to the pre-existing email_log path further down.
  const tags = readTags(evt.data);
  let campaignRecipientId: string | null = null;
  if (tags.mkt === '1' && tags.recipient) {
    campaignRecipientId = tags.recipient;
  } else if (emailId) {
    const { data: row } = await admin
      .from('email_campaign_recipients')
      .select('id')
      .eq('resend_id', emailId)
      .maybeSingle();
    campaignRecipientId = row?.id ?? null;
  }

  if (campaignRecipientId) {
    const campaignMapped = campaignEventFor(eventType);
    if (campaignMapped) {
      const bounceType = campaignMapped.stamp === 'bounced_at' ? evt.data?.bounce?.type : undefined;
      const campaignPatch: Record<string, unknown> = { [campaignMapped.stamp]: new Date().toISOString() };
      if (bounceType) campaignPatch.bounce_type = bounceType;

      const { data: updatedRecipient } = await admin
        .from('email_campaign_recipients')
        .update(campaignPatch)
        .eq('id', campaignRecipientId)
        .select('email_lower, campaign_id')
        .maybeSingle();

      if (updatedRecipient) {
        const isPermanentBounce = campaignMapped.stamp === 'bounced_at' && bounceType === 'Permanent';
        const isComplaint = campaignMapped.stamp === 'complained_at';
        if (isPermanentBounce || isComplaint) {
          await admin.rpc('suppress_email', {
            p_email: updatedRecipient.email_lower,
            p_reason: isComplaint ? 'complaint' : 'hard_bounce',
            p_source: `campaign:${updatedRecipient.campaign_id}`,
          });
        }
      }
    }
    // Campaign event handled (or intentionally ignored, e.g. email.sent) —
    // never fall through to the email_log path below.
    return json({ ok: true });
  }

  // --- Existing transactional path (byte-identical, unchanged) -------------
  const mapped = eventType ? statusForResendEvent(eventType) : null;
  if (!mapped || !emailId) return json({ ok: true, ignored: true });

  const patch: Record<string, unknown> = { status: mapped.status };
  if (mapped.stamp) patch[mapped.stamp] = new Date().toISOString();
  await admin.from('email_log').update(patch).eq('resend_id', emailId);
  return json({ ok: true });
});
