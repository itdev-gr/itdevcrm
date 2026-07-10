# Lead Email Capture + Sales/Accounting/Technical Categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture sales↔prospect Gmail on the lead, carry it to client+deal on conversion, and split the Emails tab (deal/job/client/lead pages) into collapsible Sales / Accounting / Technical sections.

**Architecture:** One filing RPC (`resolve_email_filing`) gains a lead fallback + a staff-group department rule; `convert_lead_to_client` reparents lead emails exactly like it already reparents comments/attachments; the shared `EmailThreadList`/`useEmailThreads` pair gains a `lead_id` scope and a per-thread category derived from the newest message's department.

**Tech Stack:** Supabase (Postgres RLS, plpgsql, edge fn Deno), React + TanStack Query, vitest + @testing-library/react, i18next (en+el).

**Spec:** `docs/superpowers/specs/2026-07-10-lead-emails-3-categories-design.md`

## Global Constraints

- `npm run build` = `tsc -b` + `eslint --max-warnings=0` — stricter than `tsc --noEmit`; index accesses need `!` assertions.
- `email_messages` is NOT in generated types → keep the `supabase.from('email_messages' as never)` cast. No `any`.
- RLS does all visibility filtering; the UI never filters by permission.
- Commit per task, push directly to `main` — no PRs/branches.
- Prod DB work goes through the Supabase Management API: `POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, header `Authorization: Bearer <sbp_ token>` (ask the owner for the token; **rotate it after the session**), body `{"query":"<sql>"}` via `curl --data @payload.json` from the scratchpad dir. curl UA required (urllib gets CF-1010-blocked). Build payloads mechanically — SQL contains `\d` regexes and `$$` bodies that break hand-written JSON: `python3 -c "import json,sys; print(json.dumps({'query': open(sys.argv[1]).read()}))" <file.sql> > payload.json`. If DDL is refused, hand the migration SQL to the owner to run and verify afterwards.
- **Prod function bodies drift from `.sql` files.** Before replacing `resolve_email_filing` or `convert_lead_to_client`, dump the live body (`select pg_get_functiondef('public.<fn>(<argtypes>)'::regprocedure);`) and diff against the repo version quoted in the task. If they differ, STOP and reconcile using the live body as the base — do not blindly apply.
- vitest in this repo talks to PROD for integration-style suites — only run the scoped commands given in each task (`src/features/email/` tests are pure unit tests; safe).
- The gmail-sync cron sweep fires every 5 minutes in prod; task order (edge fn first, then migration) exists so no sweep lands in a broken window. Do not reorder Tasks 1–2.
- i18n: every new key goes to BOTH `src/i18n/locales/en/...` and `src/i18n/locales/el/...`.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/functions/gmail-sync/index.ts` (modify) | pass `lead_id` through to the upsert |
| `supabase/migrations/20260710150000_lead_email_capture.sql` (create) | `email_messages.lead_id`, RLS v2, `resolve_email_filing` v3, one-off retag |
| `supabase/migrations/20260710151000_convert_lead_email_carryover.sql` (create) | `convert_lead_to_client` reparents lead emails |
| `src/features/email/hooks/useEmailThreads.ts` (modify) | `EmailScope.lead_id`, `EmailCategory`, `categoryOf`, thread category |
| `src/features/email/hooks/useEmailThreads.test.ts` (modify) | category unit tests |
| `src/features/email/EmailThreadList.tsx` (modify) | three collapsible category sections |
| `src/features/email/EmailThreadList.test.tsx` (modify) | section render/toggle tests |
| `src/features/leads/LeadDetailPage.tsx` (modify) | Emails tab |
| `src/i18n/locales/{en,el}/email.json` (modify) | `category.*` labels |
| `src/i18n/locales/{en,el}/leads.json` (modify) | `tabs.emails` |

---

### Task 1: gmail-sync passes `lead_id` through

