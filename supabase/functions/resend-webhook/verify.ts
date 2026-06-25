// Standard-webhooks (Svix) HMAC verification — the same scheme Resend uses.
// Mirrors supabase/functions/auth-email/hook.ts; kept local so the function is
// self-contained and the mapping below is unit-testable in Node/vitest.
const encoder = new TextEncoder();
function base64Decode(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const TOLERANCE_SECONDS = 300;

export async function verifyWebhookSignature(args: {
  secret: string; msgId: string; timestamp: string; signatureHeader: string; payload: string; nowSeconds: number;
}): Promise<boolean> {
  const { secret, msgId, timestamp, signatureHeader, payload, nowSeconds } = args;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const rawSecret = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', base64Decode(rawSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  } catch { return false; }
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${msgId}.${timestamp}.${payload}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signatureHeader.split(' ').some((entry) => {
    const [version, candidate] = entry.split(',');
    return version === 'v1' && !!candidate && timingSafeEqual(candidate, expected);
  });
}

/** Map a Resend event type to an email_log status update (or null = ignore). */
export function statusForResendEvent(eventType: string): { status: string; stamp?: 'delivered_at' | 'bounced_at' } | null {
  switch (eventType) {
    case 'email.delivered': return { status: 'delivered', stamp: 'delivered_at' };
    case 'email.bounced': return { status: 'bounced', stamp: 'bounced_at' };
    case 'email.complained': return { status: 'complained' };
    default: return null; // email.sent / opened / clicked / delivery_delayed — ignore
  }
}
