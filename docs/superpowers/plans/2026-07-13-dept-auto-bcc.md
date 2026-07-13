# Department Auto-Bcc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every personal CRM send is automatically Bcc'd to the sender's department mailbox(es): Sales→sales@itdev.gr, Accounting→accounting@itdev.gr, Technical→support@itdev.gr.

**Architecture:** A pure `deptBccFor(parentLabels)` mapper joins `parseRecipientList` in `_shared/recipients.ts`. `sendPersonal` loads the sender's group `parent_label`s (service-role embed), merges the auto-Bcc into the caller's (already admin-gated) bcc, deduped against To/Cc. Recording is free — the Gmail sent copy carries the merged Bcc header and gmail-sync already captures it into `email_message_bcc`.

**Tech Stack:** Supabase edge fn (Deno) + vitest cross-tree unit tests. Prod project `xujlrclyzxrvxszepquy`. No migration.

**Spec:** `docs/superpowers/specs/2026-07-13-dept-auto-bcc-design.md` — read it first.

## Global Constraints

- Mapping (exact): `Sales` → `sales@itdev.gr`, `Accounting` → `accounting@itdev.gr`, `Technical` → `support@itdev.gr`. Unknown labels ignored; output deduped lowercase; empty input → `[]`.
- Personal sends ONLY (`sendPersonal`). Automated/Resend paths untouched. The admin-only gate on CALLER bcc is unchanged — the system Bcc is appended after it, for every sender.
- Final bcc = dedupe(callerBcc + autoBcc) minus addresses already in `to` or `cc` (case-insensitive).
- `npm run build` MUST pass after every task. NEVER run the full vitest suite (hits PROD). `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts` clean.
- Commit per task; push in Task 3. Messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Owner's parallel sessions commit in this tree — `git status` first; stage ONLY named files; anchor by surrounding code.

---

### Task 1: `deptBccFor` helper + `sendPersonal` wiring (TDD)

**Files:**
- Modify: `supabase/functions/_shared/recipients.ts` (append helper)
- Modify: `supabase/functions/send-email/index.ts` (`sendPersonal`)
- Test: `src/features/email/recipients.test.ts` (append one describe block)

**Interfaces:**
- Produces: `deptBccFor(parentLabels: string[]): string[]` exported from `_shared/recipients.ts`.
- Consumes: existing `sendPersonal(uid, to, data, dedupeKey, cc = [], bcc = [])` and its `buildMime({ from, to, subject, html, cc, bcc })` call.

- [x] **Step 1: Write the failing test** — append to `src/features/email/recipients.test.ts`:

```ts
describe('deptBccFor', () => {
  it('maps each department label to its mailbox', () => {
    expect(deptBccFor(['Sales'])).toEqual(['sales@itdev.gr']);
    expect(deptBccFor(['Accounting'])).toEqual(['accounting@itdev.gr']);
    expect(deptBccFor(['Technical'])).toEqual(['support@itdev.gr']);
  });
  it('multi-department senders get all their boxes, deduped', () => {
    expect(deptBccFor(['Sales', 'Technical', 'Technical'])).toEqual([
      'sales@itdev.gr',
      'support@itdev.gr',
    ]);
  });
  it('ignores unknown labels and returns [] for empty input', () => {
    expect(deptBccFor(['Management'])).toEqual([]);
    expect(deptBccFor([])).toEqual([]);
  });
});
```
Also add `deptBccFor` to the import list at the top of the test file.

- [x] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/features/email/recipients.test.ts`
Expected: FAIL — `deptBccFor` is not exported.

- [x] **Step 3: Implement** — append to `supabase/functions/_shared/recipients.ts`:

```ts
/** Department archive mailboxes, keyed by groups.parent_label (owner rule
 *  2026-07-13): every personal CRM send is auto-Bcc'd to the sender's
 *  department box(es). Unknown labels are ignored. */
const DEPT_BCC: Record<string, string> = {
  Sales: 'sales@itdev.gr',
  Accounting: 'accounting@itdev.gr',
  Technical: 'support@itdev.gr',
};

export function deptBccFor(parentLabels: string[]): string[] {
  const out: string[] = [];
  for (const label of parentLabels) {
    const box = DEPT_BCC[label];
    if (box && !out.includes(box)) out.push(box);
  }
  return out;
}
```

- [x] **Step 4: Run to verify pass**

Run: `npm run test:run -- src/features/email/recipients.test.ts`
Expected: PASS (13 tests).

- [x] **Step 5: Wire into `sendPersonal`** — in `supabase/functions/send-email/index.ts`:

Extend the recipients import:
```ts
import { parseRecipientList, deptBccFor } from '../_shared/recipients.ts';
```

Inside `sendPersonal`, directly AFTER the `if (!acct || acct.revoked_at) return { status: 'not_connected' };` line, add:

```ts
  // Department archive copy (owner rule 2026-07-13): every personal send is
  // Bcc'd to the sender's department box(es) — Sales→sales@, Accounting→
  // accounting@, Technical→support@. Appended AFTER the caller-bcc admin gate
  // (system copy applies to every sender); deduped against To/Cc so a mail
  // addressed to the box isn't double-delivered.
  const { data: grps } = await admin
    .from('user_groups')
    .select('groups(parent_label)')
    .eq('user_id', uid);
  const labels = ((grps ?? []) as { groups: { parent_label: string | null } | null }[])
    .map((g) => g.groups?.parent_label)
    .filter((l): l is string => !!l);
  const visible = new Set([to.toLowerCase(), ...cc.map((c) => c.toLowerCase())]);
  const mergedBcc = [...bcc];
  for (const box of deptBccFor(labels)) {
    if (!visible.has(box) && !mergedBcc.includes(box)) mergedBcc.push(box);
  }