**Files:**
- Modify: `supabase/functions/gmail-sync/index.ts:58-65`

**Interfaces:**
- Consumes: `resolve_email_filing` result row `f` (today has no `lead_id` key — `f.lead_id` is `undefined`, which `JSON.stringify` drops from the upsert payload, so this deploy is a safe no-op until Task 2's migration lands).
- Produces: upsert payload containing `lead_id` once the RPC returns it.

- [ ] **Step 1: Edit the upsert**

In the `admin.from('email_messages').upsert({...})` call, add `lead_id: f.lead_id,` directly after the `job_id` field:

```ts
        client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id, department: f.department,
```

(That is the only code change in this file.)

- [ ] **Step 2: Deploy**

```bash
cd /Users/marios/Desktop/Cursor/itdevcrm
SUPABASE_ACCESS_TOKEN=<sbp_ token from owner> npx supabase functions deploy gmail-sync --project-ref xujlrclyzxrvxszepquy
```

Expected: `Deployed Function gmail-sync`. `supabase/config.toml` already pins `[functions.gmail-sync] verify_jwt = false` — the deploy keeps it.

- [ ] **Step 3: Verify the sweep still works**

Wait for the next 5-min cron tick (or trigger manually with `{"mode":"sweep"}` + `Authorization: Bearer <GMAIL_SYNC_SECRET or service key>`), then via Management API:

```sql
select count(*) as recent from public.email_messages where created_at > now() - interval '20 minutes';
select last_synced_at from public.user_google_sync order by last_synced_at desc limit 1;
```

Expected: `last_synced_at` advances past the deploy time; no error spike (row counts may legitimately be 0 new).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gmail-sync/index.ts
git commit -m "feat(email): gmail-sync passes lead_id through to email_messages"
```

---

### Task 2: Migration — `lead_id` column, RLS, `resolve_email_filing` v3, retag

**Files:**
- Create: `supabase/migrations/20260710150000_lead_email_capture.sql`

**Interfaces:**
- Consumes: `public.leads` (`id, email, converted_at, archived, owner_user_id, created_at`), `public.user_groups(user_id, group_id)` + `public.groups(id, code)`, `public.current_user_is_admin()`, `public.current_user_can(text,text)`.
- Produces: `email_messages.lead_id uuid` column; `resolve_email_filing(text,text,text)` now returns `(client_id, deal_id, job_id, lead_id, department, staff_user_id, direction)` — Task 1's deployed fn starts storing `lead_id` the moment this applies; Tasks 3–6 rely on the column and RLS.

- [ ] **Step 1: Drift check (MANDATORY before writing)**

Via Management API:

```sql
select pg_get_functiondef('public.resolve_email_filing(text,text,text)'::regprocedure);
```

Diff against `supabase/migrations/20260709170100_resolve_email_filing.sql`. Cosmetic formatting differences are fine; logic differences mean STOP and reconcile (use the live body as the base for the v3 edit below).

- [ ] **Step 2: Write the migration file**

`supabase/migrations/20260710150000_lead_email_capture.sql`:

```sql
-- 2026-07-10: capture sales<->prospect email on the lead + Accounting dept rule.
-- Spec: docs/superpowers/specs/2026-07-10-lead-emails-3-categories-design.md

-- 1. Where a lead email is filed before conversion.
alter table public.email_messages add column if not exists lead_id uuid references public.leads(id);
create index if not exists email_messages_lead_idx on public.email_messages(lead_id) where lead_id is not null;

-- 2. resolve_email_filing v3: return type changes (adds lead_id) => drop + recreate.
drop function if exists public.resolve_email_filing(text,text,text);
create function public.resolve_email_filing(p_from text, p_to text, p_subject text)
returns table (client_id uuid, deal_id uuid, job_id uuid, lead_id uuid, department text, staff_user_id uuid, direction text)
language plpgsql security definer set search_path = public stable
as $$
declare
  v_from text := lower(trim(coalesce(p_from,'')));
  v_to   text := lower(trim(coalesce(p_to,'')));
  v_from_staff boolean := exists (select 1 from profiles where lower(email)=v_from);
  v_to_staff   boolean := exists (select 1 from profiles where lower(email)=v_to);
  v_staff_email text; v_client_email text; v_dir text;
  v_staff uuid; v_client uuid; v_dept text; v_deal uuid; v_job uuid; v_lead uuid; v_code text;
begin
  -- Exactly one side must be staff (a client<->staff email). Skip internal
  -- staff-to-staff and mail with no staff party at all.
  if v_from_staff and v_to_staff then return; end if;
  if v_from_staff then
    v_staff_email:=v_from; v_client_email:=v_to; v_dir:='outbound';
  elsif v_to_staff then
    v_staff_email:=v_to; v_client_email:=v_from; v_dir:='inbound';
  else
    return;  -- no staff party
  end if;

  select user_id into v_staff from profiles where lower(email)=v_staff_email limit 1;

  -- Code is authoritative: a job code in the subject files the email on that
  -- job + deal and derives the client from the deal.
  v_code := substring(coalesce(p_subject,'') from '(\d{6}-[A-Z]{3,})');
  if v_code is not null then
    select j.id, j.deal_id, d.client_id, j.service_type
      into v_job, v_deal, v_client, v_dept
      from jobs j join deals d on d.id = j.deal_id
     where j.code = v_code limit 1;
  end if;

  if v_client is null then
    select id into v_client from clients where lower(email)=v_client_email limit 1;
    if v_client is not null then
      select d.id into v_deal from deals d
        where d.client_id=v_client and d.archived=false
        order by d.created_at desc limit 1;
      -- Uncoded client mail: department from the staff party's groups
      -- (owner-approved 07-10). sales wins over accounting; neither => sales.
      if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                  where ug.user_id = v_staff and g.code = 'sales') then
        v_dept := 'sales';
      elsif exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                     where ug.user_id = v_staff and g.code = 'accounting') then
        v_dept := 'accounting';
      else
        v_dept := 'sales';
      end if;
    else
      -- NEW: prospect mail files on the newest open lead with that address.
      -- Client match keeps precedence (existing-customer resubmission case).
      select l.id into v_lead from leads l
        where lower(l.email) = v_client_email
          and l.converted_at is null and l.archived = false
        order by l.created_at desc limit 1;
      if v_lead is null then return; end if;  -- unknown party => skip (privacy)
      v_dept := 'sales';  -- lead emails are always Sales
    end if;
  end if;

  -- Keep department only if it maps to a real team group.
  if v_dept is not null and not exists (select 1 from groups g where g.code = v_dept) then
    v_dept := null;
  end if;

  return query select v_client, v_deal, v_job, v_lead, v_dept, v_staff, v_dir;
