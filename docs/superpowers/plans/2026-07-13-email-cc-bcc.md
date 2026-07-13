# Email CC/BCC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRM composes gain Cc (everyone) and Bcc (admin-only end-to-end: field, server acceptance, and recorded visibility), across personal Gmail and shared-identity Resend sends, with capture + display.

**Architecture:** A dependency-free `_shared/recipients.ts` validates/parses recipient lists for both runtimes. The send-email fn validates cc/bcc, 403s non-admin bcc, emits Cc/Bcc MIME headers (personal) or Resend cc/bcc arrays (custom), and mirrors `cc_emails` + an admin-only `email_message_bcc` row. gmail-sync parses Cc/Bcc headers on captured mail (Bcc exists only on the sender's sent copy). The Emails tabs show Cc to everyone; admins fetch Bcc through the RLS-guarded table.

**Tech Stack:** React + Vite + vitest, Supabase edge functions (Deno) + Postgres RLS, Gmail API raw MIME, Resend API. Prod project `xujlrclyzxrvxszepquy`.

**Spec:** `docs/superpowers/specs/2026-07-13-email-cc-bcc-design.md` — read it first.

## Global Constraints

- `npm run build` (= `tsc -b && eslint . --max-warnings=0 && vite build`) MUST pass after every task.
- **NEVER run the full vitest suite** (hits PROD Supabase). Run only the test files named in each task.
- Migrations NOT applied / edge fns NOT deployed until Task 6.
- Recipient rules (exact): comma-separated, each matches `^[^@\s]+@[^@\s]+\.[^@\s]+$`, no `\r`/`\n`, lowercased + deduped, **max 10 per field**; any invalid entry rejects the whole list.
- **Bcc is admin-only entirely**: UI field hidden for non-admins AND the server rejects non-admin `bcc` with 403 `bcc_admin_only`. Recorded bcc lives ONLY in `email_message_bcc` (admin-only SELECT RLS).
- `deno check --node-modules-dir=auto <fn>/index.ts` must be clean for touched fns.
- Commit per task; push only in Task 6. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The owner's parallel sessions commit in this same tree — `git status` before each commit; stage ONLY the files this plan names. Anchor edits by surrounding code, not line numbers.

---

### Task 1: Migration — `cc_emails` column + admin-only `email_message_bcc`

**Files:**
- Create: `supabase/migrations/20260713180000_email_cc_bcc.sql`

**Interfaces:**
- Produces: `email_messages.cc_emails text` (comma-joined, visible under existing RLS); table `email_message_bcc(message_pk uuid PK → email_messages.id, bcc_emails text)` with SELECT limited to `current_user_is_admin()`. The `job_emails` RPC returns `setof public.email_messages`, so it picks up `cc_emails` automatically — no RPC change.

- [x] **Step 1: Write the migration**

```sql
-- =============================================================================
-- CC/BCC for CRM email (spec 2026-07-13-email-cc-bcc-design.md).
-- cc_emails: comma-joined, visible to whoever can see the message (existing
-- department RLS). Bcc is admin-only END TO END, so it lives in a separate
-- table whose SELECT policy is admin-only — row-level security can't hide a
-- column, hence the side table. Writes are service-role only (edge fns).
-- job_emails() returns setof email_messages and inherits cc_emails as-is.
-- =============================================================================

alter table public.email_messages add column if not exists cc_emails text;

create table if not exists public.email_message_bcc (
  message_pk uuid primary key references public.email_messages(id) on delete cascade,
  bcc_emails text not null,
  created_at timestamptz not null default now()
);

alter table public.email_message_bcc enable row level security;

drop policy if exists email_message_bcc_admin_select on public.email_message_bcc;
create policy email_message_bcc_admin_select on public.email_message_bcc
  for select using (public.current_user_is_admin());
-- No INSERT/UPDATE/DELETE policies: only service-role edge functions write.

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop table if exists public.email_message_bcc;
--   alter table public.email_messages drop column if exists cc_emails;
--   notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
```

- [x] **Step 2: Gate** — Run `npm run build` (exit 0; proves the tree is otherwise clean).

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/20260713180000_email_cc_bcc.sql
git commit -m "feat(email): cc_emails column + admin-only email_message_bcc table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Recipient parsing helpers + MIME Cc/Bcc (TDD)

**Files:**
- Create: `supabase/functions/_shared/recipients.ts`
- Modify: `supabase/functions/_shared/google.ts` (`buildMime`, and `getGmailMessageFull` is Task 4 — do NOT touch it here)
- Test: `src/features/email/recipients.test.ts`

**Interfaces:**
- Produces: `parseRecipientList(v: unknown): string[] | null` (null = invalid input present; `[]` = empty/absent) and `parseAddressList(header: string): string[]` (lenient header→emails, for capture) from `_shared/recipients.ts`; `buildMime(m: { from: string; to: string; subject: string; html: string; cc?: string[]; bcc?: string[] })`.

- [x] **Step 1: Write the failing test** — create `src/features/email/recipients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseRecipientList,
  parseAddressList,
} from '../../../supabase/functions/_shared/recipients.ts';

describe('parseRecipientList', () => {
  it('accepts a comma string, trims, lowercases, dedupes', () => {
    expect(parseRecipientList(' A@b.gr , c@d.gr,, a@B.gr ')).toEqual(['a@b.gr', 'c@d.gr']);
  });
  it('accepts an array', () => {
    expect(parseRecipientList(['a@b.gr', 'C@d.gr'])).toEqual(['a@b.gr', 'c@d.gr']);
  });
  it('returns [] for empty/absent input', () => {
    expect(parseRecipientList(undefined)).toEqual([]);
    expect(parseRecipientList('')).toEqual([]);
    expect(parseRecipientList([])).toEqual([]);
  });
  it('returns null when any entry is invalid', () => {
    expect(parseRecipientList('a@b.gr, not-an-email')).toBeNull();
    expect(parseRecipientList('a@b.gr, x@y')).toBeNull();
  });
  it('returns null on header-injection attempts', () => {
    expect(parseRecipientList('a@b.gr\r\nBcc: evil@x.gr')).toBeNull();
  });
  it('returns null above 10 recipients', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.gr`).join(',');
    expect(parseRecipientList(eleven)).toBeNull();
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}@x.gr`).join(',');
    expect(parseRecipientList(ten)).toHaveLength(10);
  });
  it('rejects non-string non-array input', () => {
    expect(parseRecipientList(42)).toBeNull();
    expect(parseRecipientList({})).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('parses a Cc header with display names', () => {
    expect(parseAddressList('"K, Maria" <m@itdev.gr>, plain@x.gr')).toEqual([
      'm@itdev.gr',
      'plain@x.gr',
    ]);
  });
  it('returns [] for empty header', () => {
    expect(parseAddressList('')).toEqual([]);
  });
  it('drops unparsable fragments instead of failing', () => {
    expect(parseAddressList('m@itdev.gr, garbage')).toEqual(['m@itdev.gr']);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/features/email/recipients.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `supabase/functions/_shared/recipients.ts`**

```ts
// Recipient-list parsing shared by the send-email edge fn (validation), the
// gmail-sync capture (header parsing), and the frontend compose dialog
// (client-side validation). Dependency-free — importable by Deno and Vite.

