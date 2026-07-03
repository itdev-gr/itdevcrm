# Business Profile Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per user preference, implementer subagents run with model `opus`.

**Goal:** A Business Profile Name can be added by sales (lead + deal), accounting (deal), and technical (job Info tab); it seeds/syncs into the local SEO job's existing "Business profile" field, which becomes the kanban card title when set.

**Architecture:** Two new text columns (`leads.business_profile_name`, `deals.business_profile_name`). `convert_lead_to_client` copies lead→deal. A new `BEFORE INSERT` trigger on `jobs` seeds `details.business_profile` from the deal at spawn; a new `AFTER UPDATE` trigger on `deals` late-syncs into jobs whose field is still empty (never overwrites). Frontend: a pure `jobCardHeading` helper drives the card title/subtitle; new inputs on the lead form and deal Notes area.

**Tech Stack:** Supabase Postgres (migration via MCP `apply_migration`), React + TS (Vite), TanStack Query, `useAutoSave`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-business-profile-name-design.md`

## Global Constraints

- Verify frontend with `npm run build` (tsc -b + eslint --max-warnings=0, `noUncheckedIndexedAccess`) — it is stricter than `tsc --noEmit`.
- Prod function bodies drift: before applying the migration, read the LIVE `convert_lead_to_client` via `pg_get_functiondef` and reconcile (Task 1 Step 2 is mandatory).
- Prod DDL goes through Supabase MCP `apply_migration` — never Bash/psql. DML/read verification via MCP `execute_sql`.
- The full vitest suite runs against PROD and has 17 known test-fixture failures (2026-07-02). Run only the targeted test files named in this plan; do not "fix" unrelated failures.
- Never put literal secrets/tokens in files or docs.
- Greek label everywhere: "Όνομα Προφίλ Επιχείρησης". English: "Business Profile Name".
- Job details key is the EXISTING `business_profile` (do not invent a new key). Deal/lead column is `business_profile_name`.
- Commit per task; push only in the final task.

---

## File structure

- `supabase/migrations/20260703120000_business_profile_name.sql` — new: 2 columns + `convert_lead_to_client` replace + `jobs_seed_local_business_profile` trigger + `deals_sync_business_profile_name` trigger + rollback block.
- `src/types/supabase.ts` — modify: add `business_profile_name` to `leads` and `deals` Row/Insert/Update.
- `src/features/leads/LeadRowEditor.test.tsx` — modify: add the new column to the lead fixture.
- `src/features/jobs/jobCardTitle.ts` — new: pure `jobCardHeading` helper.
- `src/features/jobs/jobCardTitle.test.ts` — new: helper tests (TDD).
- `src/features/jobs/JobsKanbanCard.tsx` — modify: use the helper for headline/subtitle.
- `src/features/leads/LeadForm.tsx` — modify: new "Business Profile Name" field.
- `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json` — modify: `form.business_profile_name`.
- `src/features/deals/DealNotesArea.tsx` — modify: new editable field.
- `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json` — modify: `notes_area.business_profile_name`.

---

## Task 1: DB migration (columns + convert RPC + two triggers)

**Files:**
- Create: `supabase/migrations/20260703120000_business_profile_name.sql`

**Interfaces:**
- Produces: columns `leads.business_profile_name text`, `deals.business_profile_name text` (Task 2 types, Tasks 4–5 UI); job JSONB key `details.business_profile` filled at spawn + on late deal edits (read by Task 3's helper — key already exists in `serviceInfoFields.ts` LOCAL).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260703120000_business_profile_name.sql` with EXACTLY this content. The `convert_lead_to_client` body is the 2026-07-02 `cash_charge_vat` version with ONE column added (`business_profile_name` in the deals insert, value `l.business_profile_name`):

