# Email Mirror Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop automated Resend sends from appearing twice (mirror row + gmail-sync capture) in the Mail tabs, and merge the existing duplicate backlog.

**Architecture:** Three layers — (A) `send-email` stamps its own RFC822 `Message-ID` header on the wire email and reuses it for the mirror row so the DB unique constraint dedups the captured copy; (B) `gmail-sync` adopts un-adopted mirror rows in place when the captured copy arrives (covers SES rewriting the header); (C) a one-time SQL migration merges the existing mirror+capture twins with a backup table. Spec: `docs/superpowers/specs/2026-07-29-email-mirror-dedup-design.md`.

**Tech Stack:** Supabase edge functions (Deno TS), PostgREST via supabase-js, plain SQL migration, vitest for pure helpers.

## Global Constraints

- NEVER run the full vitest suite (it hits PROD). Only targeted files: `npx vitest run <file>`.
- Edge fn typecheck: `deno check --node-modules-dir=auto supabase/functions/<fn>/index.ts` must be clean after every task that touches it.
- Commit per task, push directly to `main` (no PRs).
- Prod deploy + the cleanup migration require the owner's `sbp_` Management-API token — everything up to that point must be complete and committed first.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Shared dedup helpers

**Files:**
- Create: `supabase/functions/_shared/emailDedup.ts`
- Test: `supabase/functions/_shared/emailDedup.test.ts`

**Interfaces:**
- Produces: `ADOPTION_WINDOW_MS: number` (30 min in ms); `newCrmMessageId(uuid?: string): string` returning `<crm-<uuid>@itdev.gr>`; `isUnadoptedMirrorId(id: string): boolean` true for `resend:` and `<crm-` prefixes; `nearestBySentAt<T extends { sent_at: string | null }>(rows: T[], targetIso: string): T | undefined` returning the row whose `sent_at` is closest to `targetIso` within `ADOPTION_WINDOW_MS`, else undefined.

- [ ] **Step 1: Write the failing test**

`supabase/functions/_shared/emailDedup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ADOPTION_WINDOW_MS, newCrmMessageId, isUnadoptedMirrorId, nearestBySentAt } from './emailDedup';

describe('emailDedup helpers', () => {
  it('formats a CRM message id as an RFC822 msg-id on our domain', () => {
    expect(newCrmMessageId('123e4567-e89b-12d3-a456-426614174000'))
      .toBe('<crm-123e4567-e89b-12d3-a456-426614174000@itdev.gr>');
  });

  it('generates unique ids when no uuid is given', () => {
    const a = newCrmMessageId();
    expect(a).toMatch(/^<crm-[0-9a-f-]{36}@itdev\.gr>$/);
    expect(newCrmMessageId()).not.toBe(a);
  });

  it('recognizes un-adopted mirror ids (both schemes) and nothing else', () => {
    expect(isUnadoptedMirrorId('resend:abc-123')).toBe(true);
    expect(isUnadoptedMirrorId('<crm-123e4567-e89b-12d3-a456-426614174000@itdev.gr>')).toBe(true);
    expect(isUnadoptedMirrorId('<xyz@eu-west-1.amazonses.com>')).toBe(false);
    expect(isUnadoptedMirrorId('<abc@mail.gmail.com>')).toBe(false);
  });

  it('picks the nearest row by sent_at within the adoption window', () => {
    const rows = [
      { id: 'far', sent_at: '2026-07-29T06:20:00Z' },
      { id: 'near', sent_at: '2026-07-29T06:00:30Z' },
      { id: 'null', sent_at: null },
    ];
    expect(nearestBySentAt(rows, '2026-07-29T06:00:00Z')?.id).toBe('near');
  });

  it('returns undefined when every candidate is outside the window', () => {
    const rows = [{ id: 'a', sent_at: '2026-07-29T07:00:01Z' }];
    expect(nearestBySentAt(rows, '2026-07-29T06:00:00Z')).toBeUndefined();
    expect(ADOPTION_WINDOW_MS).toBe(30 * 60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/emailDedup.test.ts`
