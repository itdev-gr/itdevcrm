# IT DEV Branded Email Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email leaving the CRM ends with the branded IT DEV signature — company variant on automated client-facing emails, personal variant (name/title/phone/email from the sender's profile) on emails staff send through the CRM — with a live signature preview on My Profile.

**Architecture:** One dependency-free renderer module (`supabase/functions/_shared/signature.ts`) imported by BOTH the Deno edge function and the Vite frontend. Automated sends get the company signature inside the existing `shell()` wrapper (client-facing only); personal Gmail sends get the sender's personal signature appended in `sendPersonal()`. Old per-template text sign-offs are stripped from `email_templates` by a backed-up migration. The logo is a static Vercel asset (`public/email-assets/`).

**Tech Stack:** React 18 + Vite + vitest, Supabase edge functions (Deno), Postgres (prod project `xujlrclyzxrvxszepquy`), Resend + Gmail API.

**Spec:** `docs/superpowers/specs/2026-07-13-email-signature-design.md` — read it first.

## Global Constraints

- `npm run build` = `tsc -b && eslint . --max-warnings=0 && vite build` — MUST pass after every task. eslint lints `**/*.{ts,tsx}` including `supabase/functions`, with `--max-warnings=0`.
- **NEVER run the full vitest suite** (`npm run test:run` with no args) — tests run against PROD Supabase and there are known pre-existing fixture failures. Run only the specific test files named in each task.
- Edge-function changes are NOT live until deployed (Task 6). Migrations are NOT applied to prod until Task 6.
- Deno imports need explicit `.ts` extensions; the frontend tsconfig has `allowImportingTsExtensions: true`, so frontend files may import `signature.ts` with the extension too.
- Company signature constants (exact copy, verbatim): name `IT DEV`, subtitle `Digital Marketing Agency`, `Tel.: +30 210 260 3414`, `A.: Argous 139, Athens, 104 41`, `E: info@itdev.gr`, `Web: www.itdev.gr` (→ https://www.itdev.gr).
- Commit after every task; push only in Task 6. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The owner's parallel sessions sometimes commit/push in this same working tree — before each commit run `git status` and stage ONLY the files this plan names.

---

### Task 1: Logo asset + shared signature renderer (TDD)

**Files:**
- Create: `public/email-assets/itdev-logo-round.png` (cropped from screenshot)
- Create: `supabase/functions/_shared/signature.ts`
- Test: `src/features/email/emailSignature.test.ts`

**Interfaces:**
- Produces: `renderSignatureHtml(logoUrl: string, person?: SignaturePerson): string`, `renderSignatureText(person?: SignaturePerson): string`, `SIGNATURE_COMPANY: SignaturePerson`, `type SignaturePerson = { name: string; title?: string | null; phone?: string | null; email?: string | null }`. Later tasks import these from `../_shared/signature.ts` (Deno) and `../../../supabase/functions/_shared/signature.ts` (frontend).

- [ ] **Step 1: Crop the logo from the owner's screenshot**

```bash
python3 -c "
from PIL import Image
im = Image.open('/Users/marios/Downloads/Screenshot at Jul 13 10-13-02.png').convert('RGB')
crop = im.crop((59, 49, 142, 133))
import os; os.makedirs('/Users/marios/Desktop/Cursor/itdevcrm/public/email-assets', exist_ok=True)
crop.save('/Users/marios/Desktop/Cursor/itdevcrm/public/email-assets/itdev-logo-round.png')
print(crop.size)"
```
Expected: `(83, 84)`. Then view the PNG (Read tool) — it must be the round dark "IT DEV" logo on white, nothing clipped, no surrounding text.

- [ ] **Step 2: Write the failing test**

Create `src/features/email/emailSignature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  renderSignatureHtml,
  renderSignatureText,
  SIGNATURE_COMPANY,
} from '../../../supabase/functions/_shared/signature.ts';

const LOGO = 'https://www.itdevcrm.com/email-assets/itdev-logo-round.png';

describe('renderSignatureHtml — company variant (default)', () => {
  const html = renderSignatureHtml(LOGO);
  it('contains greeting, company block, fixed rows and logo', () => {
    expect(html).toContain('Με εκτίμηση,');
    expect(html).toContain('IT DEV');
    expect(html).toContain('Digital Marketing Agency');
    expect(html).toContain('Tel.: +30 210 260 3414');
    expect(html).toContain('A.: Argous 139, Athens, 104 41');
    expect(html).toContain('mailto:info@itdev.gr');
    expect(html).toContain('href="https://www.itdev.gr"');
    expect(html).toContain(`src="${LOGO}"`);
  });
  it('contains both disclaimer paragraphs with bold labels', () => {
    expect(html).toContain('<b>ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:</b>');
    expect(html).toContain('εμπιστευτικό και προορίζεται αποκλειστικά');
    expect(html).toContain('<b>Επιπλέον σημείωση:</b>');
    expect(html).toContain('αποστολή γραπτού αιτήματος μέσω email');
  });
});

describe('renderSignatureHtml — personal variant', () => {
  it('uses the person fields', () => {
    const html = renderSignatureHtml(LOGO, {
      name: 'Maria Kifokeri', title: 'Sales Executive',
      phone: '+30 694 000 0000', email: 'mkifokeris@itdev.gr',
    });
    expect(html).toContain('Maria Kifokeri');
    expect(html).toContain('Sales Executive');
    expect(html).toContain('Tel.: +30 694 000 0000');
    expect(html).toContain('mailto:mkifokeris@itdev.gr');
    // fixed rows stay fixed
    expect(html).toContain('A.: Argous 139, Athens, 104 41');
    expect(html).toContain('www.itdev.gr');
  });
  it('omits title and phone rows when empty', () => {
    const html = renderSignatureHtml(LOGO, { name: 'X Y', title: null, phone: null, email: 'x@itdev.gr' });
    expect(html).not.toContain('Tel.:');
    expect(html).not.toContain('color:#2563eb">null');
    expect(html).not.toContain('>null<');
  });
  it('escapes HTML in person fields', () => {
    const html = renderSignatureHtml(LOGO, { name: '<script>x</script>', email: 'a@b.gr' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSignatureText', () => {
  it('renders company plain text with disclaimers', () => {
    const text = renderSignatureText();
    expect(text).toContain('Με εκτίμηση,');
    expect(text).toContain('IT DEV');
    expect(text).toContain('Tel.: +30 210 260 3414');
    expect(text).toContain('ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:');
    expect(text).not.toContain('<');
  });
});

describe('SIGNATURE_COMPANY', () => {
  it('is the fixed company block', () => {
    expect(SIGNATURE_COMPANY).toEqual({
      name: 'IT DEV', title: 'Digital Marketing Agency',
      phone: '+30 210 260 3414', email: 'info@itdev.gr',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- src/features/email/emailSignature.test.ts`
Expected: FAIL — cannot resolve `../../../supabase/functions/_shared/signature.ts`.

- [ ] **Step 4: Implement the renderer**

Create `supabase/functions/_shared/signature.ts`:

```ts
// Branded IT DEV email signature — the single source of truth for BOTH the
// send-email edge function (Deno) and the frontend preview (Vite/vitest).
// Keep this file dependency-free and free of Deno/browser globals so both
// runtimes can import it. Layout is fixed for everyone (owner decision
// 2026-07-13); only the four person fields vary.

export type SignaturePerson = {
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
};

export const SIGNATURE_COMPANY: SignaturePerson = {
  name: 'IT DEV',
  title: 'Digital Marketing Agency',
  phone: '+30 210 260 3414',
  email: 'info@itdev.gr',
};

const ADDRESS = 'Argous 139, Athens, 104 41';
const WEBSITE_LABEL = 'www.itdev.gr';
const WEBSITE_URL = 'https://www.itdev.gr';

const DISCLAIMER_LABEL = 'ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:';
const DISCLAIMER_BODY =
  'Το περιεχόμενο του παρόντος email είναι εμπιστευτικό και προορίζεται αποκλειστικά για τον/την παραλήπτη/παραλήπτρια που αναφέρεται στο μήνυμα. Απαγορεύεται αυστηρά η κοινοποίηση, αναπαραγωγή ή διανομή οποιουδήποτε μέρους του μηνύματος σε τρίτους χωρίς την έγγραφη συγκατάθεση του αποστολέα. Εάν λάβατε αυτό το μήνυμα κατά λάθος, παρακαλώ απαντήστε σε αυτό το email και προβείτε στη διαγραφή του, ώστε να διασφαλίσουμε ότι δεν θα επαναληφθεί παρόμοιο σφάλμα στο μέλλον.';
const NOTE_LABEL = 'Επιπλέον σημείωση:';
const NOTE_BODY =
  'Για οποιοδήποτε αίτημα ή αλλαγή που αφορά τις υπηρεσίες μας, παρακαλούμε όπως γίνεται αποστολή γραπτού αιτήματος μέσω email. Αυτό είναι σημαντικό προκειμένου να διατηρείται αρχείο και να διασφαλίζεται η ορθή παρακολούθηση και διαχείριση των ενεργειών.';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email-safe HTML (nested tables + inline styles — no flexbox, no classes).
 * Defaults to the company block; pass a person for the personal variant.
 * Empty title/phone rows are omitted.
 */
export function renderSignatureHtml(
  logoUrl: string,
  person: SignaturePerson = SIGNATURE_COMPANY,
): string {
  const rows: string[] = [`<b style="font-size:14px">${esc(person.name)}</b>`];
  if (person.title) rows.push(`<span style="color:#2563eb">${esc(person.title)}</span>`);
  if (person.phone) rows.push(`Tel.: ${esc(person.phone)}`);
  rows.push(`A.: ${esc(ADDRESS)}`);
  if (person.email) {
    rows.push(
      `E: <a href="mailto:${esc(person.email)}" style="color:#2563eb">${esc(person.email)}</a>`,
    );
  }
  rows.push(`Web: <a href="${WEBSITE_URL}" style="color:#2563eb">${WEBSITE_LABEL}</a>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
<tr><td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding-bottom:14px">Με εκτίμηση,</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:16px"><img src="${logoUrl}" width="80" height="80" alt="IT DEV" style="display:block;border-radius:50%"/></td>
<td style="border-left:2px solid #d1d5db;padding-left:16px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#0f172a">${rows.join('<br/>')}</td>
</tr></table></td></tr>
<tr><td style="padding-top:22px;font-family:Arial,sans-serif;font-size:10px;line-height:1.6;color:#6b7280">
<b>${DISCLAIMER_LABEL}</b> ${DISCLAIMER_BODY}<br/>
<b>${NOTE_LABEL}</b> ${NOTE_BODY}
</td></tr>
</table>`;
}

/** Plain-text rendering for the text/plain part of automated sends. */
export function renderSignatureText(person: SignaturePerson = SIGNATURE_COMPANY): string {
  const lines = ['Με εκτίμηση,', '', person.name];
  if (person.title) lines.push(person.title);
  if (person.phone) lines.push(`Tel.: ${person.phone}`);
  lines.push(`A.: ${ADDRESS}`);
  if (person.email) lines.push(`E: ${person.email}`);
  lines.push(`Web: ${WEBSITE_LABEL}`);
  lines.push('', `${DISCLAIMER_LABEL} ${DISCLAIMER_BODY}`, `${NOTE_LABEL} ${NOTE_BODY}`);
  return lines.join('\n');
}
```

⚠️ TRANSCRIPTION CHECK: the two Greek disclaimer strings must match the spec (`docs/superpowers/specs/2026-07-13-email-signature-design.md`, "Signature content" section) word-for-word — diff them by eye after writing the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- src/features/email/emailSignature.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Verify the whole build accepts the cross-tree import**

Run: `npm run build`
Expected: exit 0. Also run `deno check supabase/functions/_shared/signature.ts` — expected: no errors.

**Contingency (only if `tsc -b` or eslint rejects the frontend importing `supabase/functions/_shared/signature.ts`):** create `src/lib/emailSignature.ts` containing the IDENTICAL code, change the test import to `@/lib/emailSignature`, and add this parity test to `emailSignature.test.ts` so the copies can never drift:

```ts
import { readFileSync } from 'node:fs';
it('frontend copy is byte-identical to the edge-function copy', () => {
  const a = readFileSync('supabase/functions/_shared/signature.ts', 'utf8');
  const b = readFileSync('src/lib/emailSignature.ts', 'utf8');
  expect(a).toEqual(b);
});
```
Then Tasks 2/4 import from `../_shared/signature.ts` (unchanged) and Task 5 imports from `@/lib/emailSignature` instead.

- [ ] **Step 7: Commit**

```bash
git add public/email-assets/itdev-logo-round.png supabase/functions/_shared/signature.ts src/features/email/emailSignature.test.ts
git commit -m "feat(email): shared IT DEV signature renderer + logo asset

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Company signature on automated sends

**Files:**
- Modify: `supabase/functions/send-email/templates.ts`

**Interfaces:**
- Consumes: `renderSignatureHtml`, `renderSignatureText` from Task 1.
- Produces: `export const LOGO_URL` from `templates.ts` (Task 4 imports it); `shell(bodyHtml, sig?)` stays module-private.

- [ ] **Step 1: Wire the signature into `templates.ts`**

(No local test harness exists for edge functions; `deno check` + the deployed E2E in Task 6 are the verification. The renderer itself is unit-tested in Task 1.)

Add after the `APP_BASE` line (`templates.ts:7`):

```ts
import { renderSignatureHtml, renderSignatureText } from '../_shared/signature.ts';

export const LOGO_URL = `${APP_BASE}/email-assets/itdev-logo-round.png`;
const COMPANY_SIG_HTML = renderSignatureHtml(LOGO_URL);
const COMPANY_SIG_TEXT = renderSignatureText();
```

(Deno requires the import at the top of the file — place the `import` line with the other imports if any exist, otherwise first line; `templates.ts` currently has no imports, so make it line 1 and keep the header comment above or below it — eslint import/first applies.)

Replace `shell()` (currently lines 19–25) with a signature-aware version — when a signature is passed it REPLACES the `ITDEV · itdev.gr` footer line:

```ts
function shell(bodyHtml: string, sig = ''): string {
  const footer = sig !== '' ? sig : `<p style="font-size:12px;color:#64748b">ITDEV · itdev.gr</p>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
${footer}
</div>`;
}
```

Then give the company signature to every CLIENT-FACING render path, leaving `internal_*` untouched:

1. `TEMPLATES.custom` (line 42): `return { subject, html: shell(bodyHtml, COMPANY_SIG_HTML), text: raw + '\n\n' + COMPANY_SIG_TEXT };`
2. `payment_due_soon`, `payment_due_today`, `payment_overdue`: change their `shell(...)` call to `shell(..., COMPANY_SIG_HTML)` (these are fallbacks — DB rows normally win — but they must match).
3. `internal_new_task`, `internal_new_job`: NO change (plain `shell(...)`).
4. `renderDbTemplate` (lines 154–177): render the signature only when the row is client-facing:

```ts
  const sig = row.client_facing !== false ? COMPANY_SIG_HTML : '';
  const html = shell(
    `<p>${linkify(escapeHtml(bodyText)).replace(/\n/g, '<br/>')}</p>${cta}${footer}`,
    sig,
  );
  return {
    subject,
    html,
    text: sig !== '' ? `${bodyText}\n\n${COMPANY_SIG_TEXT}` : bodyText + footerText,
  };
```

- [ ] **Step 2: Typecheck the function**

Run: `deno check supabase/functions/send-email/index.ts`
Expected: no errors.

- [ ] **Step 3: Lint/build still green**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-email/templates.ts
git commit -m "feat(email): company IT DEV signature on client-facing automated emails

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Strip old text sign-offs from email_templates (migration)

**Files:**
- Create: `supabase/migrations/20260713100000_strip_template_signoffs.sql`

**Interfaces:**
- Produces: backup table `email_templates_backup_20260713` (Task 6 verifies against it; the Revert section restores from it).

- [ ] **Step 1: Write the migration**

Bodies are plain text; the code-level signature now supplies `Με εκτίμηση,` + branding, so trailing sign-off blocks must go or every email signs twice. DB bodies may have drifted from migration seeds (admins edit them in prod), hence the defensive tail-anchored pattern instead of exact-string replaces. Observed tail variants: `Με εκτίμηση,\n{{owner_name}}\nITDev` · `Με εκτίμηση,\nΗ ομάδα της ITDev` · `Με εκτίμηση,\nITDev` · `Με εκτίμηση,\nITDEV Λογιστήριο` (brand casing varies).

```sql
-- =============================================================================
-- Remove trailing "Με εκτίμηση, …" sign-offs from email_templates bodies.
-- The send-email function now appends the branded IT DEV signature (company
-- variant) to every client-facing email at render time
-- (supabase/functions/_shared/signature.ts) — leaving these in would sign
-- every email twice. Full backup first; bodies may have drifted from seeds.
-- SEO-onboarding contact-person closings do not match the pattern and stay.
-- =============================================================================

create table if not exists public.email_templates_backup_20260713 as
  select * from public.email_templates;

update public.email_templates
   set body = regexp_replace(
         body,
         '\s*Με εκτίμηση,\s*(\{\{owner_name\}\})?\s*(Η ομάδα της)?\s*(ITDEV|ITDev|itdev)?(\s*Λογιστήριο)?\s*$',
         ''
       ),
       updated_at = now()
 where body ~ '\s*Με εκτίμηση,\s*(\{\{owner_name\}\})?\s*(Η ομάδα της)?\s*(ITDEV|ITDev|itdev)?(\s*Λογιστήριο)?\s*$';

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   select count(*) as still_signed from public.email_templates
--    where body like '%εκτίμηση%';                      -- expect 0
--   select key, right(body, 60) as tail
--     from public.email_templates order by key;          -- eyeball every tail
-- ROLLBACK:
--   update public.email_templates t
--      set body = b.body, subject = b.subject, updated_at = now()
--     from public.email_templates_backup_20260713 b
--    where b.key = t.key;
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Sanity-check the regex against the known seed variants**

Run this locally (no DB needed — same regex engine class; catches pattern typos):

```bash
python3 -c "
import re
pat = re.compile(r'\s*Με εκτίμηση,\s*(\{\{owner_name\}\})?\s*(Η ομάδα της)?\s*(ITDEV|ITDev|itdev)?(\s*Λογιστήριο)?\s*$')
tails = ['κείμενο.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
         'κείμενο.\n\nΜε εκτίμηση,\nΗ ομάδα της ITDev',
         'κείμενο.\nΜε εκτίμηση,\nITDEV Λογιστήριο',
         'κείμενο.\nΜε εκτίμηση,\nITDEV']
for t in tails:
    out = pat.sub('', t)
    assert out == 'κείμενο.', repr(out)
# must NOT touch a body without the sign-off (e.g. SEO onboarding closing)
keep = 'Επικοινωνήστε με τον Παύλο στο +30 210 260 3414.'
assert pat.sub('', keep) == keep
print('regex OK')"
```
Expected: `regex OK`.

- [ ] **Step 3: Commit** (migration is applied to prod in Task 6, not here)

```bash
git add supabase/migrations/20260713100000_strip_template_signoffs.sql
git commit -m "feat(email): migration stripping per-template sign-offs (backed up)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Personal signature on CRM Gmail sends

**Files:**
- Modify: `supabase/functions/send-email/index.ts` (function `sendPersonal`, lines 206–235)

**Interfaces:**
- Consumes: `renderSignatureHtml` (Task 1), `LOGO_URL` (Task 2).

- [ ] **Step 1: Append the sender's signature in `sendPersonal`**

Add to the imports at the top of `index.ts`:

```ts
import { renderSignatureHtml } from '../_shared/signature.ts';
```
and extend the existing templates import (line 4) to:
```ts
import { renderTemplate, renderDbTemplate, LOGO_URL } from './templates.ts';
```

In `sendPersonal`, replace the two lines (currently 218–219):

```ts
  const subject = String(data.subject ?? '');
  const html = String(data.html ?? '');
```

with:

```ts
  const subject = String(data.subject ?? '');
  // Personal signature: same fixed layout for everyone, person fields from
  // the sender's profile (owner decision 2026-07-13). Fallbacks keep sends
  // working for a profile with gaps.
  const { data: prof } = await admin
    .from('profiles')
    .select('full_name, job_title, phone, email')
    .eq('user_id', uid)
    .maybeSingle();
  const sig = renderSignatureHtml(LOGO_URL, {
    name: (prof?.full_name ?? '').trim() || acct.google_email,
    title: prof?.job_title ?? null,
    phone: prof?.phone ?? null,
    email: (prof?.email ?? '').trim() || acct.google_email,
  });
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">${String(data.html ?? '')}</div>${sig}`;
```

(`buildMime` and everything downstream is unchanged — it already sends whatever `html` contains.)

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/send-email/index.ts`
Expected: no errors.

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "feat(email): personal IT DEV signature on CRM Gmail sends

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — profile signature preview + compose hint + i18n

**Files:**
- Create: `src/features/email/SignaturePreview.tsx`
- Test: `src/features/email/SignaturePreview.test.tsx`
- Modify: `src/features/users/MyProfilePage.tsx` (insert section between the fields grid and the Google-connect card, i.e. between lines 174 and 175)
- Modify: `src/features/email/SendEmailDialog.tsx` (insert after the body `<label>`, line 59)
- Modify: `src/i18n/locales/en/users.json`, `src/i18n/locales/el/users.json`, `src/i18n/locales/en/email.json`, `src/i18n/locales/el/email.json`

**Interfaces:**
- Consumes: `renderSignatureHtml`, `SignaturePerson` from Task 1 (import path `../../../supabase/functions/_shared/signature.ts` — or `@/lib/emailSignature` if Task 1's contingency fired; check which exists).
- Produces: `SignaturePreview({ person })` (pure, for MyProfilePage) and `MySignaturePreview()` (self-fetching, for the dialog).

- [ ] **Step 1: Write the failing component test**

Create `src/features/email/SignaturePreview.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SignaturePreview } from './SignaturePreview';

describe('SignaturePreview', () => {
  it('renders the signature HTML for the given person into the iframe', () => {
    render(
      <SignaturePreview
        person={{ name: 'Maria Kifokeri', title: 'Sales', phone: '+30 694', email: 'm@itdev.gr' }}
      />,
    );
    const frame = screen.getByTitle('signature-preview');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('Maria Kifokeri');
    expect(doc).toContain('Με εκτίμηση,');
    expect(doc).toContain('ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ');
    expect(doc).toContain('/email-assets/itdev-logo-round.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/email/SignaturePreview.test.tsx`
Expected: FAIL — `./SignaturePreview` not found.

- [ ] **Step 3: Implement `SignaturePreview.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { renderSignatureHtml } from '../../../supabase/functions/_shared/signature.ts';
import type { SignaturePerson } from '../../../supabase/functions/_shared/signature.ts';

// Same fixed layout for everyone — the preview is the renderer the emails use.
export function SignaturePreview({ person }: { person: SignaturePerson }) {
  const logoUrl = `${window.location.origin}/email-assets/itdev-logo-round.png`;
  return (
    <iframe
      title="signature-preview"
      sandbox=""
      srcDoc={`<body style="margin:8px;background:#ffffff">${renderSignatureHtml(logoUrl, person)}</body>`}
      className="h-72 w-full rounded border bg-white"
    />
  );
}

/** Self-fetching variant for places without the profile at hand (compose dialog). */
export function MySignaturePreview() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery({
    queryKey: ['my-signature-profile', userId] as const,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, job_title, phone, email')
        .eq('user_id', userId!)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  if (!q.data) return null;
  return (
    <SignaturePreview
      person={{
        name: q.data.full_name ?? '',
        title: q.data.job_title,
        phone: q.data.phone,
        email: q.data.email,
      }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/email/SignaturePreview.test.tsx`
Expected: PASS. (jsdom renders the iframe attribute; no real Supabase call is made — the pure component doesn't fetch.)

- [ ] **Step 5: Add i18n keys (all four files)**

`src/i18n/locales/en/users.json` — inside the `"profile"` object add:
```json
"signature_title": "Email signature",
"signature_hint": "Added automatically to emails you send through the CRM. It is built from your name, job title, phone and email above — edit those fields to change it. The layout is the same for everyone."
```
`src/i18n/locales/el/users.json` — inside `"profile"`:
```json
"signature_title": "Υπογραφή email",
"signature_hint": "Προστίθεται αυτόματα στα email που στέλνετε μέσα από το CRM. Δημιουργείται από το όνομα, τον τίτλο θέσης, το τηλέφωνο και το email σας παραπάνω — επεξεργαστείτε αυτά τα πεδία για να την αλλάξετε. Η μορφή είναι ίδια για όλους."
```
`src/i18n/locales/en/email.json` — inside the `"dialog"` object:
```json
"signature_hint": "Your IT DEV signature is added automatically when the email is sent.",
"signature_preview": "Preview signature"
```
`src/i18n/locales/el/email.json` — inside `"dialog"`:
```json
"signature_hint": "Η υπογραφή σας IT DEV προστίθεται αυτόματα κατά την αποστολή.",
"signature_preview": "Προεπισκόπηση υπογραφής"
```

- [ ] **Step 6: My Profile section**

In `src/features/users/MyProfilePage.tsx`, add the import:
```tsx
import { SignaturePreview } from '@/features/email/SignaturePreview';
```
Insert between the closing `</div>` of the fields grid (line 174) and the Google-connect card `<div className="rounded-md border p-4">` (line 175):

```tsx
      <div className="rounded-md border p-4">
        <h2 className="text-sm font-medium">
          {t('profile.signature_title', { defaultValue: 'Email signature' })}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('profile.signature_hint', {
            defaultValue:
              'Added automatically to emails you send through the CRM. It is built from your name, job title, phone and email above — edit those fields to change it. The layout is the same for everyone.',
          })}
        </p>
        <div className="mt-3">
          <SignaturePreview
            person={{
              name: fullName.trim() || email.trim(),
              title: jobTitle.trim() || null,
              phone: phone.trim() || null,
              email: email.trim() || null,
            }}
          />
        </div>
      </div>
```

(The preview reads the live form state, so it updates as the user types — before autosave even fires.)

- [ ] **Step 7: Compose-dialog hint**

In `src/features/email/SendEmailDialog.tsx`, add the import:
```tsx
import { MySignaturePreview } from './SignaturePreview';
```
Insert directly after the body `<label>…</label>` (line 59), before the `{error && …}` line:

```tsx
            {identity === 'personal' && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{t('dialog.signature_hint')}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground underline">
                    {t('dialog.signature_preview')}
                  </summary>
                  <div className="mt-2">
                    <MySignaturePreview />
                  </div>
                </details>
              </div>
            )}
```

- [ ] **Step 8: Full gate**

Run: `npm run build && npm run test:run -- src/features/email/SignaturePreview.test.tsx src/features/email/emailSignature.test.ts`
Expected: build exit 0, both test files PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/email/SignaturePreview.tsx src/features/email/SignaturePreview.test.tsx \
  src/features/users/MyProfilePage.tsx src/features/email/SendEmailDialog.tsx \
  src/i18n/locales/en/users.json src/i18n/locales/el/users.json \
  src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): signature preview on My Profile + compose-dialog hint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Rollout + end-to-end verification (prod)

**Files:** none new — deploys and prod SQL. ⚠️ Needs the owner: a fresh `sbp_` Management-API token (ask in chat; remind rotation after) and a final inbox eyeball.

- [ ] **Step 1: Push → Vercel deploys frontend + logo**

```bash
git pull --rebase && git push
```
Then poll until live (typically 1–3 min):
```bash
curl -sI https://www.itdevcrm.com/email-assets/itdev-logo-round.png | grep -i '^content-type: image/png'
```
Expected: the `content-type: image/png` header line prints. Do not proceed until it does — automated emails hot-link this URL. A plain `HTTP/2 200` with NO `image/png` content-type means the SPA rewrite served `index.html` (a soft-200 HTML response) and the asset is actually MISSING; investigate the `email-assets/` rewrite exclusion (vercel.json) and the deploy before continuing.

- [ ] **Step 2: Apply the strip migration to prod (Management API)**

**⚠️ Steps 2 and 3 MUST run back-to-back.** The migration strips the DB sign-offs but the code that re-adds the branded signature only goes live when Step 3 deploys the function. The drain fires every minute, so any client-facing email sent in the gap between Step 2 and Step 3 goes out completely UNSIGNED. Before posting the migration, pre-stage the Step 3 deploy command in a second terminal (token exported, command typed, ready to press Enter) and run it the instant the migration query returns.

Write the migration body into a JSON file and POST it (pattern from `docs` / prior sessions; curl user-agent required):

```bash
TMP=$(mktemp -d)
python3 -c "
import json
sql = open('supabase/migrations/20260713100000_strip_template_signoffs.sql').read()
json.dump({'query': sql}, open('$TMP/strip.json', 'w'))"
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer <sbp_TOKEN_FROM_OWNER>" -H "Content-Type: application/json" \
  --data @"$TMP/strip.json"
```
Then verify with a second query call:
```sql
select count(*) as still_signed from public.email_templates where body like '%εκτίμηση%';
select key, right(body, 60) as tail from public.email_templates order by key;
select count(*) as backed_up from public.email_templates_backup_20260713;
```
Expected: `still_signed = 0`; every `tail` ends mid-content (no orphan "Με εκτίμηση,"); `backed_up` equals the email_templates row count (~30).

- [ ] **Step 3: Deploy the edge function**

```bash
SUPABASE_ACCESS_TOKEN=<sbp_TOKEN_FROM_OWNER> npx supabase functions deploy send-email \
  --project-ref xujlrclyzxrvxszepquy --no-verify-jwt
```
Expected: deploy success. `--no-verify-jwt` is REQUIRED — the drain cron authenticates via `email_drain_secret`, not a JWT (see `project_email_pipeline` memory; deploying without the flag breaks all automated email).

- Confirm the function's `APP_URL` secret equals `https://www.itdevcrm.com` (`LOGO_URL` derives from it — `${APP_BASE}/email-assets/itdev-logo-round.png`; a wrong value means every automated email hot-links a broken logo). Check with `SUPABASE_ACCESS_TOKEN=<sbp_TOKEN_FROM_OWNER> npx supabase secrets list --project-ref xujlrclyzxrvxszepquy` and eyeball the `APP_URL` digest / value.

- [ ] **Step 4: E2E — automated email carries the company signature**

Enqueue a real client-facing template to the owner's test inbox via the Management API (`auth.uid()` is null there, so RLS doesn't block):

```sql
insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
values ('sales', 'itdevgr24@gmail.com', 'lead_welcome',
        '{"lead_name": "Signature Test", "owner_name": "Test", "code": ""}'::jsonb,
        'sig-e2e-20260713');
```
The instant-send pulse drains it within seconds. Verify the send:
```sql
select status, error from public.email_log where dedupe_key = 'sig-e2e-20260713';
```
Expected: `sent`. Then confirm content — the mirrored thread copy records what actually went out:
```sql
select body_text from public.email_messages
 where to_email = 'itdevgr24@gmail.com' order by sent_at desc limit 1;
```
Expected: body ends with the full signature text block (Με εκτίμηση, / IT DEV / Tel / ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ …) and contains it exactly ONCE (no double sign-off). If the select returns no row, that only means `resolve_email_filing` didn't know the test address (mirroring skips unknown parties) — the send still happened; verify content in the inbox at Step 6 instead.

- [ ] **Step 5: E2E — personal CRM send carries the personal signature**

Playwright (or the owner by hand): log in to https://www.itdevcrm.com as `info@itdev.gr` / `123456789`, open any client → Emails tab → New email → to `itdevgr24@gmail.com`, subject `Signature E2E`, any body → confirm the dialog shows the "signature added automatically" hint and the preview expands → Send. (409 `not_connected` means that account has no Gmail linked — use an account that does, or have the owner run it.)

- [ ] **Step 6: Inbox eyeball (owner)**

Ask the owner to open both messages in Gmail (`itdevgr24@gmail.com`) and confirm: logo renders round, layout matches the reference image, links work (`mailto:`, itdev.gr), disclaimer legible, no double signature. Fix-forward anything visual (spacing/size tweaks → redeploy function).

Additionally, send ONE offer email through the real Send-offer flow (open a deal → Offers → Send offer to `itdevgr24@gmail.com`) to exercise the compose draft body (`offer.body`). The scripted E2Es (Steps 4–5) do not touch the i18n draft bodies, so this is the only check that the Fix-1 sign-off removal actually prevents a double signature: confirm the delivered offer email carries the branded signature EXACTLY ONCE (no `Με εκτίμηση,` / `Best regards,` appearing twice).

- [ ] **Step 7: Close out**

- Remind the owner to rotate the `sbp_` token.
- Update the memory files: mark the signature feature SHIPPED in a new `project_email_signature.md` + one-line MEMORY.md index entry; note in `project_email_pipeline.md` that send-email now appends signatures.
- Mark all checkboxes in this plan done.

---

## Changes / Revert (whole feature)

**Changes:** commits from Tasks 1–5 (renderer+logo, templates.ts, migration, index.ts, frontend) · prod: migration 20260713100000 applied, send-email redeployed.

**Revert:**
1. Templates: `update public.email_templates t set body = b.body, subject = b.subject, updated_at = now() from public.email_templates_backup_20260713 b where b.key = t.key;`
2. Edge function: `git revert` the Task 2 + Task 4 commits, redeploy send-email (same command as Task 6 Step 3).
3. Frontend/asset: `git revert` the Task 1 + Task 5 commits, push.
4. Keep the backup table until the owner confirms the feature is stable.
