// Shared Google OAuth + Gmail helpers. Pure/crypto parts are unit-tested under
// vitest; network parts (exchangeCode/refresh/sendGmail) are exercised in dry-run.
import { timingSafeEqual } from './timing.ts';
import { parseAddressList } from './recipients.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (bytes: Uint8Array) => {
  // String.fromCharCode(...big) overflows the arg limit — chunk it (same as
  // attachments.toBase64). buildMime feeds whole MIME messages through here.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
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
  if (!timingSafeEqual(await hmac(p, secret), sig)) return null;
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
    // gmail.send: send as the user (existing). gmail.readonly: read the user's
    // mail so the CRM can log client email conversations. readonly is a Google
    // "restricted" scope; it needs no verification for an INTERNAL Workspace app.
    scope: 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResp = { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error?: string };

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

// cc/bcc must be pre-validated by parseRecipientList (no CR/LF) — headers are emitted verbatim.
// When `attachments` is present the message is emitted as multipart/mixed (a
// text/html part + one base64 attachment part each); absent, the output is the
// unchanged single-part text/html message (backward compatible byte-for-byte).
// `messageId`/`inReplyTo`/`references` are emitted verbatim too — they are
// server-generated (newCrmMessageId) or come from a captured header, never from
// user input. `text` adds a text/plain alternative alongside the html.
export function buildMime(m: {
  from: string; to: string; subject: string; html: string; text?: string;
  cc?: string[]; bcc?: string[];
  messageId?: string; inReplyTo?: string; references?: string;
  attachments?: { filename: string; mimeType: string; base64: string }[];
}): string {
  const subj = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(m.subject)))}?=`;
  const hdr = (v: string | undefined) => (v ?? '').replace(/[\r\n]/g, '');
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc && m.cc.length > 0 ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.bcc && m.bcc.length > 0 ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${subj}`,
    ...(m.messageId ? [`Message-ID: ${hdr(m.messageId)}`] : []),
    ...(m.inReplyTo ? [`In-Reply-To: ${hdr(m.inReplyTo)}`] : []),
    ...(m.references ? [`References: ${hdr(m.references)}`] : []),
    'MIME-Version: 1.0',
  ];
  const htmlB64 = btoa(unescape(encodeURIComponent(m.html)));
  const hasText = typeof m.text === 'string' && m.text.trim() !== '';

  // The body block: a bare text/html part, or a multipart/alternative pairing
  // text/plain with it. Mail clients and spam filters both prefer the latter.
  const altBoundary = `itdev_alt_${crypto.randomUUID().replace(/-/g, '')}`;
  const bodyContentType = hasText
    ? `Content-Type: multipart/alternative; boundary="${altBoundary}"`
    : 'Content-Type: text/html; charset=UTF-8';
  const bodyLines: string[] = hasText
    ? [
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        btoa(unescape(encodeURIComponent(m.text!))),
        `--${altBoundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        htmlB64,
        `--${altBoundary}--`,
      ]
    : ['Content-Transfer-Encoding: base64', '', htmlB64];

  if (!m.attachments || m.attachments.length === 0) {
    // With no text alternative this is the unchanged single-part output.
    return b64url(enc.encode([...headers, bodyContentType, ...bodyLines].join('\r\n')));
  }

  const boundary = `itdev_${crypto.randomUUID().replace(/-/g, '')}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    bodyContentType,
    ...bodyLines,
  ];
  for (const a of m.attachments) {
    // Sanitize against header injection: strip quotes/backslashes/CR/LF from the
    // filename, and validate the MIME type is a well-formed token — mimeType is
    // attacker-reachable (request body), so any CRLF/quote/empty/invalid value
    // falls back to a safe default rather than splicing into the header line.
    const name = a.filename.replace(/["\\\r\n]/g, '_');
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : 'application/octet-stream';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mime}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      a.base64.replace(/(.{76})/g, '$1\r\n'), // RFC 2045 76-char line wrap
    );
  }
  parts.push(`--${boundary}--`);
  return b64url(enc.encode(parts.join('\r\n')));
}

// `threadId` makes Gmail file the send inside an existing conversation — it
// must be the thread of a message in the SAME mailbox, and the References /
// In-Reply-To headers still have to be set for the recipient's client to thread.
export async function sendGmail(
  accessToken: string,
  rawBase64Url: string,
  threadId?: string,
): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawBase64Url, ...(threadId ? { threadId } : {}) }),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const j = await r.json();
  return { ok: true, id: j.id, threadId: j.threadId };
}

