# Per-User Gmail Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user connect their Google Workspace account once and send the sales **offer** and **won-welcome** emails from their own mailbox via the Gmail API; automated email stays on Resend.

**Architecture:** A Deno Edge Function `google-oauth` runs the per-user OAuth dance (start → Google consent → callback) and stores an AES-GCM-encrypted refresh token in `user_google_accounts`. A shared module `_shared/google.ts` holds the crypto + Google/Gmail helpers. The existing `send-email` function gains a `personal` path that, for an authenticated user, decrypts their refresh token, mints an access token, and sends as them. The sales dialog routes to `personal` and prompts "Connect Google" if not connected.

**Tech Stack:** Supabase (Postgres, Edge Functions/Deno, secrets), Google OAuth 2.0 + Gmail API, Deno Web Crypto (HMAC + AES-GCM), React 19 + TanStack Query + react-i18next, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-02-per-user-gmail-sending-design.md`

---

## Preconditions (already done)

Supabase secrets are set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_STATE_SECRET`, `GMAIL_TOKEN_KEY` (base64 of 32 random bytes), `APP_URL` (`https://itdevcrm.vercel.app`), `RESEND_API_KEY`, `EMAIL_DRY_RUN=true`. Google Cloud: Gmail API enabled, Internal consent screen with `gmail.send`, Web OAuth client with redirect URI `https://xujlrclyzxrvxszepquy.supabase.co/functions/v1/google-oauth`.

**Execution note:** `supabase db push` / `functions deploy` require the access token (and migrations use the Management API query endpoint, since the CLI lacks the DB password). These infra steps are run by the token-holder (the controller), not by code-only subagents. Subagents create files + run local checks (vitest/typecheck/lint) + commit.

## Conventions locked for the whole plan

- **Table:** `public.user_google_accounts (user_id PK, google_email, refresh_token_enc, connected_at, revoked_at)`. **View:** `public.user_google_status (user_id, google_email, connected)`.
- **Edge Function:** `google-oauth`. Endpoints: `POST {action:'start'}` (user JWT) → `{url}`; `GET ?code&state` (Google) → redirect to `${APP_URL}/profile?google=connected|error`; `POST {action:'disconnect'}` (user JWT).
- **OAuth scopes:** `openid email https://www.googleapis.com/auth/gmail.send`. Auth URL params include `access_type=offline&prompt=consent` (to always get a refresh token).
- **send-email identity `personal`:** requires user JWT; sends via the caller's Gmail; logs to `email_log` with `identity='personal'`.
- **Shared module:** `supabase/functions/_shared/google.ts` (imported by both `google-oauth` and `send-email`).

## File Structure

- `supabase/migrations/20260602000005_user_google_accounts.sql` — table + status view + RLS.
- `supabase/functions/_shared/google.ts` — `signState/verifyState`, `encryptToken/decryptToken`, `buildAuthUrl`, `exchangeCode`, `refreshAccessToken`, `emailFromIdToken`, `buildMime`, `sendGmail`.
- `supabase/functions/_shared/google.test.ts` — vitest for the pure/crypto helpers.
- `supabase/functions/google-oauth/index.ts` — the OAuth Edge Function.
- `supabase/functions/send-email/index.ts` — MODIFY: add `personal` path.
- `src/features/email/useGoogleConnection.ts` — status query + connect/disconnect.
- `src/features/email/useGoogleConnection.test.tsx` — RTL/hook test.
- `src/i18n/locales/{en,el}/email.json` — MODIFY: add `connect.*` keys.
- `src/features/users/MyProfilePage.tsx` — MODIFY: add the Google section + `?google=` handling.
- `src/features/email/SendEmailDialog.tsx` — MODIFY: `personal` connection gating.
- `src/features/leads/LeadDetailPage.tsx`, `src/features/deals/DealDetailPage.tsx` — MODIFY: `identity="personal"`.

---

## Task 1: `user_google_accounts` table + status view

**Files:** Create `supabase/migrations/20260602000005_user_google_accounts.sql`

