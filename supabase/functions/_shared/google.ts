// Shared Google OAuth + Gmail helpers. Pure/crypto parts are unit-tested under
// vitest; network parts (exchangeCode/refresh/sendGmail) are exercised in dry-run.
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signState(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const p = b64url(enc.encode(JSON.stringify(body)));
  return `${p}.${await hmac(p, secret)}`;
}

export async function verifyState(state: string, secret: string): Promise<Record<string, unknown> | null> {
  const [p, sig] = state.split('.');
  if (!p || !sig) return null;
  if ((await hmac(p, secret)) !== sig) return null;
  try {
    const body = JSON.parse(dec.decode(b64urlToBytes(p)));
    if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

async function aesKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plain: string, base64Key: string): Promise<string> {
  const key = await aesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64url(out);
}

export async function decryptToken(packed: string, base64Key: string): Promise<string> {
  const key = await aesKey(base64Key);
  const all = b64urlToBytes(packed);
  const iv = all.slice(0, 12); const ct = all.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResp = { access_token?: string; refresh_token?: string; id_token?: string; error?: string };

export async function exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<TokenResp> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  return r.json();
}

export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string | null> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
  });
  const j = (await r.json()) as TokenResp;
  return j.access_token ?? null;
}

export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(dec.decode(b64urlToBytes(idToken.split('.')[1])));
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export function buildMime(m: { from: string; to: string; subject: string; html: string }): string {
  const subj = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(m.subject)))}?=`;
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${subj}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(m.html))),
  ];
  return b64url(enc.encode(lines.join('\r\n')));
}

export async function sendGmail(accessToken: string, rawBase64Url: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawBase64Url }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const j = await r.json();
  return { ok: true, id: j.id };
}