```

Then change the `buildMime` call from `..., cc, bcc });` to:
```ts
  const raw = buildMime({ from: acct.google_email, to, subject, html, cc, bcc: mergedBcc });
```
(NOTE: only the `buildMime` call changes to `mergedBcc` — the `bcc` parameter and the earlier admin gate in the handler stay exactly as they are. The Supabase embed returns `groups` as an object under this FK; if `deno check` insists it's an array, adapt the extraction with `Array.isArray` handling and say so in your report.)

- [x] **Step 6: Gates**

Run: `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts` — clean.
Run: `npm run build` — exit 0.

- [x] **Step 7: Commit**

```bash
git add supabase/functions/_shared/recipients.ts supabase/functions/send-email/index.ts src/features/email/recipients.test.ts
git commit -m "feat(email): auto-bcc sender's department mailbox on personal sends

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Compose-dialog hint + i18n

**Files:**
- Modify: `src/features/email/SendEmailDialog.tsx` (one line in the personal-identity hint block)
- Modify: `src/i18n/locales/en/email.json`, `src/i18n/locales/el/email.json`

**Interfaces:** none new.

- [x] **Step 1: Add the hint line**

In `SendEmailDialog.tsx`, inside the existing `{identity === 'personal' && (…)}` block, directly under the signature-hint `<p>` (`{t('dialog.signature_hint')}`), add:

```tsx
                <p className="text-xs text-muted-foreground">{t('dialog.dept_bcc_hint')}</p>
```

- [x] **Step 2: i18n keys** — inside `"dialog"`:

`en/email.json`:
```json
"dept_bcc_hint": "A copy is sent automatically to your department's mailbox."
```
`el/email.json`:
```json
"dept_bcc_hint": "Ένα αντίγραφο αποστέλλεται αυτόματα στο γραμματοκιβώτιο του τμήματός σας."
```
Validate both parse: `python3 -c "import json;json.load(open('src/i18n/locales/en/email.json'));json.load(open('src/i18n/locales/el/email.json'));print('OK')"`

- [x] **Step 3: Gates**

Run: `npm run build && npm run test:run -- src/features/email/SendEmailDialog.ccbcc.test.tsx`
Expected: build exit 0; existing dialog tests still PASS.

- [x] **Step 4: Commit**

```bash
git add src/features/email/SendEmailDialog.tsx src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): compose hint for automatic department bcc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Rollout + E2E (prod) — main session

⚠️ Needs a valid `sbp_` token and the owner's/inbox eyeballs. No migration this time.

- [x] **Step 1: Push** (`git pull --rebase && git push`; Vercel picks up the hint) and deploy:
```bash
SUPABASE_ACCESS_TOKEN=<sbp> npx supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy --no-verify-jwt
```
(`--no-verify-jwt` REQUIRED — drain auth.)

- [x] **Step 2: sales@ existence probe (ROLLOUT GATE).** From the CRM as a Gmail-connected user, send a short email To `sales@itdev.gr` (subject `sales@ probe`). Wait ~3 minutes, then check the sender's mailbox for a Mailer-Daemon bounce (owner eyeball, or check whether gmail-sync captured a `mailer-daemon@` message for that user). No bounce = the box exists. If it bounces: STOP, tell the owner to create sales@itdev.gr (or alias) before this feature is considered live for the sales department — accounting@/support@ paths are live regardless.

- [x] **Step 3: E2E — technical sender.** As mkifokeris (web_dev → support@), send a normal email from a lead (To an owner-controlled address, e.g. itdevgr24@gmail.com via a throwaway/test context if needed). After gmail-sync captures the sent copy, verify:
```sql
select b.bcc_emails from public.email_message_bcc b
  join public.email_messages m on m.id = b.message_pk
 where m.from_email = 'mkifokeris@itdev.gr' order by m.sent_at desc limit 1;
```
Expected: contains `support@itdev.gr`. Also: support@'s inbox receives the copy (owner eyeball or support@ capture shows it).

- [x] **Step 4: E2E — sales sender.** As a Gmail-connected sales rep (e.g. azazas@itdev.gr, standard test pw), send one email from one of HIS leads. Verify the captured sent copy's bcc row contains `sales@itdev.gr` (same query with his from_email). Requires Step 2 passing.

- [x] **Step 5: E2E — merge with manual bcc.** As an admin sender, send with a manual Bcc (e.g. itdevgr24@gmail.com): captured bcc row must contain BOTH the manual address AND the department box, no duplicates.

- [x] **Step 6: Close out** — remind sbp_ rotation; update memory (`project_email_conversations.md` cc/bcc paragraph gains the auto-bcc rule + the sales@ gate outcome); mark plan checkboxes; ledger entry.

---

## Changes / Revert

**Changes:** Tasks 1–2 commits; send-email redeploy. No migration.
**Revert:** git revert both commits + redeploy send-email. (Auto-bcc stops; recorded bcc rows remain, harmless.)