- [ ] **Step 1: Write the migration**

```sql
create table public.user_google_accounts (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  google_email text not null,
  refresh_token_enc text not null,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.user_google_accounts enable row level security;
-- No client policies → only the service-role Edge Function can read/write the
-- encrypted refresh token. Clients read connection status via the view below.

create view public.user_google_status
with (security_invoker = true) as
select user_id,
       google_email,
       (revoked_at is null) as connected
from public.user_google_accounts;

-- The view is security_invoker, so callers need a way to see their own row.
-- Grant a narrow RLS policy that exposes ONLY status columns of the base table
-- to the owner — but since the base table has no client policy, the view would
-- return nothing. Instead, expose status via a security-definer function.
create or replace function public.my_google_status()
returns table (google_email text, connected boolean)
language sql security definer set search_path = public stable as $$
  select google_email, (revoked_at is null)
  from public.user_google_accounts
  where user_id = auth.uid();
$$;
grant execute on function public.my_google_status() to authenticated;

-- ROLLBACK:
-- drop function if exists public.my_google_status();
-- drop view if exists public.user_google_status;
-- drop table if exists public.user_google_accounts;
```

Note: the client reads its own status via `my_google_status()` (security-definer, `auth.uid()`-scoped) — never the base table. The `user_google_status` view is retained for admin/service inspection.

- [ ] **Step 2: Apply (token-holder)**

Apply via the Management API query endpoint (same method used for the email migrations) and record `20260602000005` in `supabase_migrations.schema_migrations`.
Expected: `user_google_accounts`, `user_google_status`, `my_google_status` exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602000005_user_google_accounts.sql
git commit -m "feat(gmail): user_google_accounts table + my_google_status function

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared Google helpers + unit tests

**Files:** Create `supabase/functions/_shared/google.ts` and `supabase/functions/_shared/google.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it (red)**

Run: `npx vitest run supabase/functions/_shared/google.test.ts`
Expected: FAIL — `./google` not found.

- [ ] **Step 3: Write `google.ts`**

```ts
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
```

- [ ] **Step 4: Run it (green)**

Run: `npx vitest run supabase/functions/_shared/google.test.ts`
Expected: PASS (4 tests). Web Crypto (`crypto.subtle`) is available globally in the vitest/Node environment.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/google.ts supabase/functions/_shared/google.test.ts
git commit -m "feat(gmail): shared Google OAuth + Gmail helpers (state, AES-GCM, MIME)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `google-oauth` Edge Function

**Files:** Create `supabase/functions/google-oauth/index.ts`

- [ ] **Step 1: Write the function**

```ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { signState, verifyState, buildAuthUrl, exchangeCode, emailFromIdToken, encryptToken } from '../_shared/google.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const STATE_SECRET = Deno.env.get('GMAIL_STATE_SECRET')!;
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')!;
const APP_URL = Deno.env.get('APP_URL')!;
const REDIRECT_URI = `${URL_}/functions/v1/google-oauth`;

const admin = createClient(URL_, SERVICE_KEY);