end $$;

-- Recreate closes the old grants; built-in PUBLIC execute default must be
-- cancelled explicitly (grant-boundary rule).
revoke execute on function public.resolve_email_filing(text,text,text) from public, anon, authenticated;
grant execute on function public.resolve_email_filing(text,text,text) to service_role;

-- 3. RLS: lead-only emails must NOT leak across reps (leads are own-only).
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
);

-- 4. One-off retag (owner-approved): uncoded rows whose staff party is in
-- accounting and not in sales become Accounting. Lead rows excluded by rule.
update public.email_messages em
   set department = 'accounting'
 where em.department = 'sales' and em.job_id is null and em.lead_id is null
   and exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                where ug.user_id = em.staff_user_id and g.code = 'accounting')
   and not exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                    where ug.user_id = em.staff_user_id and g.code = 'sales');

notify pgrst, 'reload schema';

-- ROLLBACK:
--   update public.email_messages set department='sales'
--     where department='accounting' and job_id is null and lead_id is null;
--   (restore policy + fn v2 from 20260709175000_email_messages.sql /
--    20260709170100_resolve_email_filing.sql)
--   alter table public.email_messages drop column if exists lead_id;
```

- [ ] **Step 3: Apply via Management API**

Write the file content into a `{"query": "..."}` payload in the scratchpad and POST it (recipe in Global Constraints). Expected: HTTP 200, empty result array.

- [ ] **Step 4: Verify — structure + filing behavior**

```sql
-- column + policy exist
select column_name from information_schema.columns
 where table_name='email_messages' and column_name='lead_id';
