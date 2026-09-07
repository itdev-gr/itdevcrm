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

// --- Campaign attribution (Task 6) ------------------------------------------
// Additive only: the two functions above are the existing transactional path
// and are untouched. Everything below is new, used only by the campaign
// branch in index.ts, and must never throw — a throw here must not be able
// to take down the transactional email_log fallback that runs after it.

/** Resend has shipped tags in two shapes over time: an array of
 *  `{name, value}` pairs, and a plain object map `{name: value}`. Accept
 *  both and flatten to a simple record. Anything else — null, a string, a
 *  number, an array of malformed entries — returns `{}` rather than
 *  throwing, so a malformed/unexpected payload never breaks the webhook. */
export function readTags(data: unknown): Record<string, string> {
  try {
    if (data === null || typeof data !== 'object') return {};
    const tags = (data as { tags?: unknown }).tags;
    if (tags === null || tags === undefined) return {};

    const out: Record<string, string> = {};

    if (Array.isArray(tags)) {
      for (const entry of tags) {
        if (entry === null || typeof entry !== 'object') continue;
        const { name, value } = entry as { name?: unknown; value?: unknown };
        if (typeof name === 'string' && typeof value === 'string') out[name] = value;
      }
      return out;
    }

    if (typeof tags === 'object') {
      for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
      }
      return out;
    }

    return {};
  } catch {
    return {};
  }
}

/** Map a Resend event type to the campaign-recipient stamp column it fills.
 *  Only the three events that Phase 1 handles map to something — everything
 *  else (including `email.opened` / `email.clicked`, which arrive in Phase 2)
 *  returns null so it is ignored rather than half-handled. */
export function campaignEventFor(
  eventType: string,
): { stamp: 'delivered_at' | 'bounced_at' | 'complained_at' } | null {
  switch (eventType) {
    case 'email.delivered': return { stamp: 'delivered_at' };
    case 'email.bounced': return { stamp: 'bounced_at' };
    case 'email.complained': return { stamp: 'complained_at' };
    default: return null;
  }
}