async function callerUserId(authHeader: string): Promise<string | null> {
  const c = createClient(URL_, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data } = await c.auth.getUser();
  return data?.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);

  // Google callback (GET ?code&state)
  if (req.method === 'GET' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code')!;
    const state = url.searchParams.get('state') ?? '';
    const verified = await verifyState(state, STATE_SECRET);
    if (!verified?.uid) return Response.redirect(`${APP_URL}/profile?google=error`, 302);
    const tok = await exchangeCode(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    if (!tok.refresh_token || !tok.id_token) return Response.redirect(`${APP_URL}/profile?google=error`, 302);
    const email = emailFromIdToken(tok.id_token) ?? 'unknown';
    const enc = await encryptToken(tok.refresh_token, TOKEN_KEY);
    await admin.from('user_google_accounts').upsert({
      user_id: verified.uid, google_email: email, refresh_token_enc: enc, connected_at: new Date().toISOString(), revoked_at: null,
    });
    return Response.redirect(`${APP_URL}/profile?google=connected`, 302);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const uid = await callerUserId(auth);
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === 'start') {
    const state = await signState({ uid }, STATE_SECRET, 600);
    return json({ url: buildAuthUrl(CLIENT_ID, REDIRECT_URI, state) });
  }
  if (body.action === 'disconnect') {
    await admin.from('user_google_accounts').update({ revoked_at: new Date().toISOString() }).eq('user_id', uid);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
});
```

- [ ] **Step 2: Deploy (token-holder)**

`supabase functions deploy google-oauth --project-ref xujlrclyzxrvxszepquy`
Expected: deploys (bundles `_shared/google.ts`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/google-oauth/index.ts
git commit -m "feat(gmail): google-oauth Edge Function (start/callback/disconnect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `personal` path in `send-email`

**Files:** Modify `supabase/functions/send-email/index.ts`

- [ ] **Step 1: Add imports + the personal sender**

At the top imports, add:
```ts
import { decryptToken, refreshAccessToken, buildMime, sendGmail } from '../_shared/google.ts';
```
Add these env reads near the other `Deno.env.get` lines:
```ts
const G_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const G_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const G_TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY') ?? '';
```
Add a `sendPersonal` function (place above `Deno.serve`):
```ts
async function sendPersonal(uid: string, to: string, data: Record<string, unknown>, dedupeKey: string | null): Promise<{ status: 'sent' | 'failed' | 'skipped' | 'not_connected'; id?: string; error?: string }> {
  if (dedupeKey) {
    const { data: prior } = await admin.from('email_log').select('id').eq('dedupe_key', dedupeKey).eq('status', 'sent').limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  const { data: acct } = await admin.from('user_google_accounts').select('google_email, refresh_token_enc, revoked_at').eq('user_id', uid).maybeSingle();
  if (!acct || acct.revoked_at) return { status: 'not_connected' };

  const subject = String(data.subject ?? '');
  const html = String(data.html ?? '');
  if (DRY_RUN) {
    await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: 'sent', resend_id: 'dry-run', dedupe_key: dedupeKey });
    return { status: 'sent', id: 'dry-run' };
  }
  const refresh = await decryptToken(acct.refresh_token_enc, G_TOKEN_KEY);
  const access = await refreshAccessToken(refresh, G_CLIENT_ID, G_CLIENT_SECRET);
  if (!access) {
    await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: 'failed', dedupe_key: dedupeKey, error: 'token_refresh_failed' });
    return { status: 'failed', error: 'token_refresh_failed' };
  }
  const raw = buildMime({ from: acct.google_email, to, subject, html });
  const res = await sendGmail(access, raw);
  await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: res.ok ? 'sent' : 'failed', resend_id: res.id ?? null, dedupe_key: dedupeKey, error: res.ok ? null : res.error });
  return res.ok ? { status: 'sent', id: res.id } : { status: 'failed', error: res.error };
}
```

- [ ] **Step 2: Route `personal` in the request handler**

In `Deno.serve`, in the single-send section (after the user-auth check that sets/uses the caller), BEFORE the generic `sendOne(body)`, insert:
```ts
  if (body.identity === 'personal') {
    if (isServiceRole) return json({ error: 'personal requires a user' }, 400);
    const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: 'Unauthorized' }, 401);
    const r = await sendPersonal(u.user.id, body.to, body.data ?? {}, body.dedupeKey ?? null);
    if (r.status === 'not_connected') return json({ status: 'not_connected' }, 409);
    return json({ status: r.status, id: r.id, error: r.error }, r.status === 'failed' ? 502 : 200);
  }
