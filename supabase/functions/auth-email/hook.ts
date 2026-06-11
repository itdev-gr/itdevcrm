// Pure logic for the Supabase Auth "send email" hook: standard-webhooks
// signature verification and recovery-email construction. No Deno.serve or
// Deno.env here so Vitest (Node) can cover it.

const encoder = new TextEncoder();

function base64Decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TOLERANCE_SECONDS = 300;

export async function verifyWebhookSignature(args: {
  secret: string; // dashboard format: "v1,whsec_<base64>"
  msgId: string; // webhook-id header
  timestamp: string; // webhook-timestamp header (unix seconds)
  signatureHeader: string; // webhook-signature header: "v1,<base64> [v1,<base64> ...]"
  payload: string; // raw request body
  nowSeconds: number;
}): Promise<boolean> {
  const { secret, msgId, timestamp, signatureHeader, payload, nowSeconds } = args;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const rawSecret = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      base64Decode(rawSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false;
  }
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${msgId}.${timestamp}.${payload}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return signatureHeader.split(' ').some((entry) => {
    const [version, candidate] = entry.split(',');
    return version === 'v1' && !!candidate && timingSafeEqual(candidate, expected);
  });
}