```sql
-- Business Profile Name: lead -> deal -> local_seo job details.business_profile.
-- Editable by sales (lead+deal), accounting (deal), technical (job Info tab).
-- Seed at job spawn + late-sync deal->job only-when-empty (never overwrites).
-- Spec: docs/superpowers/specs/2026-07-03-business-profile-name-design.md
-- Forward-only. Rollback at bottom.

alter table public.leads add column if not exists business_profile_name text;
alter table public.deals add column if not exists business_profile_name text;

-- convert_lead_to_client: copy the new lead column onto the created deal.
-- Body = live 2026-07-02 (cash_charge_vat) definition + business_profile_name.
create or replace function public.convert_lead_to_client(target_lead_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  l record; errors text[] := '{}'; service_count int;
  won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select * into l from public.leads where id = target_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'errors', array['lead_not_found']); end if;
  if l.converted_at is not null then return jsonb_build_object('ok', false, 'errors', array['already_converted']); end if;
  if l.archived then return jsonb_build_object('ok', false, 'errors', array['lead_archived']); end if;
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required'); end if;
  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then errors := array_append(errors, 'at_least_one_service_required'); end if;
  if l.email is null or l.email = '' then errors := array_append(errors, 'email_required'); end if;
  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required'); end if;
  if l.company_name is null or trim(l.company_name) = '' then errors := array_append(errors, 'company_name_required'); end if;
  if l.payment_method is null or l.payment_method = '' then errors := array_append(errors, 'payment_method_required'); end if;
  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors); end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code, start_date,
    contact_info, additional_contacts
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date,
    l.contact_info, coalesce(l.additional_contacts, '[]'::jsonb)
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, cash_charge_vat, sales_note,
    business_profile_url, business_profile_name
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.cash_charge_vat, l.additional_notes,
    l.business_profile_url, l.business_profile_name
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.leads set
      converted_at = now(), converted_client_id = new_client_id, converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id), won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code));
  end if;

  return jsonb_build_object('ok', true, 'lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code);
end $function$;

-- Seed at spawn: local_seo job details.business_profile from the deal, only when
-- empty. Own trigger fn (repo pattern: one seed concern per trigger —
-- jobs_seed_local_profile_url and jobs_seed_web_website stay untouched).
create or replace function public.jobs_seed_local_business_profile()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text;
begin
  if new.service_type = 'local_seo'
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'business_profile','')), '') is null then
    select nullif(trim(coalesce(business_profile_name,'')), '')
      into v_name from public.deals where id = new.deal_id;
    if v_name is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('business_profile', v_name);
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists jobs_seed_local_business_profile on public.jobs;
create trigger jobs_seed_local_business_profile
  before insert on public.jobs
  for each row execute function public.jobs_seed_local_business_profile();

-- Late-add sync: a deal-level name set AFTER the local_seo job exists flows to
-- jobs whose field is still empty. One-way deal->job; never overwrites a
-- non-empty (e.g. technical's manual) job value; skips archived jobs.
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if nullif(trim(coalesce(new.business_profile_name,'')), '') is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', trim(new.business_profile_name))
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is null;
  end if;
  return new;
end $function$;

drop trigger if exists deals_sync_business_profile_name on public.deals;
create trigger deals_sync_business_profile_name
  after update of business_profile_name on public.deals
  for each row execute function public.deals_sync_business_profile_name();

-- ROLLBACK (manual):
--   drop trigger if exists deals_sync_business_profile_name on public.deals;
--   drop function if exists public.deals_sync_business_profile_name();
--   drop trigger if exists jobs_seed_local_business_profile on public.jobs;
--   drop function if exists public.jobs_seed_local_business_profile();
--   alter table public.deals drop column if exists business_profile_name;
--   alter table public.leads drop column if exists business_profile_name;
--   -- then re-apply the prior convert_lead_to_client body: the version in
--   -- supabase/migrations/20260702160000_cash_charge_vat.sql (without
--   -- business_profile_name).
```

- [ ] **Step 2: Drift-check the live convert_lead_to_client (MANDATORY, read-only)**

Run via MCP `execute_sql`:

```sql
select pg_get_functiondef('public.convert_lead_to_client(uuid)'::regprocedure);
```

Compare against the migration's body: the live body must be IDENTICAL except for the two added `business_profile_name` mentions (column list + values). If anything else differs (extra guards, new columns), STOP — rebuild the migration's function body from the live definition + the two additions, and note the drift in the final report.

- [ ] **Step 3: Apply to prod via MCP**