```
(`IDENTITIES` has no `personal` entry, so the generic Resend path is never used for it.)

- [ ] **Step 3: Deploy (token-holder) + verify it still type-loads**

`supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy`
Expected: deploys.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "feat(gmail): send-email personal path (send as the connected user)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `useGoogleConnection` hook + i18n

**Files:** Create `src/features/email/useGoogleConnection.ts`, `src/features/email/useGoogleConnection.test.tsx`; Modify `src/i18n/locales/{en,el}/email.json`

- [ ] **Step 1: Add i18n keys** — add a `connect` block to both files.

`el/email.json` (inside the root object):
```json
  "connect": {
    "title": "Σύνδεση Google",
    "connect": "Σύνδεση με Google",
    "connected_as": "Συνδεδεμένο ως {{email}}",
    "disconnect": "Αποσύνδεση",
    "needed": "Συνδέστε το Google για αποστολή από το email σας.",
    "success": "Το Google συνδέθηκε.",
    "error": "Η σύνδεση Google απέτυχε."
  }
```
`en/email.json`:
```json
  "connect": {
    "title": "Google connection",
    "connect": "Connect Google",
    "connected_as": "Connected as {{email}}",
    "disconnect": "Disconnect",
    "needed": "Connect Google to send from your address.",
    "success": "Google connected.",
    "error": "Google connection failed."
  }
```

- [ ] **Step 2: Write the failing test**

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, functions: { invoke } } }));

import { useGoogleConnection } from './useGoogleConnection';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGoogleConnection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reports connected status from my_google_status()', async () => {
    rpc.mockResolvedValue({ data: [{ google_email: 'me@itdev.gr', connected: true }], error: null });
    const { result } = renderHook(() => useGoogleConnection(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.email).toBe('me@itdev.gr');
  });
});
```

- [ ] **Step 3: Run it (red)** — `npx vitest run src/features/email/useGoogleConnection.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Write the hook**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useGoogleConnection() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['google-connection'] as const,
    queryFn: async (): Promise<{ connected: boolean; email: string | null }> => {
      const { data, error } = await supabase.rpc('my_google_status');
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : null;
      return { connected: !!row?.connected, email: row?.google_email ?? null };
    },
  });
  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-oauth', { body: { action: 'start' } });
      if (error) throw new Error(error.message);
      const url = (data as { url?: string })?.url;
      if (url) window.location.href = url;
    },
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('google-oauth', { body: { action: 'disconnect' } });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['google-connection'] }),
  });
  return {
    connected: status.data?.connected ?? false,
    email: status.data?.email ?? null,
    isLoading: status.isLoading,
    connect: connect.mutate,
    disconnect: disconnect.mutate,
  };
}
```

- [ ] **Step 5: Run it (green)** — `npx vitest run src/features/email/useGoogleConnection.test.tsx` → PASS. Then `node -e` JSON-parse both email.json files and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/features/email/useGoogleConnection.ts src/features/email/useGoogleConnection.test.tsx src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(gmail): useGoogleConnection hook + connect i18n

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Profile "Connect Google" section

**Files:** Modify `src/features/users/MyProfilePage.tsx`

- [ ] **Step 1: Read the page** — `sed -n '1,100p' src/features/users/MyProfilePage.tsx` to find the imports, the `useTranslation` calls, and the final section before the autosave status line (~line 169) where a new section fits.

- [ ] **Step 2: Add imports**

```tsx
import { useGoogleConnection } from '@/features/email/useGoogleConnection';
import { useTranslation } from 'react-i18next'; // already imported — do not duplicate
```
Add a translator for the email namespace near the existing `const { t, i18n } = useTranslation('users');`:
```tsx
const { t: tEmail } = useTranslation('email');
const google = useGoogleConnection();
```

- [ ] **Step 3: Add the section** before the autosave status `<div>` (the `{autoSaveLabel(...)}` line):

```tsx
<div className="rounded-md border p-4">
  <h2 className="text-sm font-medium">{tEmail('connect.title')}</h2>
  {google.connected ? (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600">{tEmail('connect.connected_as', { email: google.email })}</span>
      <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => google.disconnect()}>
        {tEmail('connect.disconnect')}
      </button>
    </div>
  ) : (
    <button type="button" className="mt-2 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white" onClick={() => google.connect()}>
      {tEmail('connect.connect')}
    </button>
  )}
</div>
```