select polname from pg_policies where tablename='email_messages';

-- filing: pick a real open lead and a real staff email, then:
select * from public.resolve_email_filing('<staff email>', '<that lead''s email>', 'hello');
-- Expected: one row, lead_id = the lead's id, client_id/deal_id/job_id null,
-- department 'sales', direction 'outbound'.

-- staff-to-staff still skipped; unknown party still skipped:
select count(*) from public.resolve_email_filing('<staff email>', '<another staff email>', 'x');  -- 0
select count(*) from public.resolve_email_filing('<staff email>', 'nobody@nowhere.invalid', 'x'); -- 0

-- retag effect (report the numbers in the task summary):
select department, count(*) from public.email_messages group by 1 order by 1;
```

- [ ] **Step 5: Verify — RLS silo (role impersonation, read-only)**

Get a target: `select id, owner_user_id from public.leads where converted_at is null and email is not null limit 1;` and any other non-admin rep's `user_id` from `profiles`. Then (one Management API call per block — `set_config(..., true)` is transaction-local):

```sql
begin;
insert into public.email_messages (message_id, direction, from_email, to_email, subject, department, lead_id, staff_user_id)
values ('rls-probe-1@test', 'outbound', 'probe@itdev.gr', 'lead@x.gr', 'probe', 'sales', '<lead_id>', null);
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', '<lead owner_user_id>', 'role', 'authenticated')::text, true);
select count(*) as owner_sees from public.email_messages where message_id = 'rls-probe-1@test';   -- expect 1
rollback;
```

```sql
begin;
insert into public.email_messages (message_id, direction, from_email, to_email, subject, department, lead_id, staff_user_id)
values ('rls-probe-2@test', 'outbound', 'probe@itdev.gr', 'lead@x.gr', 'probe', 'sales', '<lead_id>', null);
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', '<other rep user_id>', 'role', 'authenticated')::text, true);
select count(*) as other_rep_sees from public.email_messages where message_id = 'rls-probe-2@test'; -- expect 0
rollback;
```

Both probes roll back — nothing persists. If `other_rep_sees` is 1, STOP: the policy leaked; do not proceed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260710150000_lead_email_capture.sql
git commit -m "feat(email): file prospect mail on leads + accounting dept rule + own-only RLS"
```

---

### Task 3: Migration — conversion carries lead emails to client + deal

**Files:**
- Create: `supabase/migrations/20260710151000_convert_lead_email_carryover.sql`

**Interfaces:**
- Consumes: live `convert_lead_to_client(uuid)` (repo base: `supabase/migrations/20260703120000_business_profile_name.sql` lines 12–88), `email_messages.lead_id` from Task 2.
- Produces: converted leads' emails gain `client_id` + `deal_id` (keeping `lead_id`), so they surface on client/deal Emails tabs under Sales.

- [ ] **Step 1: Drift check (MANDATORY)**

```sql
select pg_get_functiondef('public.convert_lead_to_client(uuid)'::regprocedure);
```

Diff against `20260703120000_business_profile_name.sql`. If the live body differs, use the LIVE body as the base and apply only the marked insertion below.

- [ ] **Step 2: Write the migration**

`supabase/migrations/20260710151000_convert_lead_email_carryover.sql` — the FULL live `convert_lead_to_client` body wrapped in `create or replace function`, with exactly one insertion: after the existing `update public.attachments ...` reparent and before the `update public.leads set converted_at ...` statement, add:

```sql
  -- Carry captured lead emails onto the new client + deal (keep lead_id as history).
  update public.email_messages set client_id = new_client_id, deal_id = new_deal_id
    where lead_id = l.id;
```

Header comment for the migration file:

```sql
-- 2026-07-10: convert_lead_to_client also reparents captured lead emails
-- (same pattern as the existing comments/attachments reparents).
-- Base body: live prod def (drift-checked), repo ref 20260703120000_business_profile_name.sql.
-- ROLLBACK: re-apply the previous body (snapshot it in this file's PR-of-record
-- by pasting the pg_get_functiondef output below before applying):
-- <paste live pre-change body here during execution>
```

(`create or replace` with an unchanged signature preserves existing grants — no re-grant needed.)

- [ ] **Step 3: Apply via Management API + verify**

Apply, then:

```sql
select pg_get_functiondef('public.convert_lead_to_client(uuid)'::regprocedure);
```

Expected: body contains `update public.email_messages set client_id = new_client_id`.
Do NOT convert a real lead to test — the reparent is exercised end-to-end the next time sales genuinely wins a lead; the statement is identical in shape to the adjacent comments/attachments reparents.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710151000_convert_lead_email_carryover.sql
git commit -m "feat(email): conversion carries lead emails onto the client and deal"
```

---

### Task 4: `useEmailThreads` — lead scope + thread category (TDD)

**Files:**
- Modify: `src/features/email/hooks/useEmailThreads.ts`
- Test: `src/features/email/hooks/useEmailThreads.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 5–6 rely on these exact names):
  - `export type EmailCategory = 'sales' | 'accounting' | 'technical'`
  - `export function categoryOf(department: string | null): EmailCategory`
  - `EmailThread` gains `category: EmailCategory` (derived from the NEWEST message)
  - `EmailScope` gains `lead_id?: string` (filter precedence deal → job → client → lead)
  - `EmailMessageRow` gains `lead_id: string | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/email/hooks/useEmailThreads.test.ts` (also add `categoryOf` to the existing import from `./useEmailThreads`, and add `lead_id: p.lead_id ?? null,` to the `row()` helper — the field is new on `EmailMessageRow`):

```ts
describe('categoryOf', () => {
  it('maps sales and accounting directly, everything else to technical', () => {
    expect(categoryOf('sales')).toBe('sales');
    expect(categoryOf('accounting')).toBe('accounting');
    expect(categoryOf('web_dev')).toBe('technical');
    expect(categoryOf('local_seo')).toBe('technical');
    expect(categoryOf(null)).toBe('technical');
  });
});

describe('thread category', () => {
  it('derives the category from the newest message in the thread', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', department: 'web_dev', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 't1', department: 'sales', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th[0]!.category).toBe('sales');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/features/email/hooks/useEmailThreads.test.ts`
Expected: FAIL — `categoryOf` is not exported / `category` missing on `EmailThread`.

- [ ] **Step 3: Implement**

In `src/features/email/hooks/useEmailThreads.ts`:

```ts
// EmailMessageRow: add after job_id
  lead_id: string | null;

// COLS: append lead_id
const COLS =
  'id, message_id, thread_id, direction, from_email, from_name, to_email, subject, body_text, snippet, sent_at, department, job_id, lead_id';

export type EmailCategory = 'sales' | 'accounting' | 'technical';

/** UI bucket for a department code (groups.parent_label mirrors this in the DB). */
export function categoryOf(department: string | null): EmailCategory {
  if (department === 'sales') return 'sales';
  if (department === 'accounting') return 'accounting';
  return 'technical';
}

// EmailThread: add
  category: EmailCategory;
```

In `groupThreads`, initialize new threads with `category: categoryOf(r.department)`, and inside the per-thread loop after the messages sort add:

```ts
    // Category follows the newest message (a chain can gain a job code later).
    th.category = categoryOf(th.messages[0]!.department);
```

`EmailScope` and `scopeFilter`:

```ts
export type EmailScope = { deal_id?: string; job_id?: string; client_id?: string; lead_id?: string };

/** Resolve the single active filter column/value from a scope. Precedence:
 *  deal_id → job_id → client_id → lead_id. Value is '' when nothing is set
 *  (query stays disabled). */
function scopeFilter(scope: EmailScope): readonly [column: string, value: string] {
  if (scope.deal_id) return ['deal_id', scope.deal_id];
  if (scope.job_id) return ['job_id', scope.job_id];
  if (scope.client_id) return ['client_id', scope.client_id];
  return ['lead_id', scope.lead_id ?? ''];
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/features/email/hooks/useEmailThreads.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/email/hooks/useEmailThreads.ts src/features/email/hooks/useEmailThreads.test.ts
git commit -m "feat(email): lead_id scope + thread category on useEmailThreads"
```

---

### Task 5: `EmailThreadList` — collapsible category sections (TDD)

**Files:**
- Modify: `src/features/email/EmailThreadList.tsx`
- Modify: `src/i18n/locales/en/email.json`, `src/i18n/locales/el/email.json`
- Test: `src/features/email/EmailThreadList.test.tsx`

**Interfaces:**
- Consumes: `EmailThread.category`, `EmailCategory` from Task 4.
- Produces: unchanged props `{ scope, clientEmail }` — deal/job/client pages pick the sections up with no changes.

- [ ] **Step 1: Update/extend the tests**

Replace `src/features/email/EmailThreadList.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EmailThread } from './hooks/useEmailThreads';

const ref: { data: EmailThread[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('./hooks/useEmailThreads', () => ({ useEmailThreads: () => ref }));
vi.mock('./SendEmailDialog', () => ({ SendEmailDialog: () => null }));
import { EmailThreadList } from './EmailThreadList';

function thread(p: Partial<EmailThread> & Pick<EmailThread, 'key' | 'category'>): EmailThread {
  return {
    subject: p.subject ?? 'Subj',
    last_at: p.last_at ?? '2026-07-09T10:00:00Z',
    messages: p.messages ?? [
      {
        id: `${p.key}-m1`,
        message_id: `${p.key}-x`,
        thread_id: p.key,
        direction: 'inbound',
        from_email: 'a@x.gr',
        from_name: 'A',
        to_email: 'me@itdev.gr',
        subject: p.subject ?? 'Subj',
        body_text: `body of ${p.key}`,
        snippet: null,
        sent_at: '2026-07-09T10:00:00Z',
        department: null,
        job_id: null,
        lead_id: null,
      },
    ],
    ...p,
  };
}

describe('EmailThreadList', () => {
  it('shows an empty state when there are no threads', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });

  it('renders category headers with thread counts', () => {
    ref.data = [
      thread({ key: 's1', category: 'sales', subject: 'Prospect chat' }),
      thread({ key: 't1', category: 'technical', subject: 'Re: 000280-WEBDEV' }),
      thread({ key: 't2', category: 'technical', subject: 'Re: 005188-WEBDEV' }),
    ];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ client_id: 'c1' }} clientEmail="c@x.gr" />);
    expect(screen.getByRole('button', { name: /sales \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accounting \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /technical \(2\)/i })).toBeInTheDocument();
  });

  it('starts non-empty sections expanded and empty ones collapsed', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText('Prospect chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sales \(1\)/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /accounting \(0\)/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking a header collapses and re-expands its section', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    const header = screen.getByRole('button', { name: /sales \(1\)/i });
    fireEvent.click(header);
    expect(screen.queryByText('Prospect chat')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Prospect chat')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run src/features/email/EmailThreadList.test.tsx`
