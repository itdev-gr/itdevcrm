# Password Reset via Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can reset a forgotten password via an emailed link — "Forgot password?" on the login page, bilingual (EL/EN) email through the existing Resend pipeline, new-password page.

**Architecture:** Supabase Auth generates/validates the one-time recovery link. A new `auth-email` edge function receives Supabase's signed "send email" webhook, builds the verify URL, and POSTs to the existing `send-email` function (service role) so the email uses the admin-editable `auth_password_reset` row in `email_templates`, the `internal` identity (`ITDEV <noreply@itdev.gr>`), and lands in `email_log`. Two new public frontend routes: `/forgot-password` and `/reset-password`.

**Tech Stack:** Vite + React 18 + TS, Supabase (Auth, Edge Functions/Deno 2, Postgres), Resend, Vitest, react-hook-form + zod, react-i18next.

**Spec:** `docs/superpowers/specs/2026-06-11-password-reset-design.md`

**Conventions:** Commit after every task and push to `main` directly (no PRs). Run `npm run lint` before each commit (build runs it too).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260611000002_auth_password_reset_template.sql` | Create | Seed the bilingual `auth_password_reset` template row (rollback SQL in header) |
| `supabase/tests/auth_password_reset_template.sql` | Create | SQL smoke test for the template row |
| `supabase/functions/send-email/templates.ts` | Modify | `renderDbTemplate` learns an optional CTA button (`data.cta_url` / `data.cta_label`) |
| `supabase/functions/send-email/templates.test.ts` | Modify | Tests for the CTA button |
| `supabase/functions/auth-email/hook.ts` | Create | Pure logic: webhook signature verification + recovery-email construction (Vitest-covered) |
| `supabase/functions/auth-email/hook.test.ts` | Create | Tests for hook.ts |
| `supabase/functions/auth-email/index.ts` | Create | Thin Deno.serve wiring: verify → build → POST to send-email |
| `src/features/auth/ForgotPasswordPage.tsx` (+ `.test.tsx`) | Create | Email form, uniform "sent" notice |
| `src/features/auth/ResetPasswordPage.tsx` (+ `.test.tsx`) | Create | New-password form / expired-link state |
| `src/features/auth/LoginPage.tsx` (+ `.test.tsx`) | Modify | "Forgot password?" link |
| `src/app/router.tsx` | Modify | Routes `/forgot-password`, `/reset-password` |
| `src/i18n/locales/{en,el}/auth.json` | Modify | New strings |

---

### Task 1: Seed the `auth_password_reset` email template (migration + SQL test)

**Files:**
- Create: `supabase/migrations/20260611000002_auth_password_reset_template.sql`
- Create: `supabase/tests/auth_password_reset_template.sql`

- [ ] **Step 1: Write the SQL test (it must fail before the migration runs)**

Create `supabase/tests/auth_password_reset_template.sql`:

```sql
-- supabase/tests/auth_password_reset_template.sql
--
-- SQL smoke test for the auth_password_reset email template seed.
--
-- HOW TO RUN:
--   PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
--     "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" \
--     -f supabase/tests/auth_password_reset_template.sql
--
-- Read-only checks inside a rolled-back transaction; no data is modified.

begin;

do $$
declare
  r public.email_templates%rowtype;
begin
  select * into r from public.email_templates where key = 'auth_password_reset';
  if r.key is null then
    raise exception 'auth_password_reset template row missing';
  end if;
  if r.client_facing then
    raise exception 'auth_password_reset must have client_facing = false (staff email, no unsubscribe footer)';
  end if;
  if position('{{reset_url}}' in r.body) = 0 then
    raise exception 'body must contain the {{reset_url}} fallback link';
  end if;
  if position('Γεια σας' in r.body) = 0 then
    raise exception 'body must contain the Greek section';
  end if;
  if position('Hello' in r.body) = 0 then
    raise exception 'body must contain the English section';
  end if;
  if r.variables <> 'reset_url' then
    raise exception 'variables must list reset_url (admin UI hint)';
  end if;
  raise notice 'auth_password_reset template OK';
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" \
  -f supabase/tests/auth_password_reset_template.sql