const ADDR_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_RECIPIENTS = 10;

/**
 * Strict validation for caller-supplied cc/bcc. Accepts a comma-separated
 * string or an array of strings. Returns lowercased, deduped emails; [] when
 * absent/empty; null when ANY entry is invalid, contains CR/LF, or the list
 * exceeds 10 — callers must reject the request on null.
 */
export function parseRecipientList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  let parts: string[];
  if (typeof v === 'string') {
    if (/[\r\n]/.test(v)) return null;
    parts = v.split(',');
  } else if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === 'string')) return null;
    if (v.some((x) => /[\r\n]/.test(x))) return null;
    parts = v;
  } else {
    return null;
  }
  const out: string[] = [];
  for (const p of parts) {
    const e = p.trim().toLowerCase();
    if (e === '') continue;
    if (!ADDR_RE.test(e)) return null;
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) return null;
  return out;
}

/**
 * Lenient parsing for captured mail headers ("Name" <a@b.gr>, c@d.gr, …).
 * Splits on commas OUTSIDE double quotes, extracts the mailbox from <…> or
 * a bare address, lowercases, drops fragments that yield no valid address.
 */
export function parseAddressList(header: string): string[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/<([^>]+)>/);
    const cand = (m ? m[1] : p).trim().toLowerCase();
    if (ADDR_RE.test(cand) && !out.includes(cand)) out.push(cand);
  }
  return out;
}
```

- [x] **Step 4: Run to verify pass**

Run: `npm run test:run -- src/features/email/recipients.test.ts`
Expected: PASS (all).

- [x] **Step 5: `buildMime` gains Cc/Bcc headers** — in `supabase/functions/_shared/google.ts` replace the current `buildMime` with:

```ts
export function buildMime(m: { from: string; to: string; subject: string; html: string; cc?: string[]; bcc?: string[] }): string {
  const subj = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(m.subject)))}?=`;
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc && m.cc.length > 0 ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.bcc && m.bcc.length > 0 ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${subj}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(m.html))),
  ];
  return b64url(enc.encode(lines.join('\r\n')));
}
```
(Gmail delivers to Bcc recipients and strips the header from their copies; the sender's sent copy retains it — that's how capture records it in Task 4. The cc/bcc values are pre-validated by `parseRecipientList`, which guarantees no CR/LF injection.)