Expected: the empty-state test still passes; the three new section tests FAIL (no category header buttons rendered yet).

- [ ] **Step 3: Add i18n labels**

`src/i18n/locales/en/email.json` — add inside the top-level object (after the `thread` block):

```json
  "category": {
    "sales": "Sales",
    "accounting": "Accounting",
    "technical": "Technical"
  },
```

`src/i18n/locales/el/email.json` — same position:

```json
  "category": {
    "sales": "Πωλήσεις",
    "accounting": "Λογιστήριο",
    "technical": "Τεχνικό"
  },
```

- [ ] **Step 4: Implement the sections**

Rework `src/features/email/EmailThreadList.tsx`. Keep `EmailMessage` and the loading/empty branches exactly as they are; change imports, add the category machinery, and wrap the thread cards in sections. Final component body:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CommentAvatar,
  CommentEmptyState,
  formatCommentTime,
} from '@/features/comments/comment-utils';
import {
  useEmailThreads,
  type EmailCategory,
  type EmailMessageRow,
  type EmailScope,
  type EmailThread,
} from './hooks/useEmailThreads';
import { SendEmailDialog } from './SendEmailDialog';

const CATEGORY_ORDER: readonly EmailCategory[] = ['sales', 'accounting', 'technical'];
const CATEGORY_LABEL: Record<EmailCategory, { key: string; defaultValue: string }> = {
  sales: { key: 'category.sales', defaultValue: 'Sales' },
  accounting: { key: 'category.accounting', defaultValue: 'Accounting' },
  technical: { key: 'category.technical', defaultValue: 'Technical' },
};

type Props = {
  scope: EmailScope;
  clientEmail: string;
};

type ReplyTarget = { to: string; subject: string };