- [ ] **Step 4: Show connect/error result** — at the top of the component body, after the hooks, read the query param and refresh status once:

```tsx
// near the other hooks
const search = new URLSearchParams(window.location.search);
const googleResult = search.get('google'); // 'connected' | 'error' | null
```
Add a small banner above the Google section:
```tsx
{googleResult === 'connected' && <p className="text-sm text-green-700">{tEmail('connect.success')}</p>}
{googleResult === 'error' && <p className="text-sm text-red-600">{tEmail('connect.error')}</p>}
```

- [ ] **Step 5: Verify** — `npm run typecheck && npm run lint`. Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/users/MyProfilePage.tsx
git commit -m "feat(gmail): Connect Google section on the profile page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Route sales emails via `personal` + connection gating

**Files:** Modify `src/features/email/SendEmailDialog.tsx`, `src/features/leads/LeadDetailPage.tsx`, `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: Update the dialog test** — add to `src/features/email/SendEmailDialog.test.tsx`:

```tsx
it('shows the connect prompt for a personal send when not connected', () => {
  // useGoogleConnection mocked as not connected
  // (add this mock at top of file): vi.mock('./useGoogleConnection', () => ({ useGoogleConnection: () => ({ connected: false, email: null, connect: vi.fn(), disconnect: vi.fn(), isLoading: false }) }));
  render(wrap(<SendEmailDialog open identity="personal" to="c@x.gr" subject="S" body="B" onClose={() => {}} />));
  expect(screen.getByText(/Connect Google|Συνδέστε το Google/)).toBeInTheDocument();
});
```
(Place the `vi.mock('./useGoogleConnection', …)` with the other `vi.mock` calls at the top.)

- [ ] **Step 2: Run it (red)** — the dialog ignores `personal`, so the prompt isn't shown → FAIL.

- [ ] **Step 3: Add gating to the dialog** — in `SendEmailDialog.tsx`, import and use the hook, and when `identity === 'personal'` and not connected, render the prompt instead of the Send button:

```tsx
import { useGoogleConnection } from './useGoogleConnection';
// inside the component, after const send = useSendEmail():
const google = useGoogleConnection();
const needsConnect = identity === 'personal' && !google.connected && !google.isLoading;
```
Replace the Send button block with:
```tsx
{!done && (needsConnect ? (
  <button type="button" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white" onClick={() => google.connect()}>
    {t('connect.connect')}
  </button>
) : (
  <button type="button" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white" onClick={submit} disabled={send.isPending}>
    {t('dialog.send')}
  </button>
))}
```
And add the prompt text above the buttons when `needsConnect`:
```tsx
{needsConnect && <p className="mt-3 text-sm text-amber-700">{t('connect.needed')}</p>}
```
Also handle the `not_connected` server response in `useSendEmail` — if `data.status === 'not_connected'`, throw a typed error; the dialog already shows `dialog.failed`, which is acceptable, but prefer showing the connect prompt (the gating above covers the common case).

- [ ] **Step 4: Switch the sales dialogs to `personal`** — in `LeadDetailPage.tsx` change the offer `SendEmailDialog` prop `identity="sales"` → `identity="personal"`; in `DealDetailPage.tsx` change the welcome `SendEmailDialog` prop `identity="sales"` → `identity="personal"`.

- [ ] **Step 5: Run tests + verify** — `npx vitest run src/features/email/` then `npm run typecheck && npm run lint`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/email/SendEmailDialog.tsx src/features/email/SendEmailDialog.test.tsx src/features/leads/LeadDetailPage.tsx src/features/deals/DealDetailPage.tsx
git commit -m "feat(gmail): sales emails send via personal Gmail with connect gating

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Harden the Resend drain service-role check (smoke-test finding)

**Files:** Modify `supabase/functions/send-email/index.ts`

The smoke test showed `token === SUPABASE_SERVICE_ROLE_KEY` is brittle under the new Supabase API-key system. Accept an explicit configured drain secret as an alternative.

- [ ] **Step 1: Add a drain-secret env + check**

Add near the env reads: `const DRAIN_SECRET = Deno.env.get('EMAIL_DRAIN_SECRET') ?? '';`
Change the `isServiceRole` computation to also accept the drain secret:
```ts
const isServiceRole = token === SERVICE_KEY || (DRAIN_SECRET !== '' && token === DRAIN_SECRET);
```

- [ ] **Step 2: Token-holder sets the secret + Vault entry**

Generate one value, set it both as a function secret and as the Vault `service_role_key` the drain cron reads:
`supabase secrets set EMAIL_DRAIN_SECRET=<random> --project-ref xujlrclyzxrvxszepquy`, and in SQL: `select vault.create_secret('<same random>', 'service_role_key'); select vault.create_secret('https://xujlrclyzxrvxszepquy.supabase.co', 'project_url');` Redeploy `send-email`.
Expected: the drain cron's `Authorization: Bearer <vault service_role_key>` now matches `EMAIL_DRAIN_SECRET` → drain authorized.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "fix(email): accept explicit EMAIL_DRAIN_SECRET for drain auth (new key system)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Final verification + go-live runbook

**Files:** none

- [ ] **Step 1: Full static + unit suite**

Run: `npm run build` (the exact Vercel command: `tsc -b && npm run lint && vite build`) and `npm run test:run`.
Expected: build PASS; all vitest tests pass (incl. `_shared/google.test.ts`, `useGoogleConnection`, dialog).

- [ ] **Step 2: Deploy (token-holder)**

`supabase functions deploy google-oauth` and `supabase functions deploy send-email`; apply migration `20260602000005`. Confirm secrets present (`supabase secrets list`).

- [ ] **Step 3: Live connect smoke (dry-run still on)**

In the app `/profile`, click **Connect Google** as a test salesperson → consent → land on `/profile?google=connected`; confirm `my_google_status()` shows connected. Open a lead at *Offer Sent* → "Send offer email" → the dialog shows the editable draft (no connect prompt) → Send → with `EMAIL_DRY_RUN=true`, an `email_log` row `identity='personal', resend_id='dry-run'` appears (no real email).

- [ ] **Step 4: Go-live (token-holder, when ready)**

`supabase secrets set EMAIL_DRY_RUN=false` + redeploy both functions. Send one real offer from a test salesperson → verify it arrives **from their address** and is in their Gmail Sent. Then **regenerate the Google client secret** (it was shared in chat) and update `GOOGLE_CLIENT_SECRET`.

---

## Changes / Revert

**New:** migration `20260602000005`; `_shared/google.ts`; `google-oauth` function; `personal` path + `EMAIL_DRAIN_SECRET` in `send-email`; `useGoogleConnection`; profile Google section; sales dialogs → `personal`. **Secrets:** Google + Gmail + `EMAIL_DRAIN_SECRET` (none in repo).
**Revert:** migration `-- ROLLBACK:` block; `supabase functions delete google-oauth`; revert `send-email`/frontend by commit; set sales dialogs back to `identity="sales"` to fall back to Resend. **Kill switch:** `EMAIL_DRY_RUN=true`.

## Self-Review

**Spec coverage:** connect flow (T3) + token storage/encryption (T1,T2) + personal send (T4) + status/connect/disconnect UI (T5,T6) + sales routing & gating (T7) + manual setup (preconditions, done) + drain fix (T8) + tests (T2,T5,T7) + go-live (T9). All spec sections mapped.

**Placeholder scan:** every code step has complete code; T6 reads the page first (component shape confirmed at execution) — a verification step, not a placeholder.

**Type consistency:** `useGoogleConnection` returns `{connected,email,isLoading,connect,disconnect}` used identically in T6/T7. `send-email` `personal` branch returns `{status}` with `not_connected→409`, matching the dialog's handling. `my_google_status()` columns (`google_email, connected`) match the hook's read. `buildMime`/`encryptToken`/`signState` signatures match between `google.ts` (T2), `google-oauth` (T3), and `send-email` (T4). Redirect URI string identical in T3 and the registered Google client.
