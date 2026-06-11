import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature, buildRecoveryEmail } from './hook';

const SECRET_BYTES = 'super-secret-hook-key-0123456789';
const SECRET = `v1,whsec_${btoa(SECRET_BYTES)}`;

/** Re-derive a valid signature the same way the sender (Supabase) does. */
async function sign(msgId: string, timestamp: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET_BYTES),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${msgId}.${timestamp}.${payload}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

describe('verifyWebhookSignature', () => {
  const now = 1_780_000_000; // fixed "current" unix seconds for determinism

  it('accepts a correctly signed payload', async () => {
    const ts = String(now);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v1,${sig}`,
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(true);
  });

  it('accepts when a valid signature is one of several space-separated entries', async () => {
    const ts = String(now);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v1,AAAA v1,${sig}`,
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const ts = String(now);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v1,${sig}`,
      payload: '{"a":2}',
      nowSeconds: now,
    });
    expect(ok).toBe(false);
  });

  it('rejects a stale timestamp (>5 minutes old)', async () => {
    const ts = String(now - 600);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v1,${sig}`,
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(false);
  });

  it('rejects (returns false, not throws) when the secret is not valid base64', async () => {
    const ts = String(now);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: 'v1,whsec_!!!not-base64!!!',
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v1,${sig}`,
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(false);
  });

  it('rejects a valid signature sent under a wrong scheme version', async () => {
    const ts = String(now);
    const sig = await sign('msg_1', ts, '{"a":1}');
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: ts,
      signatureHeader: `v2,${sig}`,
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(false);
  });

  it('rejects an empty or malformed signature header', async () => {
    const ok = await verifyWebhookSignature({
      secret: SECRET,
      msgId: 'msg_1',
      timestamp: String(now),
      signatureHeader: '',
      payload: '{"a":1}',
      nowSeconds: now,
    });
    expect(ok).toBe(false);
  });
});

describe('buildRecoveryEmail', () => {
  const SUPABASE_URL = 'https://xujlrclyzxrvxszepquy.supabase.co';

  it('builds the verify URL and send payload for a recovery hook', () => {
    const out = buildRecoveryEmail(
      {
        user: { email: 'marios@itdev.gr' },
        email_data: {
          token_hash: 'abc123',
          redirect_to: 'https://app.itdev.gr/reset-password',
          email_action_type: 'recovery',
        },
      },
      SUPABASE_URL,
    );
    expect(out).not.toBeNull();
    expect(out!.to).toBe('marios@itdev.gr');
    expect(out!.templateKey).toBe('auth_password_reset');
    // The hosted GET /auth/v1/verify endpoint takes the token hash in the
    // `token` param (same as Supabase's own ConfirmationURL); `token_hash`
    // is only accepted by the POST verifyOtp API and returns 400 here.
    expect(out!.data.reset_url).toBe(
      `${SUPABASE_URL}/auth/v1/verify?token=abc123&type=recovery` +
        `&redirect_to=${encodeURIComponent('https://app.itdev.gr/reset-password')}`,
    );
    expect(out!.data.cta_url).toBe(out!.data.reset_url);
    expect(out!.data.cta_label.length).toBeGreaterThan(0);
  });

  it('returns null for non-recovery action types', () => {
    const out = buildRecoveryEmail(
      {
        user: { email: 'a@b.gr' },
        email_data: { token_hash: 'x', redirect_to: 'https://a', email_action_type: 'magiclink' },
      },
      SUPABASE_URL,
    );
    expect(out).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(buildRecoveryEmail({}, SUPABASE_URL)).toBeNull();
    expect(
      buildRecoveryEmail(
        { user: {}, email_data: { token_hash: 'x', redirect_to: 'y', email_action_type: 'recovery' } },
        SUPABASE_URL,
      ),
    ).toBeNull();
  });
});