```
Expected: FAIL with `auth_password_reset template row missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260611000002_auth_password_reset_template.sql`:

```sql
-- =============================================================================
-- Password reset email template (auth_password_reset).
--
-- Sent by the auth-email edge function when Supabase Auth fires the
-- "send email" hook for a password-recovery request. Staff-facing, so
-- client_facing = false (no unsubscribe footer). The send path appends a
-- styled CTA button; {{reset_url}} in the body is the copy-paste fallback.
--
-- Rollback:
--   delete from public.email_templates where key = 'auth_password_reset';
-- =============================================================================

insert into public.email_templates (key, description, subject, body, variables, client_facing)
values (
  'auth_password_reset',
  'Επαναφορά κωδικού — στέλνεται όταν χρήστης ζητήσει reset από τη σελίδα σύνδεσης',
  'Επαναφορά κωδικού ITDEV CRM / ITDEV CRM password reset',
  E'Γεια σας,\n\nΛάβαμε αίτημα επαναφοράς του κωδικού σας στο ITDEV CRM. Πατήστε το κουμπί παρακάτω για να ορίσετε νέο κωδικό. Ο σύνδεσμος ισχύει για 1 ώρα και μπορεί να χρησιμοποιηθεί μία φορά.\n\nΑν δεν ζητήσατε εσείς την επαναφορά, αγνοήστε αυτό το email.\n\nΑν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο: {{reset_url}}\n\n---\n\nHello,\n\nWe received a request to reset your ITDEV CRM password. Click the button below to set a new password. The link is valid for 1 hour and can be used once.\n\nIf you didn''t request this, you can safely ignore this email.\n\nIf the button doesn''t work, copy this link: {{reset_url}}',
  'reset_url',
  false
)
on conflict (key) do nothing;
```

- [ ] **Step 4: Apply the migration**

Run:
```bash
supabase db push
```
(If the CLI isn't linked: `supabase link --project-ref xujlrclyzxrvxszepquy` first.)
Expected: the new migration applies cleanly.

- [ ] **Step 5: Run the SQL test to verify it passes**

Same command as Step 2. Expected: `NOTICE: auth_password_reset template OK`, `ROLLBACK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260611000002_auth_password_reset_template.sql supabase/tests/auth_password_reset_template.sql
git commit -m "feat(auth-reset): seed bilingual auth_password_reset email template"
git push
```

---

### Task 2: CTA button support in `renderDbTemplate`

The DB-template renderer produces plain-text bodies (escaped, newlines → `<br/>`). A reset email needs a real button. Add generic support: when `data.cta_url` is present, append a styled button under the body. The plain-text version is unchanged — the seeded body already carries `{{reset_url}}` inline.

**Files:**
- Modify: `supabase/functions/send-email/templates.ts` (the `renderDbTemplate` function)
- Test: `supabase/functions/send-email/templates.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/send-email/templates.test.ts` (inside the existing `describe('email templates', ...)` block). `renderDbTemplate` reads `Deno.env` at call time and Vitest runs under Node, so stub `Deno` first:

```ts
// renderDbTemplate reads Deno.env at call time; stub it for the Node test runtime.
Object.assign(globalThis, { Deno: { env: { get: () => undefined } } });

it('appends a CTA button when data.cta_url is present', () => {
  const r = renderDbTemplate(
    { subject: 'S', body: 'Hello {{reset_url}}', client_facing: false },
    {
      reset_url: 'https://x.test/verify?a=1&b=2',
      cta_url: 'https://x.test/verify?a=1&b=2',
      cta_label: 'Set new password',
    },
  );
  expect(r.html).toContain('<a href="https://x.test/verify?a=1&amp;b=2"');
  expect(r.html).toContain('Set new password');
  // Plain-text version keeps the raw (unescaped) URL from the body.
  expect(r.text).toContain('https://x.test/verify?a=1&b=2');
});

it('renders no CTA button without data.cta_url', () => {
  const r = renderDbTemplate({ subject: 'S', body: 'Hi', client_facing: false }, {});
  expect(r.html).not.toContain('<a href=');
});
```

Also add `renderDbTemplate` to the existing import from `./templates`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- supabase/functions/send-email/templates.test.ts`
Expected: FAIL — `r.html` does not contain the anchor.