- [x] **Step 6: Gates** — `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts` clean; `npm run build` exit 0.

- [x] **Step 7: Commit**

```bash
git add supabase/functions/_shared/recipients.ts supabase/functions/_shared/google.ts src/features/email/recipients.test.ts
git commit -m "feat(email): recipient-list parsing + Cc/Bcc MIME headers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: send-email — validate, admin-gate bcc, send, mirror

**Files:**
- Modify: `supabase/functions/send-email/index.ts`

**Interfaces:**
- Consumes: `parseRecipientList` (Task 2), `buildMime` with cc/bcc (Task 2).
- Produces: request body accepts top-level `cc?: string[] | string`, `bcc?: string[] | string` for `identity==='personal'` and for single-send `templateKey==='custom'`; 400 `invalid_recipient` on bad lists; 403 `bcc_admin_only` for non-admin bcc. Mirrored rows carry `cc_emails`; bcc mirrored into `email_message_bcc`.

- [x] **Step 1: Extend `SendInput` and imports**

Add to the imports: `import { parseRecipientList } from '../_shared/recipients.ts';`
Extend the type:
```ts
type SendInput = {
  identity: Identity;
  to: string;
  templateKey: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  dryRun?: boolean;
  attachments?: AttachmentRef[];
  cc?: string[] | string;
  bcc?: string[] | string;
};
```

- [x] **Step 2: Personal branch — validate + gate + pass through**

In the `identity === 'personal'` branch of the handler (after `getUser` succeeds), replace the `sendPersonal` call block with:

```ts
    const cc = parseRecipientList(body.cc);
    const bcc = parseRecipientList(body.bcc);
    if (cc === null || bcc === null) return json({ error: 'invalid_recipient' }, 400);
    if (bcc.length > 0) {
      const { data: prof } = await admin.from('profiles').select('is_admin').eq('user_id', u.user.id).maybeSingle();
      if (!prof?.is_admin) return json({ error: 'bcc_admin_only' }, 403);
    }
    const r = await sendPersonal(u.user.id, body.to, body.data ?? {}, body.dedupeKey ?? null, cc, bcc);
