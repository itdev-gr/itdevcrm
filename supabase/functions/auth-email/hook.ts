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

export type SendEmailHookPayload = {
  user?: { email?: string };
  email_data?: {
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
  };
};

export type RecoveryEmail = {
  to: string;
  templateKey: 'auth_password_reset';
  data: { reset_url: string; cta_url: string; cta_label: string };
};

/**
 * Only `recovery` is handled — invites set passwords directly and no other
 * auth email type is in use. Anything else returns null (caller logs + skips)
 * so future auth-email types get wired consciously, not silently dropped.
 */
export function buildRecoveryEmail(
  payload: SendEmailHookPayload,
  supabaseUrl: string,
): RecoveryEmail | null {
  const action = payload.email_data?.email_action_type;
  const to = payload.user?.email;
  const tokenHash = payload.email_data?.token_hash;
  const redirectTo = payload.email_data?.redirect_to;
  if (action !== 'recovery' || !to || !tokenHash || !redirectTo) return null;

  // GET /auth/v1/verify takes the token hash in `token` (the `token_hash`
  // param is POST-only and 400s on the hosted endpoint).
  const resetUrl =
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}` +
    `&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}`;
  return {
    to,
    templateKey: 'auth_password_reset',
    data: {
      reset_url: resetUrl,
      cta_url: resetUrl,
      cta_label: 'Ορισμός νέου κωδικού / Set new password',
    },
  };
}
