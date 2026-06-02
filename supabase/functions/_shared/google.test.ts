import { describe, it, expect } from 'vitest';
import { signState, verifyState, encryptToken, decryptToken, buildMime } from './google';

const STATE_SECRET = 'test-state-secret';
const TOKEN_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))); // 32 bytes, base64

describe('google helpers', () => {
  it('signs and verifies state round-trip', async () => {
    const s = await signState({ uid: 'u1' }, STATE_SECRET, 600);
    const v = await verifyState(s, STATE_SECRET);
    expect(v?.uid).toBe('u1');
  });

  it('rejects tampered state', async () => {
    const s = await signState({ uid: 'u1' }, STATE_SECRET, 600);
    const v = await verifyState(s.slice(0, -2) + 'xx', STATE_SECRET);
    expect(v).toBeNull();
  });

  it('encrypts and decrypts a refresh token round-trip', async () => {
    const ct = await encryptToken('1//secret-refresh', TOKEN_KEY);
    expect(ct).not.toContain('secret-refresh');
    expect(await decryptToken(ct, TOKEN_KEY)).toBe('1//secret-refresh');
  });

  it('builds a base64url MIME message with encoded Greek subject', () => {
    const raw = buildMime({ from: 'a@itdev.gr', to: 'c@x.gr', subject: 'Γεια', html: '<p>σώμα</p>' });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no +/=
    const decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    expect(decoded).toContain('To: c@x.gr');
    expect(decoded).toContain('=?UTF-8?B?'); // RFC2047-encoded subject
  });
});