Expected: FAIL — cannot resolve `./emailDedup`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/_shared/emailDedup.ts`:

```ts
// Helpers for keeping one logical email = ONE email_messages row
// (spec docs/superpowers/specs/2026-07-29-email-mirror-dedup-design.md).
// send-email writes a mirror row per Resend send; gmail-sync captures the
// delivered dept-CC copy of the same email minutes later. These helpers give
// both sides a shared definition of "mirror row" and of the time window in
// which a captured copy may claim one.

export const ADOPTION_WINDOW_MS = 30 * 60_000;

/** RFC822 Message-ID used for BOTH the wire email (Resend `headers`) and the
 *  mirror row, so a captured delivered copy dedups on the unique constraint. */
export function newCrmMessageId(uuid: string = crypto.randomUUID()): string {
  return `<crm-${uuid}@itdev.gr>`;
}

/** A mirror row not yet folded into its captured copy. Adoption rewrites
 *  message_id to the real Message-ID, so this doubles as the "un-adopted"
 *  marker. `resend:` is the pre-2026-07-29 scheme (cleaned up by migration
 *  20260729090000); `<crm-` is the current one. */
export function isUnadoptedMirrorId(id: string): boolean {
  return id.startsWith('resend:') || id.startsWith('<crm-');
}

/** Nearest row to `targetIso` by sent_at, within ADOPTION_WINDOW_MS. */
export function nearestBySentAt<T extends { sent_at: string | null }>(
  rows: T[],
  targetIso: string,
): T | undefined {
  const t = Date.parse(targetIso);
  return rows
    .map((r) => ({ r, d: r.sent_at ? Math.abs(Date.parse(r.sent_at) - t) : Number.NaN }))
    .filter((x) => Number.isFinite(x.d) && x.d <= ADOPTION_WINDOW_MS)
    .sort((a, b) => a.d - b.d)[0]?.r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/emailDedup.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/emailDedup.ts supabase/functions/_shared/emailDedup.test.ts
git commit -m "feat(email): shared mirror-dedup helpers (crm Message-ID, adoption window)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: send-email stamps its own Message-ID

**Files:**
- Modify: `supabase/functions/send-email/index.ts` (the Resend `fetch` payload ~line 141 and the mirror block ~line 173)

**Interfaces:**
- Consumes: `newCrmMessageId()` from Task 1.
- Produces: mirror rows now carry `message_id = '<crm-<uuid>@itdev.gr>'`; the same value rides the wire email as its `Message-ID` header via Resend's `headers` field.

- [ ] **Step 1: Add the import**

In `supabase/functions/send-email/index.ts`, extend the existing `_shared` imports (near the top, alongside the `../_shared/google.ts` import):

```ts
import { newCrmMessageId } from '../_shared/emailDedup.ts';
```

- [ ] **Step 2: Generate the id and send it as a header**

Immediately before `const res = await fetch('https://api.resend.com/emails', ...)` add:

```ts
  // One RFC822 Message-ID for BOTH the wire email and the mirror row below:
  // when gmail-sync captures a delivered copy (dept-CC'd shared box), it
  // lands on the same unique key and dedups in the DB instead of showing
  // twice on the Mail tab (spec 2026-07-29-email-mirror-dedup-design.md).
  const rfcMessageId = newCrmMessageId();
```

and inside the `body: JSON.stringify({ ... })` object add one field after `subject: rendered.subject, html: rendered.html, text: rendered.text,`:

```ts
      headers: { 'Message-ID': rfcMessageId },
```

- [ ] **Step 3: Use it for the mirror row**

Replace:

```ts
        const mirrorMessageId = `resend:${body.id ?? crypto.randomUUID()}`;
```

with:

```ts
        const mirrorMessageId = rfcMessageId;
```

- [ ] **Step 4: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/send-email/index.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "fix(email): stamp own Message-ID on Resend sends; mirror row reuses it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: gmail-sync adopts mirror rows

**Files:**
- Modify: `supabase/functions/gmail-sync/index.ts` (the capture upsert inside `syncOneUser`, ~lines 61–99)

**Interfaces:**
- Consumes: `ADOPTION_WINDOW_MS`, `nearestBySentAt` from Task 1.
- Produces: `storeCaptured(row: CapturedRow): Promise<boolean>` — module-private; folds a captured message into its mirror row when one exists, else inserts.

- [ ] **Step 1: Add the import and the helper**

In `supabase/functions/gmail-sync/index.ts` add to the imports:

```ts
import { ADOPTION_WINDOW_MS, nearestBySentAt } from '../_shared/emailDedup.ts';
```

Below the `type SyncResult` line add:

```ts
type CapturedRow = {
  message_id: string; gmail_id: string; thread_id: string | null;
  direction: string; from_email: string; from_name: string | null; to_email: string;
  subject: string | null; body_text: string | null; body_html: string | null; snippet: string | null;
  cc_emails: string | null; sent_at: string | null;
  client_id: string | null; deal_id: string | null; job_id: string | null; lead_id: string | null;
  department: string | null; staff_user_id: string | null; captured_from_user_id: string;
};

// Store a captured message, folding it into its send-time mirror row when one
// exists (spec 2026-07-29-email-mirror-dedup-design.md): send-email writes a
// mirror row per Resend send, and the dept-CC copy of the same email arrives
// here minutes later with the real Message-ID. One logical email must stay
// ONE row, else the Mail tab shows it twice.
async function storeCaptured(row: CapturedRow): Promise<boolean> {
  // (a) Same Message-ID already stored: an earlier sweep of another mailbox
  //     (gmail_id set → done) or a mirror whose custom Message-ID header
  //     survived delivery (gmail_id null → attach the Gmail metadata so the
  //     thread folds and Reply works).
  const { data: existing, error: exErr } = await admin.from('email_messages')
    .select('id, gmail_id').eq('message_id', row.message_id).maybeSingle();
  if (exErr) return false;
  if (existing) {
    if (existing.gmail_id) return true;
    const { error } = await admin.from('email_messages').update({
      gmail_id: row.gmail_id, thread_id: row.thread_id,
      body_text: row.body_text, body_html: row.body_html, snippet: row.snippet,
      captured_from_user_id: row.captured_from_user_id,
    }).eq('id', existing.id);
    return !error;
  }
  // (b) Un-adopted mirror twin stored under a synthetic id: adopt it in
  //     place (keeps the row id, so email_message_bcc children survive).
  if (row.direction === 'outbound' && row.sent_at) {
    const t = new Date(row.sent_at).getTime();
    let q = admin.from('email_messages')
      .select('id, message_id, sent_at, cc_emails')
      .or('message_id.like.resend:*,message_id.like.<crm-*')
      .eq('to_email', row.to_email)
      .eq('direction', 'outbound')
      .gte('sent_at', new Date(t - ADOPTION_WINDOW_MS).toISOString())
      .lte('sent_at', new Date(t + ADOPTION_WINDOW_MS).toISOString());
    q = row.subject === null ? q.is('subject', null) : q.eq('subject', row.subject);
    q = row.deal_id ? q.eq('deal_id', row.deal_id) : q.is('deal_id', null);
    q = row.lead_id ? q.eq('lead_id', row.lead_id) : q.is('lead_id', null);
    const { data: mirrors } = await q;
    const mirror = nearestBySentAt(mirrors ?? [], row.sent_at);
    if (mirror) {
      // The .eq('message_id', old) guard makes this a 0-row no-op if another
      // sweep adopted the mirror first; we then fall through to the plain
      // upsert, which dedups on the real Message-ID.
      const { data: adopted, error: adoptErr } = await admin.from('email_messages')
        .update({
          message_id: row.message_id, gmail_id: row.gmail_id, thread_id: row.thread_id,
          from_email: row.from_email, from_name: row.from_name,
          body_text: row.body_text, body_html: row.body_html, snippet: row.snippet,
          sent_at: row.sent_at, captured_from_user_id: row.captured_from_user_id,
          cc_emails: row.cc_emails ?? mirror.cc_emails,
        })
        .eq('id', mirror.id).eq('message_id', mirror.message_id)
        .select('id');
      if (!adoptErr && (adopted ?? []).length > 0) return true;
    }
  }
  // (c) First sighting: plain insert (races absorbed by the unique key).
  const { error } = await admin.from('email_messages')
    .upsert(row, { onConflict: 'message_id', ignoreDuplicates: true });
  return !error;
}
```

- [ ] **Step 2: Route the capture through it**

Inside `syncOneUser`, replace this block:

```ts
      matched++;
      const { error } = await admin.from('email_messages').upsert({
        message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
        direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
        subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
        cc_emails: m.cc_emails,
        sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
        client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id, department: f.department,
        staff_user_id: f.staff_user_id, captured_from_user_id: uid,
      }, { onConflict: 'message_id', ignoreDuplicates: true });
      if (!error) stored++; else errors++;
```

with:

```ts
      matched++;
      const ok = await storeCaptured({
        message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
        direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
        subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
        cc_emails: m.cc_emails,
        sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
        client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id, department: f.department,
        staff_user_id: f.staff_user_id, captured_from_user_id: uid,
      });
      if (ok) stored++; else errors++;
```

and change the two follow-up guards from `if (!error && ...)` to `if (ok && ...)` (the bcc union block and the thread-adoption block).

- [ ] **Step 3: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/gmail-sync/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gmail-sync/index.ts
git commit -m "fix(email): gmail-sync folds captured copies into their mirror rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Backlog cleanup migration

**Files:**
- Create: `supabase/migrations/20260729090000_email_mirror_dedup.sql`

**Interfaces:**
- Consumes: nothing from other tasks (pure SQL over existing schema).
- Produces: backup table `public.email_mirror_dedup_backup_20260729`; deletes paired `resend:%` mirror rows.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260729090000_email_mirror_dedup.sql`:

```sql
-- =============================================================================
-- 2026-07-29: Merge mirror+capture duplicate email rows (dup Mail-tab bug,
-- spec docs/superpowers/specs/2026-07-29-email-mirror-dedup-design.md).
-- Every automated Resend send wrote a mirror row (message_id 'resend:<id>')
-- AND was captured from the dept-CC'd shared mailbox under the real RFC822
-- Message-ID — two rows for one email. Keep the captured row (it has the
-- Gmail thread + html body), fold in the mirror's bcc/cc, delete the mirror.
-- Pairing is 1:1 (a capture absorbs at most one mirror) so a mirror whose
-- capture failed is never deleted via someone else's twin.
-- =============================================================================
begin;

create temp table _mirror_pairs on commit drop as
with cand as (
  select m.id as mirror_id, c.id as kept_id,
         abs(extract(epoch from (m.sent_at - c.sent_at))) as delta
  from public.email_messages m
  join public.email_messages c
    on  c.to_email = m.to_email
    and c.subject is not distinct from m.subject
    and c.direction = 'outbound'
    and c.deal_id  is not distinct from m.deal_id
    and c.lead_id  is not distinct from m.lead_id
    and c.message_id not like 'resend:%'
    and c.message_id not like '<crm-%'
    and abs(extract(epoch from (m.sent_at - c.sent_at))) <= 1800
  where m.message_id like 'resend:%'
    and m.direction = 'outbound'
),
mirror_best as (  -- each mirror's nearest capture
  select distinct on (mirror_id) mirror_id, kept_id, delta
  from cand order by mirror_id, delta
)
-- each capture keeps only its nearest claiming mirror (1:1)
select distinct on (kept_id) mirror_id, kept_id
from mirror_best order by kept_id, delta;

-- Backup: full mirror rows + which twin absorbed them + their bcc payload.
create table if not exists public.email_mirror_dedup_backup_20260729 as
select m.*, p.kept_id as kept_twin_id, b.bcc_emails as mirror_bcc
from _mirror_pairs p
join public.email_messages m on m.id = p.mirror_id
left join public.email_message_bcc b on b.message_pk = m.id;

-- Fold the mirror's admin-only bcc into the kept twin (union, never clobber).
insert into public.email_message_bcc (message_pk, bcc_emails)
select p.kept_id, mb.bcc_emails
from _mirror_pairs p
join public.email_message_bcc mb on mb.message_pk = p.mirror_id
on conflict (message_pk) do update
  set bcc_emails = (
    select string_agg(distinct x, ',')
    from unnest(string_to_array(
      email_message_bcc.bcc_emails || ',' || excluded.bcc_emails, ',')) as x
  );

-- Keep the dept CC when the captured copy's headers lacked one.
update public.email_messages c
set cc_emails = m.cc_emails
from _mirror_pairs p
join public.email_messages m on m.id = p.mirror_id
where c.id = p.kept_id and c.cc_emails is null and m.cc_emails is not null;

-- Drop the mirrors (email_message_bcc children cascade).
delete from public.email_messages m
using _mirror_pairs p
where m.id = p.mirror_id;

commit;

-- Verification (run after):
--   select count(*) from public.email_mirror_dedup_backup_20260729;   -- ≈ pairs merged
--   select count(*) from public.email_messages where message_id like 'resend:%';
--     -- remaining = mirrors with no captured twin (sole record of a send): kept.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   insert into public.email_messages
--     (id, message_id, gmail_id, thread_id, direction, from_email, from_name,
--      to_email, subject, body_text, body_html, snippet, sent_at, client_id,
--      deal_id, job_id, department, staff_user_id, captured_from_user_id,
--      created_at, cc_emails, lead_id)
--   select id, message_id, gmail_id, thread_id, direction, from_email,
--      from_name, to_email, subject, body_text, body_html, snippet, sent_at,
--      client_id, deal_id, job_id, department, staff_user_id,
--      captured_from_user_id, created_at, cc_emails, lead_id
--   from public.email_mirror_dedup_backup_20260729
--   on conflict (id) do nothing;
--   insert into public.email_message_bcc (message_pk, bcc_emails)
--   select id, mirror_bcc from public.email_mirror_dedup_backup_20260729
--   where mirror_bcc is not null
--   on conflict (message_pk) do nothing;
-- ---------------------------------------------------------------------------
```

NOTE for the implementer: before writing, verify the column list in the
ROLLBACK block matches the live `email_messages` columns in
`supabase/migrations/20260709175000_email_messages.sql` +
`20260710150000*` (lead_id) + `20260713180000` (cc_emails) — order does not
matter, completeness does.

- [ ] **Step 2: Sanity-check the SQL locally**

No local DB exists; instead re-read the migration checking each table/column
name against the migrations that created them (`email_messages`:
20260709175000, `lead_id`: the 20260710150000 lead-capture migration,
`cc_emails`/`email_message_bcc`: 20260713180000). Confirm `_mirror_pairs` is
referenced only inside the `begin;…commit;` block (temp table, on commit drop).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729090000_email_mirror_dedup.sql
git commit -m "feat(email): backlog cleanup migration merging mirror+capture twins

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Deploy, clean up, verify (main session — needs owner token)

**Files:** none (operational).

- [ ] Push all commits to `main`.
- [ ] Deploy `send-email` AND `gmail-sync` together (Management API / CLI with the owner's `sbp_` token — ask the owner for it; rotate after per standing rule).
- [ ] IMMEDIATELY verify Resend accepts the new `headers` field: trigger one real send (e.g. GBP-access resend on a test deal, or any custom compose to an internal address) and confirm `email_log.status='sent'`. If Resend 400s, revert the Task 2 commit and redeploy `send-email` before anything else.
- [ ] Run the dry-run pairing count (the `cand`/`mirror_best`/`pairs` CTEs as a bare `select count(*)`) via the Management API; sanity-check the number (~300 expected from the 2026-07-29 analysis).
- [ ] Apply `20260729090000_email_mirror_dedup.sql`.
- [ ] Verify: `select count(*) from email_messages where message_id like 'resend:%'` — remaining rows are capture-less mirrors only (spot-check 3: no same-subject twin within 30 min).
- [ ] Next automated send (06:00 UTC reminder run, or a manual GBP-access resend on a test deal): confirm ONE row per email — either the mirror adopted a real Message-ID + thread_id, or the captured copy deduped on the stamped header.
- [ ] Check `gmail_sync_sweep` cron output stays green for 2 cycles (no error spike from the new code path).
- [ ] Update memory `project_email_conversations.md` with the fix + backup-table name; report mechanism-2 findings (per-payment same-day reminders, resend-button multiples) to the owner as open product decisions.
```