export function parseAddress(v: string): { email: string; name: string } {
  const m = (v ?? '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: (v ?? '').trim().toLowerCase() };
}

export function extractJobCode(subject: string): string | null {
  const m = (subject ?? '').match(/(\d{6}-[A-Z]{3,})/);
  return m ? m[1] : null;
}

/** One attachment part of a Gmail message. `content_id` is the Content-ID a
 *  multipart/related body references as <img src="cid:…">; Outlook also writes
 *  the same token into the text/plain alternative as `[cid:…]`, which is what
 *  the Emails tab used to render raw. */
export type GmailAttachment = {
  attachment_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  content_id: string | null;
  is_inline: boolean;
};

export type GmailMessage = {
  message_id: string; gmail_id: string; thread_id: string;
  from_email: string; from_name: string; to_email: string;
  subject: string; date: string; internal_date: number;
  body_text: string; body_html: string; snippet: string;
  cc_emails: string | null;
  bcc_emails: string | null;
  label_ids: string[];
  attachments: GmailAttachment[];
};

function b64urlDecodeUtf8(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
};

/** A body part is a leaf we render (text/plain, text/html) only when it has no
 *  filename; Outlook sends .htm attachments as text/html too. */
// deno-lint-ignore no-explicit-any
function partHeader(payload: any, name: string): string {
  const hs = (payload?.headers ?? []) as { name: string; value: string }[];
  return hs.find((h) => h.name?.toLowerCase() === name)?.value ?? '';
}

// deno-lint-ignore no-explicit-any
function collectBody(
  payload: any,
  acc: { text: string[]; html: string[]; att: GmailAttachment[] },
): void {
  if (!payload) return;
  const mime = payload.mimeType ?? '';
  const filename = (payload.filename ?? '') as string;
  const attachmentId = payload.body?.attachmentId as string | undefined;

  if (attachmentId) {
    // Everything Gmail hands back by reference is a file: real attachments
    // (filename set) and inline images pasted into the body (Content-ID set,
    // filename sometimes empty).
    const cidRaw = partHeader(payload, 'content-id');
    const contentId = cidRaw ? cidRaw.replace(/^</, '').replace(/>$/, '').trim() : null;
    const disposition = partHeader(payload, 'content-disposition').toLowerCase();
    const ext = EXT_BY_MIME[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
    acc.att.push({
      attachment_id: attachmentId,
      file_name: filename || `inline-${(contentId ?? crypto.randomUUID()).slice(0, 8)}.${ext}`,
      mime_type: mime || 'application/octet-stream',
      size: Number(payload.body?.size ?? 0),
      content_id: contentId,
      is_inline: !!contentId || disposition.startsWith('inline'),
    });
  } else if (mime === 'text/plain' && payload.body?.data && !filename) {
    acc.text.push(b64urlDecodeUtf8(payload.body.data));
  } else if (mime === 'text/html' && payload.body?.data && !filename) {
    acc.html.push(b64urlDecodeUtf8(payload.body.data));
  }
  for (const p of payload.parts ?? []) collectBody(p, acc);
}

/** Download one attachment's bytes. Gmail returns base64url, sized in bytes. */
export async function getGmailAttachment(
  accessToken: string, messageId: string, attachmentId: string,
): Promise<Uint8Array> {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) throw new Error(`attachment_failed: ${await r.text()}`);
  const j = await r.json();
  const b64 = String(j.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
  // Decode in 4-char-aligned chunks. A single atob() over a multi-megabyte
  // attachment materialises a second full-size binary string on top of the
  // response body, and that peak is what killed the sweep: every invocation
  // from 2026-09-03 10:46 UTC onward returned 546 WORKER_LIMIT once the
  // backfill reached a ~3 MB pasted screenshot. Only the last chunk can be
  // unpadded, which forgiving-base64 accepts.
  const CHUNK = 65536 * 4;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < b64.length; i += CHUNK) {
    const bin = atob(b64.slice(i, i + CHUNK));
    const part = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export async function listGmailMessageIds(
  accessToken: string, query: string, max: number, pageToken?: string,
): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('maxResults', String(max));
  if (query) u.searchParams.set('q', query);
  if (pageToken) u.searchParams.set('pageToken', pageToken);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`list_failed: ${await r.text()}`);
  const j = await r.json();
  return {
    ids: ((j.messages ?? []) as { id: string }[]).map((m) => m.id),
    nextPageToken: (j.nextPageToken as string | undefined) ?? null,
  };
}

export async function getGmailMessageFull(accessToken: string, id: string): Promise<GmailMessage> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`get_failed: ${await r.text()}`);
  const j = await r.json();
  const headers = (j.payload?.headers ?? []) as { name: string; value: string }[];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
  const from = parseAddress(h('From'));
  const to = parseAddress(h('To'));
  const ccList = parseAddressList(h('Cc'));
  const bccList = parseAddressList(h('Bcc'));
  const acc = { text: [] as string[], html: [] as string[], att: [] as GmailAttachment[] };
  collectBody(j.payload, acc);
  return {
    message_id: h('Message-ID') || h('Message-Id') || j.id,
    gmail_id: j.id, thread_id: j.threadId,
    from_email: from.email, from_name: from.name, to_email: to.email,
    subject: h('Subject'), date: h('Date'), internal_date: Number(j.internalDate ?? 0),
    body_text: acc.text.join('\n'), body_html: acc.html.join('\n'), snippet: j.snippet ?? '',
    cc_emails: ccList.join(',') || null, bcc_emails: bccList.join(',') || null,
    label_ids: (j.labelIds ?? []) as string[],
    attachments: acc.att,
  };
}