Apply with the Supabase MCP tool `apply_migration` (project `xujlrclyzxrvxszepquy`, name `business_profile_name`, the SQL above). Do NOT run DDL via Bash/psql. (The user approved this plan's execution — that is the go-ahead for this write.)

- [ ] **Step 4: Verify columns + all three trigger behaviors (rolled-back writes)**

Run each block via MCP `execute_sql`. Test deals are inserted with `archived = true` to dodge the `deals_one_live_per_client` partial unique index (triggers are unaffected); every block ends in `rollback` so nothing persists.

```sql
-- 4a. columns exist — expect leads_col = 1, deals_col = 1
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='leads' and column_name='business_profile_name') as leads_col,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='deals' and column_name='business_profile_name') as deals_col;
```

```sql
-- 4b. seed at spawn — expect seeded = 'Seed Name Co'
begin;
insert into public.deals (client_id, title, code, business_profile_name, accounting_stage_id, archived)
  select client_id, 'BPNAME SEED TEST', '999998', 'Seed Name Co', accounting_stage_id, true
  from public.deals limit 1;
insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, status, started_at)
  select id, client_id, 'local_seo', 'recurring_monthly', 0, 'bpname seed test', 'active', now()
  from public.deals where code = '999998' and title = 'BPNAME SEED TEST';
select details->>'business_profile' as seeded
  from public.jobs where title = 'bpname seed test';
rollback;
```

```sql
-- 4c. late-add sync fills an empty job — expect synced = 'Late Added Co'
begin;
insert into public.deals (client_id, title, code, accounting_stage_id, archived)
  select client_id, 'BPNAME SYNC TEST', '999997', accounting_stage_id, true
  from public.deals limit 1;
insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, status, started_at)
  select id, client_id, 'local_seo', 'recurring_monthly', 0, 'bpname sync test', 'active', now()
  from public.deals where code = '999997' and title = 'BPNAME SYNC TEST';
update public.deals set business_profile_name = 'Late Added Co'
  where code = '999997' and title = 'BPNAME SYNC TEST';
select j.details->>'business_profile' as synced
  from public.jobs j join public.deals d on d.id = j.deal_id
  where d.code = '999997' and d.title = 'BPNAME SYNC TEST';
rollback;
```

```sql
-- 4d. never overwrites a manual job value — expect kept = 'Manual Value'
begin;
insert into public.deals (client_id, title, code, accounting_stage_id, archived)
  select client_id, 'BPNAME KEEP TEST', '999996', accounting_stage_id, true
  from public.deals limit 1;
insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, status, started_at, details)
  select id, client_id, 'local_seo', 'recurring_monthly', 0, 'bpname keep test', 'active', now(),
         jsonb_build_object('business_profile', 'Manual Value')
  from public.deals where code = '999996' and title = 'BPNAME KEEP TEST';
update public.deals set business_profile_name = 'Should Not Win'
  where code = '999996' and title = 'BPNAME KEEP TEST';
select j.details->>'business_profile' as kept
  from public.jobs j join public.deals d on d.id = j.deal_id
  where d.code = '999996' and d.title = 'BPNAME KEEP TEST';
rollback;
```

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/20260703120000_business_profile_name.sql
git commit -m "feat(sales): business_profile_name columns + convert copy + local_seo seed/sync triggers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Types (hand-added) + test fixture

**Files:**
- Modify: `src/types/supabase.ts` (the `leads` and `deals` table Row/Insert/Update)
- Modify: `src/features/leads/LeadRowEditor.test.tsx` (lead fixture)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `business_profile_name: string | null` on `leads`/`deals` Row (and optional on Insert/Update) — used by Tasks 4–5 (`lead.business_profile_name`, `deal.business_profile_name`, update payloads).

`types:gen` needs CLI auth (not available); add the fields manually, exactly like the neighbouring `business_profile_url` lines.

- [ ] **Step 1: Add to the `leads` table types**

In `src/types/supabase.ts`, in the `leads` block: next to the existing `business_profile_url: string | null` line in `Row` add `business_profile_name: string | null`; next to `business_profile_url?: string | null` in `Insert` add `business_profile_name?: string | null`; same in `Update`.

- [ ] **Step 2: Add to the `deals` table types**

Same three additions in the `deals` block, adjacent to its `business_profile_url` lines.

- [ ] **Step 3: Update the lead fixture**

In `src/features/leads/LeadRowEditor.test.tsx`, the lead fixture contains `business_profile_url: null,` — add directly below it:

```ts
  business_profile_name: null,
```

(If the fixture is `Partial`-typed and the build passes without this, add it anyway for completeness — it is harmless.)

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: PASS (no TS errors, no eslint warnings).

- [ ] **Step 5: Commit**

```bash
git add src/types/supabase.ts src/features/leads/LeadRowEditor.test.tsx
git commit -m "types(leads,deals): business_profile_name column

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Kanban card title helper (TDD) + wire into the card

**Files:**
- Create: `src/features/jobs/jobCardTitle.ts`
- Test: `src/features/jobs/jobCardTitle.test.ts`
- Modify: `src/features/jobs/JobsKanbanCard.tsx:51-57`

**Interfaces:**
- Consumes: nothing from other tasks (reads the existing `details.business_profile` JSONB key — present today on hand-filled jobs).
- Produces: `jobCardHeading(job: JobCardHeadingInput): { headline: string; subtitleParts: string[] }` where `JobCardHeadingInput = { service_type: string; details?: Record<string, unknown> | null; client?: { name?: string | null; contact_first_name?: string | null; contact_last_name?: string | null } | null; deal?: { title?: string | null } | null }`. `JobRow` is structurally assignable to it.

- [ ] **Step 1: Write the failing tests**

Create `src/features/jobs/jobCardTitle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { jobCardHeading } from './jobCardTitle';

const client = {
  name: 'Acme Ltd',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
};

describe('jobCardHeading', () => {
  it('titles a local_seo card by details.business_profile, moving names to the subtitle', () => {
    const r = jobCardHeading({
      service_type: 'local_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: { title: 'Acme deal' },
    });
    expect(r.headline).toBe('Acme Bakery Athens');
    expect(r.subtitleParts).toEqual(['Maria Papadopoulou', 'Acme Ltd']);
  });

  it('titles an ai_seo card the same way', () => {
    const r = jobCardHeading({
      service_type: 'ai_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: null,
    });
    expect(r.headline).toBe('Acme Bakery Athens');
  });

  it('ignores business_profile on other service types', () => {
    const r = jobCardHeading({
      service_type: 'web_dev',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: null,
    });
    expect(r.headline).toBe('Maria Papadopoulou');
  });

  it('falls back when business_profile is empty or whitespace-only', () => {
    for (const bp of [undefined, null, '', '   ']) {
      const r = jobCardHeading({
        service_type: 'local_seo',
        details: { business_profile: bp },
        client,
        deal: null,
      });
      expect(r.headline).toBe('Maria Papadopoulou');
    }
  });

  it('keeps the fallback chain: contact name, client name, deal title, dash', () => {
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client, deal: null }).headline,
    ).toBe('Maria Papadopoulou');
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
        deal: null,
      }).headline,
    ).toBe('Acme Ltd');
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: null,
        deal: { title: 'Acme deal' },
      }).headline,
    ).toBe('Acme deal');
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client: null, deal: null })
        .headline,
    ).toBe('—');
  });

  it('in fallback mode, subtitle carries the client name only when a contact name exists', () => {
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client, deal: null })
        .subtitleParts,
    ).toEqual(['Acme Ltd']);
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
        deal: null,
      }).subtitleParts,
    ).toEqual([]);
  });

  it('with a business profile but no contact name, subtitle is just the client name', () => {
    const r = jobCardHeading({
      service_type: 'local_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
      deal: null,
    });
    expect(r.subtitleParts).toEqual(['Acme Ltd']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/jobs/jobCardTitle.test.ts`
Expected: FAIL — cannot resolve `./jobCardTitle`.

- [ ] **Step 3: Implement the helper**

Create `src/features/jobs/jobCardTitle.ts`:

```ts
// Card heading for the jobs kanban. Local SEO / AI SEO cards are titled by the
// job's Business profile (details.business_profile — seeded from the deal's
// business_profile_name or typed by technical) when present; the client
// identity then moves into the subtitle so it stays visible.
export type JobCardHeadingInput = {
  service_type: string;
  details?: Record<string, unknown> | null;
  client?: {
    name?: string | null;
    contact_first_name?: string | null;
    contact_last_name?: string | null;
  } | null;
  deal?: { title?: string | null } | null;
};

const BUSINESS_PROFILE_SERVICES = new Set(['local_seo', 'ai_seo']);

export function jobCardHeading(job: JobCardHeadingInput): {
  headline: string;
  subtitleParts: string[];
} {
  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const businessProfile = BUSINESS_PROFILE_SERVICES.has(job.service_type)
    ? String(job.details?.['business_profile'] ?? '').trim()
    : '';
  if (businessProfile) {
    return {
      headline: businessProfile,
      subtitleParts: [contactName, job.client?.name].filter((s): s is string => Boolean(s)),
    };
  }
  return {
    headline: contactName || job.client?.name || job.deal?.title || '—',
    subtitleParts: contactName && job.client?.name ? [job.client.name] : [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/jobs/jobCardTitle.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire into JobsKanbanCard**

In `src/features/jobs/JobsKanbanCard.tsx`, add the import next to the other `./` imports:

```tsx
import { jobCardHeading } from './jobCardTitle';
```

Replace the current headline/subtitle block (lines 51–57):

```tsx
  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const headline = contactName || job.client?.name || job.deal?.title || '—';
  const subtitle = [contactName ? job.client?.name : null, industryLabel(job.client?.industry, lang)]
    .filter(Boolean)
    .join(' · ');
```

with:

```tsx
  const { headline, subtitleParts } = jobCardHeading(job);
  const subtitle = [...subtitleParts, industryLabel(job.client?.industry, lang)]
    .filter(Boolean)
    .join(' · ');
```

- [ ] **Step 6: Build + targeted jobs tests**

Run: `npm run build`
Expected: PASS.
Run: `npx vitest run src/features/jobs`
Expected: PASS (all jobs-feature test files, including the existing `jobSearch`/`serviceInfoFields` suites).

- [ ] **Step 7: Commit**

```bash
git add src/features/jobs/jobCardTitle.ts src/features/jobs/jobCardTitle.test.ts src/features/jobs/JobsKanbanCard.tsx
git commit -m "feat(jobs): title local/AI SEO kanban cards by Business profile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Lead form — "Business Profile Name" field

**Files:**
- Modify: `src/features/leads/LeadForm.tsx`
- Modify: `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json`

**Interfaces:**
- Consumes: `leads.business_profile_name` types (Task 2).
- Produces: sales-editable lead field auto-saving to `leads.business_profile_name`.

- [ ] **Step 1: Add the i18n labels**

In `src/i18n/locales/en/leads.json`, in the `"form"` object the LAST key is currently `"business_profile_url": "Business Profile URL"` (no trailing comma). Change it to:

```json
    "business_profile_url": "Business Profile URL",
    "business_profile_name": "Business Profile Name"
```

In `src/i18n/locales/el/leads.json`, same spot (`"business_profile_url": "URL Προφίλ Επιχείρησης"` is the last key in `"form"`):

```json
    "business_profile_url": "URL Προφίλ Επιχείρησης",
    "business_profile_name": "Όνομα Προφίλ Επιχείρησης"
```

- [ ] **Step 2: Add state**

In `src/features/leads/LeadForm.tsx`, directly below line 59 (`const [businessProfileUrl, ...`), add:

```tsx
  const [businessProfileName, setBusinessProfileName] = useState(lead.business_profile_name ?? '');
```

- [ ] **Step 3: Extend the auto-save patch (object + deps)**

In the `patch` `useMemo`, after `business_profile_url: businessProfileUrl.trim() || null,` (line 105) add:

```tsx
      business_profile_name: businessProfileName.trim() || null,
```

In the dependency array, after `businessProfileUrl,` (line 131) add:

```tsx
      businessProfileName,
```

- [ ] **Step 4: Render the input**

In the Company section JSX, immediately after the Business Profile URL `<div>` (the block containing `id="bpurl"`, lines 242–252), add:

```tsx
            <div>
              <Label htmlFor="bpname">{t('form.business_profile_name')}</Label>
              <Input
                id="bpname"
                value={businessProfileName}
                onChange={(e) => setBusinessProfileName(e.target.value)}
                className="mt-1.5"
              />
            </div>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/leads/LeadForm.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): Business Profile Name field on the lead form

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Deal page — editable field (sales + accounting)

**Files:**
- Modify: `src/features/deals/DealNotesArea.tsx`
- Modify: `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json`

**Interfaces:**
- Consumes: `deals.business_profile_name` types (Task 2).
- Produces: deal-page field auto-saving to `deals.business_profile_name`; a save fires the Task 1 sync trigger. No permission work — `deals_update` RLS already covers sales + accounting; the component renders un-gated like the existing fields.

- [ ] **Step 1: Add the i18n labels**

In `src/i18n/locales/en/deals.json`, in `"notes_area"`, after `"business_profile_url": "Business Profile URL",` add:

```json
    "business_profile_name": "Business Profile Name",
```

In `src/i18n/locales/el/deals.json`, after `"business_profile_url": "URL Προφίλ Επιχείρησης",` add:

```json
    "business_profile_name": "Όνομα Προφίλ Επιχείρησης",
```

- [ ] **Step 2: Add state + extend the patch + the update**

In `src/features/deals/DealNotesArea.tsx`, directly below `const [businessProfileUrl, ...` (line 31), add:

```tsx
  const [businessProfileName, setBusinessProfileName] = useState(deal.business_profile_name ?? '');
```

Replace the `patch` memo + auto-save (lines 37–47):

```tsx
  const patch = useMemo(
    () => ({ sales_note: salesNote.trim() || null, business_profile_url: businessProfileUrl.trim() || null }),
    [salesNote, businessProfileUrl],
  );
  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({ sales_note: next.sales_note, business_profile_url: next.business_profile_url })
      .eq('id', deal.id);
```

with:

```tsx
  const patch = useMemo(
    () => ({
      sales_note: salesNote.trim() || null,
      business_profile_url: businessProfileUrl.trim() || null,
      business_profile_name: businessProfileName.trim() || null,
    }),
    [salesNote, businessProfileUrl, businessProfileName],
  );
  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({
        sales_note: next.sales_note,
        business_profile_url: next.business_profile_url,
        business_profile_name: next.business_profile_name,
      })
      .eq('id', deal.id);
```

(the following `if (error) …` / `invalidateQueries` lines stay as they are).

- [ ] **Step 3: Render the input**

In the returned JSX, immediately after the Business Profile URL `<div>` (the block containing `id="deal-bpurl"`, lines 62–72), add:

```tsx
      <div>
        <Label htmlFor="deal-bpname">{t('notes_area.business_profile_name')}</Label>
        <Input
          id="deal-bpname"
          value={businessProfileName}
          onChange={(e) => setBusinessProfileName(e.target.value)}
          className="mt-1.5"
        />
      </div>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealNotesArea.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(deals): editable Business Profile Name on the deal Overview

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification + push + live smoke

**Files:** none new.

- [ ] **Step 1: Targeted tests + build**

Run: `npx vitest run src/features/jobs src/features/leads src/features/deals`
Expected: PASS. (Do NOT run the full suite — it hits prod and has 17 known fixture failures unrelated to this change.)
Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Live smoke (after the Vercel deploy; hard-refresh to dodge stale chunks)**

On `www.itdevcrm.com` as admin (info@itdev.gr):

1. Open a lead → Company → enter a **Business Profile Name** → autosaves.
2. Convert to Won (needs service `local_seo` + value + payment method) → open the deal → the Notes area shows **Business Profile Name** (and URL) editable.
3. Move the deal to Paid In Full → open the spawned local_seo job → Info tab → **Business profile** pre-filled with the name.
4. Local SEO kanban → the job's card is **titled** by the name; contact/client name is in the subtitle; board search finds the card by the name.
5. Late-add check: clear the job's Business profile (Info tab), edit the name on the deal → job Info + card title update (sync-when-empty).
6. Clean up the test lead/deal/client/jobs (FK-safe order, as in the email smoke-test runbook).

Read-only DB cross-check:

```sql
select d.business_profile_name, j.details->>'business_profile' as job_business_profile
from public.deals d join public.jobs j on j.deal_id = d.id and j.service_type = 'local_seo'
where d.code = '<the test deal code>';
```

Expected: both equal the entered name.

---

## Self-review notes

- **Spec coverage:** columns + convert copy → Task 1; seed trigger → Task 1 (`jobs_seed_local_business_profile`); late-add sync (spec §5) → Task 1 (`deals_sync_business_profile_name`) + verify 4c/4d; three edit surfaces → sales lead (Task 4), sales+accounting deal (Task 5, RLS pre-existing), technical job Info tab (already exists, no change); card title + subtitle rule (spec §6) → Task 3; types → Task 2; search → no change needed (`jobSearch.ts` already indexes `details.business_profile`); testing/revert → Tasks 1/3/6 + migration rollback block.
- **Drift safety:** the embedded convert body is the newest in-repo version (2026-07-02 `cash_charge_vat`); Task 1 Step 2 gates the apply on a live `pg_get_functiondef` match.
- **Type consistency:** DB/lead/deal column `business_profile_name`; job JSONB key `business_profile` (existing, `serviceInfoFields.ts` LOCAL); helper `jobCardHeading` returns `{ headline, subtitleParts }` — names match across Tasks 3–5 and the tests.
- **Semantics:** seed + sync are only-when-empty and trim-guarded; sync skips archived jobs and never overwrites; card rule scoped to `local_seo`/`ai_seo` (AI-SEO cards look the same on the Web SEO board by design).