- [ ] **Step 3: Implement**

In `supabase/functions/send-email/templates.ts`, inside `renderDbTemplate`, after the existing unsubscribe-footer block and before the `const html = shell(...)` line, add:

```ts
  // Transactional emails (e.g. password reset) pass cta_url/cta_label to get
  // a styled action button under the body text. Text version is unchanged —
  // bodies that need a plain link carry it via a {{variable}}.
  let cta = '';
  if (data.cta_url) {
    const url = escapeHtml(String(data.cta_url));
    const label = escapeHtml(String(data.cta_label ?? 'Άνοιγμα / Open'));
    cta = `<p style="margin:24px 0"><a href="${url}" style="background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
  }
```

and change the `html` line to include it:

```ts
  const html = shell(
    `<p>${escapeHtml(bodyText).replace(/\n/g, '<br/>')}</p>${cta}${footer}`,
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- supabase/functions/send-email/templates.test.ts`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-email/templates.ts supabase/functions/send-email/templates.test.ts
git commit -m "feat(auth-reset): CTA button support in renderDbTemplate"
git push
```

---

### Task 3: Webhook signature verification (`auth-email/hook.ts`)

Supabase signs "send email" hook requests with the standard-webhooks scheme: HMAC-SHA256 over `` `${webhook-id}.${webhook-timestamp}.${body}` ``, base64, sent as `webhook-signature: v1,<sig>` (possibly several space-separated entries). The secret from the dashboard looks like `v1,whsec_<base64>`. Pure Web Crypto — works in both Deno and the Vitest/Node runtime, no dependencies.

**Files:**
- Create: `supabase/functions/auth-email/hook.ts`
- Test: `supabase/functions/auth-email/hook.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/auth-email/hook.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- supabase/functions/auth-email/hook.test.ts`
Expected: FAIL — `hook.ts` does not exist.

- [ ] **Step 3: Implement**

Create `supabase/functions/auth-email/hook.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- supabase/functions/auth-email/hook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-email/hook.ts supabase/functions/auth-email/hook.test.ts
git commit -m "feat(auth-reset): webhook signature verification for the auth-email hook"
git push
```

---

### Task 4: Recovery-email construction (`buildRecoveryEmail`)

**Files:**
- Modify: `supabase/functions/auth-email/hook.ts`
- Test: `supabase/functions/auth-email/hook.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/auth-email/hook.test.ts` (and add `buildRecoveryEmail` to the import from `./hook`):

```ts
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
    expect(out!.data.reset_url).toBe(
      `${SUPABASE_URL}/auth/v1/verify?token_hash=abc123&type=recovery` +
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- supabase/functions/auth-email/hook.test.ts`
Expected: FAIL — `buildRecoveryEmail` is not exported.

- [ ] **Step 3: Implement**

Append to `supabase/functions/auth-email/hook.ts`:

```ts
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

  const resetUrl =
    `${supabaseUrl}/auth/v1/verify?token_hash=${encodeURIComponent(tokenHash)}` +
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- supabase/functions/auth-email/hook.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-email/hook.ts supabase/functions/auth-email/hook.test.ts
git commit -m "feat(auth-reset): build recovery email payload from the auth hook"
git push
```

---

### Task 5: `auth-email` server wiring + deploy

Thin `Deno.serve` wrapper: verify signature → build → POST to `send-email` with the service key. No unit test (all logic lives in hook.ts); verified end-to-end in Task 8.

**Files:**
- Create: `supabase/functions/auth-email/index.ts`

- [ ] **Step 1: Implement**

Create `supabase/functions/auth-email/index.ts`:

```ts
// Supabase Auth "send email" hook receiver. Auth POSTs here (signed,
// standard-webhooks) instead of emailing the user itself; we deliver via the
// send-email function so templates, identities, and email_log stay unified.
// Deployed with --no-verify-jwt: callers authenticate via webhook signature.
import { verifyWebhookSignature, buildRecoveryEmail, type SendEmailHookPayload } from './hook.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !HOOK_SECRET) return json({ error: 'Server misconfigured' }, 500);

  const payloadText = await req.text();
  const ok = await verifyWebhookSignature({
    secret: HOOK_SECRET,
    msgId: req.headers.get('webhook-id') ?? '',
    timestamp: req.headers.get('webhook-timestamp') ?? '',
    signatureHeader: req.headers.get('webhook-signature') ?? '',
    payload: payloadText,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(payloadText) as SendEmailHookPayload;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const email = buildRecoveryEmail(payload, SUPABASE_URL);
  if (!email) {
    // Only recovery is wired; never log the payload (it carries the token).
    console.warn('auth-email: unhandled email_action_type', payload.email_data?.email_action_type);
    return json({ skipped: true });
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: 'internal',
      to: email.to,
      templateKey: email.templateKey,
      data: email.data,
    }),
  });
  const result = (await res.json().catch(() => ({}))) as { status?: string };
  if (!res.ok || result.status === 'failed') return json({ error: 'send_failed' }, 500);
  return json({ sent: true });
});
```

- [ ] **Step 2: Verify lint + full test suite still pass**

Run: `npm run lint && npm run test:run`
Expected: lint clean; all tests PASS.

- [ ] **Step 3: Deploy**

Run:
```bash
supabase functions deploy auth-email --no-verify-jwt --project-ref xujlrclyzxrvxszepquy
```
Expected: deploy succeeds. (`--no-verify-jwt` is required — Auth's hook call carries a webhook signature, not a user JWT.)

- [ ] **Step 4: Sanity-check rejection of unsigned calls**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://xujlrclyzxrvxszepquy.supabase.co/functions/v1/auth-email" \
  -H "Content-Type: application/json" -d '{}'
```
Expected: `401` (or `500` if `SEND_EMAIL_HOOK_SECRET` is not yet set — it's configured in Task 8).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-email/index.ts
git commit -m "feat(auth-reset): auth-email hook function — verify, build, relay to send-email"
git push
```

---

### Task 6: ForgotPasswordPage + login link + route + i18n

**Files:**
- Create: `src/features/auth/ForgotPasswordPage.tsx`
- Test: `src/features/auth/ForgotPasswordPage.test.tsx`
- Modify: `src/features/auth/LoginPage.tsx` (link under the form)
- Modify: `src/features/auth/LoginPage.test.tsx` (assert the link)
- Modify: `src/app/router.tsx` (route)
- Modify: `src/i18n/locales/en/auth.json`, `src/i18n/locales/el/auth.json`

- [ ] **Step 1: Add i18n strings**

In `src/i18n/locales/en/auth.json`, add `"forgot_password": "Forgot password?"` to the `login` object, and a new top-level section:

```json
  "forgot_password": {
    "title": "Reset your password",
    "description": "Enter your account email and we'll send you a reset link.",
    "email": "Email",
    "submit": "Send reset link",
    "submitting": "Sending…",
    "sent_notice": "If an account exists with this email, we've sent a reset link. Check your inbox.",
    "back_to_login": "Back to sign in"
  }
```

In `src/i18n/locales/el/auth.json`, add `"forgot_password": "Ξέχασες τον κωδικό;"` to `login`, and:

```json
  "forgot_password": {
    "title": "Επαναφορά κωδικού",
    "description": "Γράψε το email του λογαριασμού σου και θα σου στείλουμε σύνδεσμο επαναφοράς.",
    "email": "Email",
    "submit": "Αποστολή συνδέσμου",
    "submitting": "Αποστολή…",
    "sent_notice": "Αν υπάρχει λογαριασμός με αυτό το email, στείλαμε σύνδεσμο επαναφοράς. Έλεγξε τα εισερχόμενά σου.",
    "back_to_login": "Πίσω στη σύνδεση"
  }
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/auth/ForgotPasswordPage.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const { resetMock } = vi.hoisted(() => ({
  resetMock: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: resetMock } },
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter initialEntries={['/forgot-password']}>{ui}</MemoryRouter>;
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    resetMock.mockClear();
    resetMock.mockResolvedValue({ data: {}, error: null });
  });

  it('renders the email field and submit button', () => {
    render(wrap(<ForgotPasswordPage />));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('submits and shows the uniform notice with the right redirect', async () => {
    render(wrap(<ForgotPasswordPage />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@itdev.gr' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(resetMock).toHaveBeenCalledWith('user@itdev.gr', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it('shows the same notice even when the request fails (no enumeration)', async () => {
    resetMock.mockResolvedValue({ data: null, error: { message: 'rate limit' } });
    render(wrap(<ForgotPasswordPage />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@itdev.gr' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
```

In `src/features/auth/LoginPage.test.tsx`, add inside the existing `describe`:

```tsx
  it('links to the forgot-password page', () => {
    render(wrap(<LoginPage />));
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:run -- src/features/auth`
Expected: FAIL — `ForgotPasswordPage` doesn't exist; LoginPage link missing.

- [ ] **Step 4: Implement the page**

Create `src/features/auth/ForgotPasswordPage.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

const schema = z.object({ email: z.string().email() });

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    // Uniform outcome regardless of result: never reveal whether the email
    // has an account (also swallows Supabase's rate-limit error).
    try {
      await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // intentionally ignored
    }
    setSent(true);
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('forgot_password.title')}</h1>
      {sent ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('forgot_password.sent_notice')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('forgot_password.description')}</p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">{t('forgot_password.email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
            </div>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? t('forgot_password.submitting') : t('forgot_password.submit')}
            </Button>
          </form>
        </>
      )}
      <Link to="/login" className="block text-sm underline">
        {t('forgot_password.back_to_login')}
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Add the login link and route**

In `src/features/auth/LoginPage.tsx`:
- Add `Link` to the react-router-dom import: `import { useNavigate, useLocation, Link } from 'react-router-dom';`
- After the closing `</form>` tag, add:

```tsx
      <Link to="/forgot-password" className="block text-sm underline">
        {t('login.forgot_password')}
      </Link>
```

In `src/app/router.tsx`:
- Next to the `LoginPage` lazyPage declaration, add:

```tsx
const ForgotPasswordPage = lazyPage(
  () => import('@/features/auth/ForgotPasswordPage'),
  'ForgotPasswordPage',
);
```

- Next to the `/login` route entry, add:

```tsx
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- src/features/auth`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/auth/ForgotPasswordPage.tsx src/features/auth/ForgotPasswordPage.test.tsx \
  src/features/auth/LoginPage.tsx src/features/auth/LoginPage.test.tsx \
  src/app/router.tsx src/i18n/locales/en/auth.json src/i18n/locales/el/auth.json
git commit -m "feat(auth-reset): forgot-password page + login link"
git push
```

---

### Task 7: ResetPasswordPage + route + i18n

The reset link lands here. A valid link arrives with a recovery session (`#access_token=…` in the hash; the existing auth listener hydrates the store). An expired/used link arrives with error params (`#error=access_denied&error_code=otp_expired`). Reuses `useChangePassword`, which updates the password and clears `must_change_password`.

**Files:**
- Create: `src/features/auth/ResetPasswordPage.tsx`
- Test: `src/features/auth/ResetPasswordPage.test.tsx`
- Modify: `src/app/router.tsx` (route)
- Modify: `src/i18n/locales/en/auth.json`, `src/i18n/locales/el/auth.json`

- [ ] **Step 1: Add i18n strings**

In `src/i18n/locales/en/auth.json`, add:

```json
  "reset_password": {
    "title": "Choose a new password",
    "description": "Set a new password for your account.",
    "new_password": "New password",
    "confirm_password": "Confirm password",
    "submit": "Save new password",
    "submitting": "Saving…",
    "error_mismatch": "Passwords do not match.",
    "error_too_short": "Password must be at least 8 characters.",
    "error_generic": "Could not update the password. Request a new link and try again.",
    "expired_title": "Link expired",
    "expired_description": "This reset link has expired or was already used.",
    "request_new": "Request a new link"
  }
```

In `src/i18n/locales/el/auth.json`, add:

```json
  "reset_password": {
    "title": "Ορισμός νέου κωδικού",
    "description": "Όρισε νέο κωδικό για τον λογαριασμό σου.",
    "new_password": "Νέος κωδικός",
    "confirm_password": "Επιβεβαίωση κωδικού",
    "submit": "Αποθήκευση νέου κωδικού",
    "submitting": "Αποθήκευση…",
    "error_mismatch": "Οι κωδικοί δεν ταιριάζουν.",
    "error_too_short": "Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.",
    "error_generic": "Δεν ήταν δυνατή η αλλαγή του κωδικού. Ζήτησε νέο σύνδεσμο και δοκίμασε ξανά.",
    "expired_title": "Ο σύνδεσμος έληξε",
    "expired_description": "Ο σύνδεσμος επαναφοράς έληξε ή έχει ήδη χρησιμοποιηθεί.",
    "request_new": "Ζήτησε νέο σύνδεσμο"
  }
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/auth/ResetPasswordPage.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import { ResetPasswordPage } from './ResetPasswordPage';

const { mutateAsync, navigateMock } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  navigateMock: vi.fn(),
}));
vi.mock('./hooks/useChangePassword', () => ({
  useChangePassword: () => ({ mutateAsync, isPending: false, isError: false }),
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter initialEntries={['/reset-password']}>{ui}</MemoryRouter>;
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    navigateMock.mockClear();
    useAuthStore.getState().reset();
    window.history.replaceState(null, '', '/reset-password');
  });

  it('shows the expired state when the link carries an error', () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password#error=access_denied&error_code=otp_expired',
    );
    render(wrap(<ResetPasswordPage />));
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows the expired state when there is no recovery session', () => {
    render(wrap(<ResetPasswordPage />));
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
  });

  it('with a session: renders the form, saves, and redirects home', async () => {
    useAuthStore.getState().setSession(null, { id: 'u1' } as User);
    render(wrap(<ResetPasswordPage />));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('brandnewpass1'));
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  it('rejects mismatched passwords without calling the mutation', async () => {
    useAuthStore.getState().setSession(null, { id: 'u1' } as User);
    render(wrap(<ResetPasswordPage />));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'different1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:run -- src/features/auth/ResetPasswordPage.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 4: Implement the page**

Create `src/features/auth/ResetPasswordPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from './hooks/useChangePassword';
import { useAuthStore } from '@/lib/stores/authStore';

const schema = z
  .object({
    new_password: z.string().min(8),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'mismatch',
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const change = useChangePassword();
  const user = useAuthStore((s) => s.user);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  // Supabase redirects here after verifying the email link. A valid link
  // carries a recovery session in the hash (#access_token=…, hydrated by the
  // auth listener); an expired or used link carries error params instead.
  const hash = window.location.hash;
  const linkFailed = hash.includes('error=') || hash.includes('error_code=');
  const hasRecovery = Boolean(user) || hash.includes('access_token=');

  if (linkFailed || !hasRecovery) {
    return (
      <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
        <h1 className="text-2xl font-bold">{t('reset_password.expired_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reset_password.expired_description')}</p>
        <Link to="/forgot-password" className="block text-sm underline">
          {t('reset_password.request_new')}
        </Link>
      </div>
    );
  }

  async function onSubmit(values: FormValues) {
    try {
      await change.mutateAsync(values.new_password);
      navigate('/', { replace: true });
    } catch {
      // error rendered below via change.isError
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('reset_password.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('reset_password.description')}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="new_password">{t('reset_password.new_password')}</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            {...register('new_password')}
          />
          {formState.errors.new_password && (
            <p className="mt-1 text-sm text-red-600">{t('reset_password.error_too_short')}</p>
          )}
        </div>
        <div>
          <Label htmlFor="confirm_password">{t('reset_password.confirm_password')}</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            {...register('confirm_password')}
          />
          {formState.errors.confirm_password && (
            <p className="mt-1 text-sm text-red-600">{t('reset_password.error_mismatch')}</p>
          )}
        </div>
        {change.isError && (
          <p role="alert" className="text-sm text-red-600">
            {t('reset_password.error_generic')}
          </p>
        )}
        <Button type="submit" disabled={change.isPending || formState.isSubmitting}>
          {change.isPending ? t('reset_password.submitting') : t('reset_password.submit')}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Add the route**

In `src/app/router.tsx`:
- Next to the `ForgotPasswordPage` lazyPage declaration, add:

```tsx
const ResetPasswordPage = lazyPage(
  () => import('@/features/auth/ResetPasswordPage'),
  'ResetPasswordPage',
);
```

- Next to the `/forgot-password` route entry, add:

```tsx
  { path: '/reset-password', element: <ResetPasswordPage /> },
```

- [ ] **Step 6: Run the full suite + lint to verify everything passes**

Run: `npm run lint && npm run test:run`
Expected: lint clean, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/auth/ResetPasswordPage.tsx src/features/auth/ResetPasswordPage.test.tsx \
  src/app/router.tsx src/i18n/locales/en/auth.json src/i18n/locales/el/auth.json
git commit -m "feat(auth-reset): reset-password page with expired-link state"
git push
```

---

### Task 8: Dashboard configuration + end-to-end smoke

The frontend deploys automatically via Vercel on push. What remains is Supabase Auth configuration (dashboard, done by Marios or with his session) and a real end-to-end check.

- [ ] **Step 1: Configure the Send Email Hook (dashboard)**

In the Supabase dashboard (project `xujlrclyzxrvxszepquy`):
1. **Authentication → Hooks → Send Email Hook** → Enable, type **HTTPS**, URL:
   `https://xujlrclyzxrvxszepquy.supabase.co/functions/v1/auth-email`
2. Click **Generate secret** and copy it (format `v1,whsec_…`).

- [ ] **Step 2: Store the hook secret and restart the function**

```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET="<paste the generated secret>" --project-ref xujlrclyzxrvxszepquy
supabase functions deploy auth-email --no-verify-jwt --project-ref xujlrclyzxrvxszepquy
```
(Secret value never goes into any committed file.)

- [ ] **Step 3: Allow-list the redirect URL (dashboard)**

**Authentication → URL Configuration → Redirect URLs**: add `https://app.itdev.gr/reset-password` (the production domain — `APP_BASE` in `supabase/functions/send-email/templates.ts`; confirm it matches the live Vercel domain, and use that domain if it differs) and `http://localhost:5173/reset-password` for local dev. Without this, Supabase rejects the `redirectTo` and falls back to the Site URL.

- [ ] **Step 4: Dry-run smoke**

```bash
supabase secrets set EMAIL_DRY_RUN=true --project-ref xujlrclyzxrvxszepquy
supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy
```
On the production app: log out → **Forgot password?** → enter your real account email → submit. Verify:
- The page shows the uniform notice.
- `email_log` has a new row: `template_key = 'auth_password_reset'`, `identity = 'internal'`, `status = 'sent'`, `resend_id = 'dry-run'`.

- [ ] **Step 5: Real end-to-end**

```bash
supabase secrets set EMAIL_DRY_RUN=false --project-ref xujlrclyzxrvxszepquy
supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy
```
Repeat the flow with your real email. Verify:
- Bilingual email arrives from `ITDEV <noreply@itdev.gr>` with the button.
- The button opens `/reset-password` with the new-password form; saving signs you in and lands on Home.
- Sign out, sign in with the new password — works. (Reset it back afterwards if you used a throwaway value.)
- Click the same email link again — the expired/used state appears with a "Request a new link" link.

- [ ] **Step 6: Final verification + done**

Run: `npm run lint && npm run test:run`
Expected: clean. Mark the feature done.

---

## Changes / Revert

| Change | Revert |
|---|---|
| Migration `20260611000002_auth_password_reset_template.sql` | `delete from public.email_templates where key = 'auth_password_reset';` (in migration header) |
| `renderDbTemplate` CTA support (Task 2 commit) | `git revert` the Task 2 commit |
| New edge function `auth-email` (Tasks 3–5 commits) | `git revert` the commits; `supabase functions delete auth-email --project-ref xujlrclyzxrvxszepquy` |
| Frontend pages/routes/link/i18n (Tasks 6–7 commits) | `git revert` the commits |
| Dashboard: Send Email Hook + `SEND_EMAIL_HOOK_SECRET` + redirect URLs | Disable the hook, unset the secret (`supabase secrets unset SEND_EMAIL_HOOK_SECRET --project-ref xujlrclyzxrvxszepquy`), remove the redirect URLs |

Disabling the Send Email Hook alone restores pre-feature behavior (Supabase would send its default recovery email, but nothing in the app links to it).