export function EmailThreadList({ scope, clientEmail }: Props) {
  const { t, i18n } = useTranslation('email');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-GB';
  const { data: threads = [], isLoading } = useEmailThreads(scope);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // Explicit user toggles; untouched sections default to open-when-non-empty.
  const [toggled, setToggled] = useState<Partial<Record<EmailCategory, boolean>>>({});

  if (isLoading) {
    return (
      <p className="px-1 py-6 text-sm text-muted-foreground">
        {t('thread.loading', { defaultValue: 'Loading…' })}
      </p>
    );
  }

  if (threads.length === 0) {
    return (
      <CommentEmptyState>
        {t('thread.empty', { defaultValue: 'No client emails yet.' })}
      </CommentEmptyState>
    );
  }

  const grouped: Record<EmailCategory, EmailThread[]> = { sales: [], accounting: [], technical: [] };
  for (const th of threads) grouped[th.category].push(th);
  const isOpen = (cat: EmailCategory) => toggled[cat] ?? grouped[cat].length > 0;

  function openReply(thread: EmailThread) {
    setReplyTo({
      to: clientEmail,
      subject: `Re: ${thread.subject.replace(/^Re:\s*/i, '')}`,
    });
  }

  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map((cat) => (
        <section key={cat}>
          <button
            type="button"
            aria-expanded={isOpen(cat)}
            onClick={() => setToggled((s) => ({ ...s, [cat]: !isOpen(cat) }))}
            className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
          >
            <span>
              {t(CATEGORY_LABEL[cat].key, { defaultValue: CATEGORY_LABEL[cat].defaultValue })}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({grouped[cat].length})
              </span>
            </span>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                !isOpen(cat) && '-rotate-90',
              )}
            />
          </button>

          {isOpen(cat) && grouped[cat].length > 0 && (
            <div className="mt-2 space-y-3">
              {grouped[cat].map((thread) => (
                <article
                  key={thread.key}
                  className="min-w-0 overflow-visible rounded-xl border border-border/50 bg-card px-4 py-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-foreground">
                        {thread.subject}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t('thread.count', {
                          count: thread.messages.length,
                          defaultValue_one: '{{count}} message',
                          defaultValue_other: '{{count}} messages',
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => openReply(thread)}
                    >
                      <Reply className="size-3.5" />
                      {t('thread.reply', { defaultValue: 'Reply' })}
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {thread.messages.map((m) => (
                      <EmailMessage key={m.id} message={m} locale={locale} t={t} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      <SendEmailDialog
        open={replyTo !== null}
        identity="personal"
        to={replyTo?.to ?? ''}
        subject={replyTo?.subject ?? ''}
        body=""
        onClose={() => setReplyTo(null)}
      />
    </div>
  );
}
```

(`EmailMessage` below stays byte-identical to the current file.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run src/features/email/`
Expected: PASS — all email tests (EmailThreadList 4, useEmailThreads 7, plus the other 2 email test files).

- [ ] **Step 6: Commit**

```bash
git add src/features/email/EmailThreadList.tsx src/features/email/EmailThreadList.test.tsx src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): Emails tab grouped into collapsible Sales/Accounting/Technical sections"
```

---

### Task 6: Emails tab on the Lead page + final verification

**Files:**
- Modify: `src/features/leads/LeadDetailPage.tsx`
- Modify: `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json`

**Interfaces:**
- Consumes: `EmailThreadList` props `{ scope: { lead_id }, clientEmail }`; `leadId` and `lead.email` already in scope in the component (`lead.email ?? ''` pattern already used at line ~369).

- [ ] **Step 1: i18n keys**

`src/i18n/locales/en/leads.json` — in the existing `"tabs"` object add `"emails": "Emails"`.
`src/i18n/locales/el/leads.json` — in `"tabs"` add `"emails": "Email"` (matches jobs.json el).

- [ ] **Step 2: Add the tab**

In `src/features/leads/LeadDetailPage.tsx`:

Import (with the other feature imports):

```tsx
import { EmailThreadList } from '@/features/email/EmailThreadList';
```

In `<DetailTabsList>` after the `attachments` trigger:

```tsx
          <TabsTrigger value="emails" className={detailTabTriggerClass}>
            {t('tabs.emails')}
          </TabsTrigger>
```

After the `attachments` `<TabsContent>` block (mirror the job page pattern, `JobDetailPage.tsx:651-655`):

```tsx
        <TabsContent value="emails" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <EmailThreadList scope={{ lead_id: leadId }} clientEmail={lead.email ?? ''} />
          </div>
        </TabsContent>
```

Note: the other TabsContent blocks in LeadDetailPage may use `mt-1` — match whatever spacing class the sibling `attachments` TabsContent in THIS file uses, keeping the inner card div as above.

- [ ] **Step 3: Full verification**

```bash
npx vitest run src/features/email/   # expected: all pass
npm run build                        # expected: exit 0, zero eslint warnings
```

- [ ] **Step 4: Commit + push**

```bash
git add src/features/leads/LeadDetailPage.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): Emails tab on the lead page"
git fetch origin && git log HEAD..origin/main --oneline   # expect empty (parallel-owner check)
git push origin main
```

- [ ] **Step 5: Live smoke (visual)**

As admin on prod: open a deal with captured emails (e.g. Orthohouse 000280) → Emails tab shows Sales/Accounting/Technical headers with counts, Technical holds the WEBDEV thread, headers toggle. Open any lead → Emails tab renders (likely the empty state until a prospect email is captured). Hard-refresh first if chunks 404 (stale-chunk gotcha).

---

## Changes / Revert

| Commit (task) | Revert |
| --- | --- |
| gmail-sync lead_id (1) | redeploy previous fn version (extra column tolerated) |
| Migration 20260710150000 (2) | ROLLBACK block in the file: retag-undo UPDATE, restore fn v2 + policy v1, drop column |
| Migration 20260710151000 (3) | re-apply the pre-change body pasted into the migration's header comment |
| Hook + component + lead tab (4–6) | `git revert` the three commits |