```

Change `sendPersonal`'s signature and its `buildMime` call:
```ts
async function sendPersonal(uid: string, to: string, data: Record<string, unknown>, dedupeKey: string | null, cc: string[] = [], bcc: string[] = []): Promise<{ status: 'sent' | 'failed' | 'skipped' | 'not_connected'; id?: string; error?: string }> {
```
```ts
  const raw = buildMime({ from: acct.google_email, to, subject, html, cc, bcc });
```

- [x] **Step 3: Single-send branch — validate + gate**

In the non-service-role single-send validation section (inside `if (!isServiceRole) { … }`, after the recipient regex check), add:

```ts
    // cc/bcc are compose-time fields: honored only on ad-hoc `custom` sends.
    if (String(body.templateKey) !== 'custom' && (body.cc || body.bcc)) {
      return json({ error: 'invalid_recipient' }, 400);
    }
    const ccList = parseRecipientList(body.cc);
    const bccList = parseRecipientList(body.bcc);
    if (ccList === null || bccList === null) return json({ error: 'invalid_recipient' }, 400);
    if (bccList.length > 0) {
      const { data: bccProf } = await admin.from('profiles').select('is_admin').eq('user_id', uid).maybeSingle();
      if (!bccProf?.is_admin) return json({ error: 'bcc_admin_only' }, 403);
    }
    body.cc = ccList;
    body.bcc = bccList;
```
(Service-role callers — the drain — never pass cc/bcc; `parseRecipientList(undefined)` in `sendOne` handles absence.)

- [x] **Step 4: `sendOne` — Resend payload + mirror**

At the top of `sendOne`, after the destructuring line, add:
```ts
  const userCc = parseRecipientList(input.cc) ?? [];
  const userBcc = parseRecipientList(input.bcc) ?? [];
```
Change the Resend payload's cc handling — replace `...(cc ? { cc } : {}),` with:
```ts
      ...((cc || userCc.length > 0)
        ? { cc: [...(cc ? [cc] : []), ...userCc] }
        : {}),
      ...(userBcc.length > 0 ? { bcc: userBcc } : {}),
```
(`cc` stays the existing department/rep CC string; Resend accepts an array.)

In the mirroring block, extend the upsert row with:
```ts
          cc_emails: [...(cc ? [cc.toLowerCase()] : []), ...userCc].join(',') || null,
```
and after the upsert (inside the same `try`), add the bcc mirror:
```ts
        if (userBcc.length > 0) {
          const { data: mrow } = await admin
            .from('email_messages')
            .select('id')
            .eq('message_id', `resend:${body.id ?? ''}`)
            .maybeSingle();
          if (mrow) {
            await admin.from('email_message_bcc').upsert(
              { message_pk: mrow.id, bcc_emails: userBcc.join(',') },
              { onConflict: 'message_pk' },
            );
          }
        }
```
NOTE: the mirror upsert currently generates `message_id: \`resend:${body.id ?? crypto.randomUUID()}\`` inline — hoist it to a const before the upsert so the bcc lookup uses the same value:
```ts
        const mirrorMessageId = `resend:${body.id ?? crypto.randomUUID()}`;
```
and use `message_id: mirrorMessageId` in the upsert and `.eq('message_id', mirrorMessageId)` in the bcc lookup.

- [x] **Step 5: Gates** — `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts` clean; `npm run build` exit 0; regression: `npm run test:run -- src/features/email/recipients.test.ts` PASS.

- [x] **Step 6: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "feat(email): cc/bcc on personal + custom sends, admin-gated bcc, mirrored

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Capture — parse Cc/Bcc headers in gmail-sync

**Files:**
- Modify: `supabase/functions/_shared/google.ts` (`getGmailMessageFull` + the `GmailMessage` type)
- Modify: `supabase/functions/gmail-sync/index.ts` (upsert row + bcc side-write)

**Interfaces:**
- Consumes: `parseAddressList` (Task 2); table `email_message_bcc` (Task 1).
- Produces: captured rows carry `cc_emails`; sender-side sent copies with a Bcc header get an `email_message_bcc` row.

- [x] **Step 1: Parse the headers**

In `google.ts`, add to the imports: `import { parseAddressList } from './recipients.ts';`
In `getGmailMessageFull`, after `const to = parseAddress(h('To'));` add:
```ts
  const ccList = parseAddressList(h('Cc'));
  const bccList = parseAddressList(h('Bcc'));
```
and extend the returned object with:
```ts
    cc_emails: ccList.join(',') || null, bcc_emails: bccList.join(',') || null,
```
Extend the `GmailMessage` type (find its declaration in the same file) with:
```ts
  cc_emails: string | null;
  bcc_emails: string | null;
```

- [x] **Step 2: Store on capture**

In `gmail-sync/index.ts`, extend the `email_messages` upsert row with:
```ts
        cc_emails: m.cc_emails,
```
After the `if (!error) stored++; else errors++;` line, add the bcc side-write (service role bypasses RLS; only sender sent-copies ever have the header):
```ts
      if (!error && m.bcc_emails) {
        const { data: mrow } = await admin
          .from('email_messages').select('id').eq('message_id', m.message_id).maybeSingle();
        if (mrow) {
          await admin.from('email_message_bcc').upsert(
            { message_pk: mrow.id, bcc_emails: m.bcc_emails },
            { onConflict: 'message_pk' },
          );
        }
      }
```
(The lookup-by-message_id handles the `ignoreDuplicates: true` upsert returning nothing for already-captured rows.)

- [x] **Step 3: Gates** — `deno check --node-modules-dir=auto supabase/functions/gmail-sync/index.ts` clean; `npm run build` exit 0.

- [x] **Step 4: Commit**

```bash
git add supabase/functions/_shared/google.ts supabase/functions/gmail-sync/index.ts
git commit -m "feat(email): capture Cc/Bcc headers from Gmail sync

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — compose fields, thread display, i18n (TDD)

**Files:**
- Modify: `src/features/email/useSendEmail.ts`
- Modify: `src/features/email/SendEmailDialog.tsx`
- Modify: `src/features/email/hooks/useEmailThreads.ts` (`EmailMessageRow` + `COLS`)
- Create: `src/features/email/hooks/useBccEmails.ts`
- Modify: `src/features/email/EmailThreadList.tsx` (Cc/Bcc lines in `EmailMessage`)
- Modify: `src/i18n/locales/en/email.json`, `src/i18n/locales/el/email.json`
- Test: `src/features/email/SendEmailDialog.ccbcc.test.tsx`

**Interfaces:**
- Consumes: `parseRecipientList` from `../../../supabase/functions/_shared/recipients.ts` (client-side validation, same rules as the server); `useAuthStore((s) => s.isAdmin)`.
- Produces: `SendEmailVars` gains `cc?: string[]`, `bcc?: string[]`; `useBccEmails(messageIds: string[]): Map<string, string>` (admin-only fetch; empty map otherwise).

- [x] **Step 1: Write the failing dialog test** — create `src/features/email/SendEmailDialog.ccbcc.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockIsAdmin = vi.fn<() => boolean>(() => false);
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: mockIsAdmin() }),
}));
vi.mock('./useSendEmail', () => ({
  useSendEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./useGoogleConnection', () => ({
  useGoogleConnection: () => ({ connected: true, isLoading: false, connect: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('./SignaturePreview', () => ({ MySignaturePreview: () => null }));

import { SendEmailDialog } from './SendEmailDialog';

const base = { open: true, identity: 'personal' as const, to: 'a@b.gr', subject: 's', body: 'b', onClose: () => {} };

describe('SendEmailDialog cc/bcc fields', () => {
  it('shows Cc but hides Bcc for non-admins', () => {
    mockIsAdmin.mockReturnValue(false);
    render(<SendEmailDialog {...base} />);
    expect(screen.getByLabelText(/^Cc/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Bcc/i)).not.toBeInTheDocument();
  });
  it('shows Bcc for admins', () => {
    mockIsAdmin.mockReturnValue(true);
    render(<SendEmailDialog {...base} />);
    expect(screen.getByLabelText(/^Bcc/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/features/email/SendEmailDialog.ccbcc.test.tsx`
Expected: FAIL — no Cc field exists.

- [x] **Step 3: `useSendEmail` vars**

```ts
export type SendEmailVars = {
  identity: 'sales' | 'accounting' | 'internal' | 'personal';
  to: string;
  subject: string;
  body: string; // plain text; newlines become <br/> in html
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  dedupeKey?: string | undefined;
};
```
and in the invoke body add, after `dedupeKey`:
```ts
          ...(vars.cc && vars.cc.length > 0 ? { cc: vars.cc } : {}),
          ...(vars.bcc && vars.bcc.length > 0 ? { bcc: vars.bcc } : {}),
```

- [x] **Step 4: Dialog fields + validation**

In `SendEmailDialog.tsx`: add imports
```tsx
import { useAuthStore } from '@/lib/stores/authStore';
import { parseRecipientList } from '../../../supabase/functions/_shared/recipients.ts';
```
add state + admin flag inside the component:
```tsx
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [ccText, setCcText] = useState('');
  const [bccText, setBccText] = useState('');
```
insert the two fields directly after the To `<label>` block:
```tsx
            <label className="mt-3 block text-sm">{t('dialog.cc', { defaultValue: 'Cc' })}
              <input aria-label={t('dialog.cc', { defaultValue: 'Cc' })} value={ccText} onChange={(e) => setCcText(e.target.value)}
                placeholder={t('dialog.recipients_hint', { defaultValue: 'email, email — up to 10' })}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            {isAdmin && (
              <label className="mt-3 block text-sm">{t('dialog.bcc', { defaultValue: 'Bcc (admins only)' })}
                <input aria-label={t('dialog.bcc', { defaultValue: 'Bcc (admins only)' })} value={bccText} onChange={(e) => setBccText(e.target.value)}
                  placeholder={t('dialog.recipients_hint', { defaultValue: 'email, email — up to 10' })}
                  className="mt-1 block w-full rounded border px-2 py-1" />
              </label>
            )}
```
and change `submit()` to validate + pass them:
```tsx
  async function submit() {
    setError(null);
    if (!toEmail.trim()) return setError(t('dialog.to_required'));
    const cc = parseRecipientList(ccText);
    const bcc = parseRecipientList(bccText);
    if (cc === null || bcc === null) {
      return setError(t('dialog.invalid_recipients', { defaultValue: 'Invalid Cc/Bcc address (comma-separated, max 10).' }));
    }
    try {
      await send.mutateAsync({ identity, to: toEmail.trim(), subject: subj, body: text, cc, bcc, dedupeKey });
      setDone(true);
    } catch {
      setError(t('dialog.failed'));
    }
  }
```

- [x] **Step 5: Run the dialog test** — `npm run test:run -- src/features/email/SendEmailDialog.ccbcc.test.tsx` — Expected: PASS.

- [x] **Step 6: Thread display**

`useEmailThreads.ts`: add `cc_emails: string | null;` to `EmailMessageRow` and append `, cc_emails` to `COLS`.

Create `src/features/email/hooks/useBccEmails.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';

/** Admin-only map message_pk -> bcc_emails. RLS enforces adminship; the
 *  isAdmin gate just skips a guaranteed-empty query for everyone else. */
export function useBccEmails(messageIds: string[]): Map<string, string> {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const key = [...messageIds].sort().join(',');
  const q = useQuery({
    queryKey: ['email-bcc', key] as const,
    enabled: isAdmin && messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_message_bcc' as never)
        .select('message_pk, bcc_emails')
        .in('message_pk', messageIds);
      if (error) throw new Error(error.message);
      return data as unknown as { message_pk: string; bcc_emails: string }[];
    },
  });
  return new Map((q.data ?? []).map((r) => [r.message_pk, r.bcc_emails]));
}
```

`EmailThreadList.tsx`: in the component that renders the thread list, collect ids and fetch the map once —
```tsx
  const allIds = threads.flatMap((th) => th.messages.map((m) => m.id));
  const bccMap = useBccEmails(allIds);
```
(anchor: wherever `threads` is available before rendering; pass `bccMap` down to `EmailMessage` as a prop — `bccMap: Map<string, string>`.)
In `EmailMessage`, after the recipients row `<div className="flex flex-wrap …">…</div>` closes, insert:
```tsx
          {(message.cc_emails || bccMap.get(message.id)) && (
            <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {message.cc_emails && (
                <div className="truncate">
                  {t('thread.cc', { defaultValue: 'Cc' })}: {message.cc_emails.split(',').join(', ')}
                </div>
              )}
              {bccMap.get(message.id) && (
                <div className="truncate">
                  {t('thread.bcc', { defaultValue: 'Bcc' })}: {bccMap.get(message.id)!.split(',').join(', ')}
                </div>
              )}
            </div>
          )}
```

- [x] **Step 7: i18n** — inside `"dialog"` in `src/i18n/locales/en/email.json`:
```json
"cc": "Cc",
"bcc": "Bcc (admins only)",
"recipients_hint": "email, email — up to 10",
"invalid_recipients": "Invalid Cc/Bcc address (comma-separated, max 10)."
```
`el/email.json` `"dialog"`:
```json
"cc": "Κοιν. (Cc)",
"bcc": "Κρυφή κοιν. (Bcc — μόνο διαχειριστές)",
"recipients_hint": "email, email — έως 10",
"invalid_recipients": "Μη έγκυρη διεύθυνση Cc/Bcc (χωρισμένες με κόμμα, έως 10)."
```
Both files, inside `"thread"` (create keys alongside existing `thread.*`):
```json
"cc": "Cc",
"bcc": "Bcc"
```
(EL the same — Cc/Bcc are universal.) Validate both JSONs parse.

- [x] **Step 8: Gates**

Run: `npm run build && npm run test:run -- src/features/email/SendEmailDialog.ccbcc.test.tsx src/features/email/recipients.test.ts src/features/email/EmailThreadList.test.tsx`
Expected: build exit 0; all named tests PASS (EmailThreadList.test.tsx is pre-existing — if it fails on the new required `bccMap` prop, update ITS render calls to pass `bccMap={new Map()}`; do not change assertions).

- [x] **Step 9: Commit**

```bash
git add src/features/email/useSendEmail.ts src/features/email/SendEmailDialog.tsx \
  src/features/email/SendEmailDialog.ccbcc.test.tsx src/features/email/hooks/useEmailThreads.ts \
  src/features/email/hooks/useBccEmails.ts src/features/email/EmailThreadList.tsx \
  src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): Cc field for all, admin-only Bcc, thread Cc/Bcc display

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Rollout + live E2E (prod) — main session

⚠️ Needs a valid `sbp_` token (owner) and the owner's inbox eyeball.

- [x] **Step 1: Apply the migration** via the Management API (same recipe as prior rollouts). Verify:
```sql
select column_name from information_schema.columns
 where table_name='email_messages' and column_name='cc_emails';       -- 1 row
select policyname from pg_policies where tablename='email_message_bcc'; -- email_message_bcc_admin_select
```

- [x] **Step 2: Push** (`git pull --rebase && git push`), wait for Vercel, then deploy BOTH functions:
```bash
SUPABASE_ACCESS_TOKEN=<sbp> npx supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy --no-verify-jwt
SUPABASE_ACCESS_TOKEN=<sbp> npx supabase functions deploy gmail-sync --project-ref xujlrclyzxrvxszepquy --no-verify-jwt
```
(BOTH `--no-verify-jwt`: send-email for the drain secret, gmail-sync for its cron — check `supabase functions list` afterwards shows `verify_jwt false` for both.)

- [x] **Step 3: E2E as a NON-admin (mkifokeris, standard test pw), via Playwright:**
1. Compose from her lead → the dialog shows **Cc** but NO **Bcc** field.
2. Send to `mkifokeris@itdev.gr` with Cc `itdevgr24@gmail.com`, subject `CC E2E`. Expect "Email sent."; `email_log` row `sent`.
3. Forged-bcc rejection: `window.supabase` is NOT exposed in this app, so curl is the primary path — grab her JWT from localStorage (`sb-…-auth-token` key, `access_token` field) via the browser console, then:
```bash
curl -i -X POST 'https://xujlrclyzxrvxszepquy.supabase.co/functions/v1/send-email' \
  -H 'Authorization: Bearer <HER_JWT>' -H 'Content-Type: application/json' \
  -d '{"identity":"personal","to":"mkifokeris@itdev.gr","templateKey":"custom","data":{"subject":"x","html":"x","text":"x"},"bcc":["itdevgr24@gmail.com"]}'
```
Expected: `HTTP/2 403` with `bcc_admin_only` (curl -i so the status is visible — `functions.invoke` buries it in `error.context`).

- [x] **Step 4: E2E as an admin.** info@itdev.gr has NO Gmail connected (personal sends 409) — use an admin account WITH Gmail (e.g. marios@itdev.gr if the owner is driving) OR temporarily flip `mkifokeris` to admin for the test and back:
```sql
update public.profiles set is_admin = true  where email = 'mkifokeris@itdev.gr';
-- …run step, then:
update public.profiles set is_admin = false where email = 'mkifokeris@itdev.gr';
```
**IMPORTANT: log out and back in (or hard-refresh) after EACH flip** — `authStore.isAdmin` loads on auth-state change/page load only; a mid-session flip changes nothing in the running SPA. Keep the admin window short (she holds full admin RLS meanwhile) and VERIFY the restore with a select.
With the admin session: dialog now SHOWS Bcc → send to `mkifokeris@itdev.gr`, Bcc `itdevgr24@gmail.com`, subject `BCC E2E`. Verify:
- `email_log` `sent`; the gmail inbox `itdevgr24@gmail.com` receives it WITHOUT appearing in To/Cc (owner eyeball).
- After the next gmail-sync run (or trigger it), the captured sent copy has an `email_message_bcc` row:
```sql
select b.bcc_emails from public.email_message_bcc b
  join public.email_messages m on m.id = b.message_pk
 where m.subject = 'BCC E2E';
```
- Thread display: as admin the `BCC E2E` message shows `Bcc: itdevgr24@gmail.com`; log back in as the non-admin — the same thread shows NO Bcc line (and `select * from email_message_bcc` via her session returns 0 rows — RLS).
- The `CC E2E` message shows `Cc: itdevgr24@gmail.com` for BOTH users.

- [x] **Step 5: Close out** — restore `is_admin=false` if flipped (VERIFY with a select); remind sbp_ rotation; update memory (`project_email_conversations.md` or new note: cc/bcc mechanics + admin-only bcc table); mark plan checkboxes; ledger entry.

---

## Changes / Revert (whole feature)

**Changes:** Tasks 1–5 commits; prod: migration 20260713180000, send-email + gmail-sync redeployed.
**Revert:** git revert the commits; redeploy both fns; `drop table if exists public.email_message_bcc; alter table public.email_messages drop column if exists cc_emails; notify pgrst, 'reload schema';`
