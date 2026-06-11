import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from './hook';

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
