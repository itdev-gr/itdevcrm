import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { verifyWebhookSignature, statusForResendEvent, readTags, campaignEventFor, routeWebhookEvent } from './verify.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const admin = createClient(URL, SERVICE_KEY);
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Visibility only (review fix I-2) — never throws, never changes the
 *  response. Mirrors send-campaign/index.ts's logDbError so a failing
 *  campaign-side write is loud instead of silent. */
function logDbError(context: string, error: { message: string } | null): void {
  if (error) console.error(`resend-webhook: DB WRITE FAILED (${context}): ${error.message}`);
}

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
  // over when routeWebhookEvent() (verify.ts) — the single tested routing
  // decision — says this event demonstrably belongs to a campaign send:
  // either the Resend tags identify it directly (mkt=1 + recipient id), or —
  // when no usable tags are present — the email_id matches a row we already
  // recorded resend_id for. Anything that matches neither falls straight
  // through, unchanged, to the pre-existing email_log path further down.
  //
  // Review fix I-1: the whole block is wrapped in try/catch. ANY throw here
  // (including one we can't rule out from the jsr: supabase-js dependency)
  // must fall through to the untouched transactional path below rather than
  // risk losing the only record of a transactional email's delivery/bounce.
  try {
    const tags = readTags(evt.data);
    const tagRecipientId = tags.mkt === '1' && tags.recipient ? tags.recipient : null;

    let matchedRecipientId: string | null = null;
    if (!tagRecipientId && emailId) {
      const { data: row, error } = await admin
        .from('email_campaign_recipients')
        .select('id')
        .eq('resend_id', emailId)
        .maybeSingle();
      logDbError(`lookup email_campaign_recipients by resend_id=${emailId}`, error); // I-2
      matchedRecipientId = row?.id ?? null;
    }

    if (routeWebhookEvent(tags, matchedRecipientId) === 'campaign') {
      const campaignRecipientId = tagRecipientId ?? matchedRecipientId!;
      const campaignMapped = campaignEventFor(eventType);
      if (campaignMapped) {
        const bounceType = campaignMapped.stamp === 'bounced_at' ? evt.data?.bounce?.type : undefined;
        const campaignPatch: Record<string, unknown> = { [campaignMapped.stamp]: new Date().toISOString() };
        if (bounceType) campaignPatch.bounce_type = bounceType;

        const { data: updatedRecipient, error: updateError } = await admin
          .from('email_campaign_recipients')
          .update(campaignPatch)
          .eq('id', campaignRecipientId)
          .select('email_lower, campaign_id')
          .maybeSingle();
        logDbError(`update email_campaign_recipients id=${campaignRecipientId} (${campaignMapped.stamp})`, updateError); // I-2

        if (updatedRecipient) {
          const isPermanentBounce = campaignMapped.stamp === 'bounced_at' && bounceType === 'Permanent';
          const isComplaint = campaignMapped.stamp === 'complained_at';
          if (isPermanentBounce || isComplaint) {
            const { error: suppressError } = await admin.rpc('suppress_email', {
              p_email: updatedRecipient.email_lower,
              p_reason: isComplaint ? 'complaint' : 'hard_bounce',
              p_source: `campaign:${updatedRecipient.campaign_id}`,
            });
            logDbError(`suppress_email(${updatedRecipient.email_lower})`, suppressError); // I-2
          }
        }
      }
      // Campaign event handled (or intentionally ignored, e.g. email.sent) —
      // never fall through to the email_log path below.
      return json({ ok: true });
    }
  } catch (err) {
    console.error(
      `resend-webhook: campaign attribution threw, falling back to the transactional path: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Existing transactional path (byte-identical, unchanged) -------------
  const mapped = eventType ? statusForResendEvent(eventType) : null;
  if (!mapped || !emailId) return json({ ok: true, ignored: true });

  const patch: Record<string, unknown> = { status: mapped.status };
  if (mapped.stamp) patch[mapped.stamp] = new Date().toISOString();
  await admin.from('email_log').update(patch).eq('resend_id', emailId);
  return json({ ok: true });
});
