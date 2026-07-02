# SEO Jobs at Awaiting Payment + Per-Job Email-Status Badge — Implementation Plan

> **STATUS 2026-07-02:** Part A (Tasks A1–A3) was DROPPED — the owner corrected the requirement to keep SEO+emails at Fully Paid (= current behavior; no code needed). Only **Part B (Tasks B1–B4 + C, the email-status badge)** was implemented + shipped (commits 360fb92..985287a). The Part A section below is retained for history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the SEO jobs (and fire their access emails) the first time a deal reaches Awaiting Payment (or Fully Paid), and add a per-job onboarding-email status badge (Sent / Not sent + Resend / Coming soon) on every job's board card and detail page.

**Architecture:** Part A adds a SEO-scoped release function `release_seo_jobs_for_deal` (the existing `release_jobs_for_deal` loop filtered to `web_seo/local_seo/ai_seo`, then the existing `release_deal_jobs`) and calls it from a new `awaiting_payment` branch on the existing `deals_hold_jobs_on_stage_change` trigger; the paid_in_full branch and all other services are unchanged, idempotency comes from the existing job-exists guards, and access emails fire automatically via the existing `jobs_seo_onboarding_email` trigger. Part B extends the existing SEO-access frontend (`seoAccessButton.ts` + `RequestSeoAccessButton`) into an explicit status badge shown on both the kanban card and the job detail page, reusing the existing `seo_access_sent_map` RPC and `useRequestSeoAccess` resend.

**Tech Stack:** Postgres 15 (Supabase), PL/pgSQL, React/TypeScript (Vite), vitest, Supabase Management API for prod DDL + the RAISE-harness test pattern.

**Spec:** `docs/superpowers/specs/2026-07-02-seo-jobs-awaiting-payment-and-email-status-design.md`

## Global Constraints

- Prod project id `xujlrclyzxrvxszepquy`. Apply DDL via Supabase MCP `apply_migration` OR the Management API `/database/query` with a `curl/8.x` User-Agent (DDL works via curl; plain urllib is Cloudflare-1010 blocked). pgtap is NOT on prod — SQL tests use the RAISE-EXCEPTION savepoint-rollback harness pattern run via the API.
- Prod function bodies drift from the .sql files — before editing an existing function, read the LIVE body via `pg_get_functiondef` and base the change on that.
- `deal_payments`/`jobs` generated columns are never in INSERT lists. `jobs.stage_id` NULL = off-board; a SEO job's onboarding email fires only when its `stage_id` code becomes `new_project` (trigger `jobs_seo_onboarding_email`).
- SEO scope = `web_seo`, `local_seo`, `ai_seo` only. Web Dev/Hosting stay at Partial Payment; Ads/Social stay at Fully Paid; the AI SEO billing parent + recurring system are untouched.
- Access-email dedupe key = `<setting_key>:<deal_id>` (`webseo_gsc` / `localseo_gbp`) — one per deal per service; do not change it.
- Frontend build must pass `npm run build` (tsc -b strict + eslint --max-warnings=0). Assert valid array indices with `!`.
- Push directly to `main`, no PR. Atomic commits. Every migration ends with a commented revert block. Rotate the chat-shared sbp token after the session.

---

### Task A1: `release_seo_jobs_for_deal` — SEO-scoped placement

**Files:**
- Create: `supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql`
- Test: `supabase/tests/seo_jobs_at_awaiting_payment.sql`

**Interfaces:**
- Consumes: existing `public.release_deal_jobs(uuid)`, `public.team_lead_for_group(text)`, `public.pipeline_stages`, `public.groups`, `public.jobs`, `public.deals.services_planned`.
- Produces: `public.release_seo_jobs_for_deal(target_deal_id uuid) returns int` — places the deal's `web_seo`/`local_seo`/`ai_seo` jobs on their boards (idempotent) and runs `release_deal_jobs` (onboarding → emails).

- [ ] **Step 1: Write the failing test** — create `supabase/tests/seo_jobs_at_awaiting_payment.sql` with this first scenario (RAISE-harness style, runnable via `runharness.py`):

```sql
-- SEO jobs at Awaiting Payment harness (savepoint-rollback, RAISE terminal).
\set ON_ERROR_STOP off

-- ---- AW1: awaiting_payment first landing places SEO jobs on their boards + queues access email
do $$
declare v_client uuid; v_deal uuid; v_web_jobs int; v_local_jobs int; v_ads_jobs int; v_email int;
begin
  insert into public.clients (name, email, country) values ('aw1_'||gen_random_uuid()::text,'aw1@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id, services_planned)
    values (v_client,'AW1','aw1','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'),
            jsonb_build_array(
              jsonb_build_object('service_type','web_seo','billing_type','recurring_monthly','monthly_amount','100'),
              jsonb_build_object('service_type','local_seo','billing_type','recurring_monthly','monthly_amount','100'),
              jsonb_build_object('service_type','ads','billing_type','recurring_monthly','monthly_amount','100')))
    returning id into v_deal;

  -- move deal to awaiting_payment (fires the trigger from Task A2)
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment')
   where id = v_deal;

  select count(*) into v_web_jobs   from public.jobs where deal_id=v_deal and service_type='web_seo'  and stage_id is not null and not archived;
  select count(*) into v_local_jobs from public.jobs where deal_id=v_deal and service_type='local_seo' and stage_id is not null and not archived;
  select count(*) into v_ads_jobs   from public.jobs where deal_id=v_deal and service_type='ads'       and stage_id is not null and not archived;
  select count(*) into v_email from public.email_outbox where dedupe_key in ('webseo_gsc:'||v_deal::text,'localseo_gbp:'||v_deal::text);

  if v_web_jobs < 1 or v_local_jobs < 1 then
    raise exception 'RESULT :: FAIL AW1 :: expected SEO jobs on-board, got web=% local=%', v_web_jobs, v_local_jobs;
  end if;
  if v_ads_jobs <> 0 then
    raise exception 'RESULT :: FAIL AW1 :: ads must NOT be placed at awaiting_payment, got %', v_ads_jobs;
  end if;
  if v_email < 1 then
    raise exception 'RESULT :: FAIL AW1 :: expected access email(s) queued, got %', v_email;
  end if;
  raise exception 'RESULT :: PASS AW1 :: awaiting_payment placed SEO jobs + queued access email, left ads off-board';
end $$;
```

- [ ] **Step 2: Run it — expect FAIL (RED).** From the scratchpad dir: `python3 runharness.py /Users/marios/Desktop/Cursor/itdevcrm/supabase/tests/seo_jobs_at_awaiting_payment.sql`. Expected: `AW1 FAIL` (no trigger yet, so nothing placed) — or the whole block errors. Record it.

- [ ] **Step 3: Create the migration with `release_seo_jobs_for_deal`.** Put this in `supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql` (it is the `release_jobs_for_deal` loop verbatim, filtered to SEO, `should_block=false`, then `release_deal_jobs`):

```sql
-- =========================================================================
-- 20260702160000_seo_jobs_at_awaiting_payment.sql
-- Create SEO jobs (web_seo/local_seo/ai_seo) + fire access emails the first
-- time a deal reaches awaiting_payment (or paid_in_full). Web Dev/Hosting
-- (Partial) + Ads/Social (Fully Paid) unchanged. Idempotent via job-exists.
-- =========================================================================

-- ---- SEO-scoped placement (mirrors release_jobs_for_deal, SEO only) ------
create or replace function public.release_seo_jobs_for_deal(target_deal_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  d record; service jsonb; service_type_val text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0;
  existing_job_id uuid; existing_stage uuid;
  v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid; v_amt numeric;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','ai_seo') then continue; end if;   -- SEO ONLY
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;

    if service_type_val = 'ai_seo' then
      select id into existing_job_id from public.jobs
        where deal_id = d.id and service_type = 'ai_seo' and not archived order by created_at limit 1;
      if existing_job_id is not null then continue; end if;
      v_amt := coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0);
      insert into public.jobs (deal_id, client_id, service_type, billing_type, one_time_amount, monthly_amount,
          setup_fee, amount_net, title, is_custom, billing_only, billing_active, status, stage_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', billing_type_val, one_time_amt, monthly_amt, setup_fee_val, v_amt,
          'AI SEO', false, true, true, 'active', null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'web_seo', billing_type_val, 0, 'AI SEO — Web', true, false, false, 'active',
          v_web_stage, v_web_group, v_parent, now(), d.code);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'local_seo', billing_type_val, 0, 'AI SEO — Local', true, false, false, 'active',
          v_local_stage, v_local_group, v_parent, now(), d.code);

      inserted := inserted + 1;
      continue;
    end if;

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);
    select id into job_stage_id from public.pipeline_stages
      where board = service_type_val and archived = false order by position limit 1;

    select id, stage_id into existing_job_id, existing_stage
      from public.jobs where deal_id = d.id and service_type = service_type_val and not archived
      order by created_at limit 1;

    if existing_job_id is not null then
      if existing_stage is null then
        update public.jobs set
          stage_id = job_stage_id,
          owner_user_id = coalesce(owner_user_id, owner_id_val),
          assigned_group_id = coalesce(assigned_group_id, group_id_val)
        where id = existing_job_id;
        inserted := inserted + 1;
      end if;
      continue;
    end if;

    insert into public.jobs (deal_id, client_id, service_type, billing_type,
        one_time_amount, monthly_amount, setup_fee, amount_net, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0),
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code);
    inserted := inserted + 1;
  end loop;

  perform public.release_deal_jobs(target_deal_id);   -- onboard/renew SEO -> new_project + email (idempotent)
  return inserted;
end $$;
grant execute on function public.release_seo_jobs_for_deal(uuid) to authenticated;
```

- [ ] **Step 4: Apply** the migration (`bash runsql.sh <migration file>` or MCP `apply_migration`). Expect success.

- [ ] **Step 5: Verify present** via `execute_sql`: `select exists(select 1 from pg_proc where proname='release_seo_jobs_for_deal') as fn_present;` → `true`. (Test AW1 still fails until Task A2 wires the trigger.)

- [ ] **Step 6: Commit** (migration + test file; do NOT push):

```bash
git add supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql supabase/tests/seo_jobs_at_awaiting_payment.sql
git commit -m "$(printf 'feat(jobs): release_seo_jobs_for_deal — SEO-scoped placement + onboarding\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task A2: Fire SEO release at Awaiting Payment (trigger branch)

**Files:**
- Modify: `supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql` (append the trigger-function replacement)
- Test: `supabase/tests/seo_jobs_at_awaiting_payment.sql` (append scenarios AW2, AW3)

**Interfaces:**
- Consumes: `public.release_seo_jobs_for_deal(uuid)` (Task A1).
- Produces: updated `public.deals_hold_jobs_on_stage_change()` with an `awaiting_payment` branch.

- [ ] **Step 1: Capture the LIVE body** of `deals_hold_jobs_on_stage_change` for the revert block: `select pg_get_functiondef('public.deals_hold_jobs_on_stage_change()'::regprocedure);` — save to scratchpad. (Base the edit on the live body; the version in `20260629120000` is the expected current one.)

- [ ] **Step 2: Append the trigger-function replacement** to the migration — the current body with one added branch (the `awaiting_payment` line):

```sql
-- ---- Add awaiting_payment branch: create SEO jobs the FIRST time here ----
create or replace function public.deals_hold_jobs_on_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;
  select code into new_code from public.pipeline_stages
   where id = new.accounting_stage_id and board = 'accounting_onboarding';

  if new_code = 'on_hold' then
    perform public.block_deal_jobs(new.id);
  elsif new_code = 'awaiting_payment' then
    perform public.release_seo_jobs_for_deal(new.id);    -- NEW: SEO jobs + access emails at first Awaiting Payment
  elsif new_code = 'paid_in_full' then
    perform public.release_jobs_for_deal(new.id, false);  -- place web_dev/hosting (if Partial skipped) + SEO/ads/social/ai-children
    perform public.release_deal_jobs(new.id);             -- first-time SEO -> New project + email + mark ; onboarded -> Renewal
  elsif new_code = 'partial_payment' then
    null;  -- the deals_release_jobs_on_partial_payment trigger owns the partial release (web_dev/hosting only)
  elsif new_code is not null then
    update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
      where deal_id = new.id and is_blocked and blocked_reason = 'account_on_hold';
  end if;
  return new;
end $$;
```

(The `create trigger deals_hold_jobs_on_hold` is unchanged — it already fires on any `accounting_stage_id` change, so no trigger DDL needed.)

- [ ] **Step 3: Apply** the migration again (idempotent create-or-replace).

- [ ] **Step 4: Append scenarios AW2 (idempotent) + AW3 (straight to paid_in_full)** to the test file:

```sql
-- ---- AW2: second landing (awaiting -> paid_in_full) creates NO new SEO jobs, NO new email
do $$
declare v_client uuid; v_deal uuid; v_web_before int; v_web_after int; v_email_before int; v_email_after int;
begin
  insert into public.clients (name, email, country) values ('aw2_'||gen_random_uuid()::text,'aw2@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id, services_planned)
    values (v_client,'AW2','aw2','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'),
            jsonb_build_array(jsonb_build_object('service_type','web_seo','billing_type','recurring_monthly','monthly_amount','100')))
    returning id into v_deal;
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment') where id=v_deal;
  select count(*) into v_web_before from public.jobs where deal_id=v_deal and service_type='web_seo' and not archived;
  select count(*) into v_email_before from public.email_outbox where dedupe_key='webseo_gsc:'||v_deal::text;
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  select count(*) into v_web_after from public.jobs where deal_id=v_deal and service_type='web_seo' and not archived;
  select count(*) into v_email_after from public.email_outbox where dedupe_key='webseo_gsc:'||v_deal::text;
  if v_web_after <> v_web_before or v_email_after <> v_email_before then
    raise exception 'RESULT :: FAIL AW2 :: paid_in_full after awaiting duplicated jobs/emails (jobs %->%, email %->%)', v_web_before,v_web_after,v_email_before,v_email_after;
  end if;
  raise exception 'RESULT :: PASS AW2 :: second landing is idempotent (no new SEO jobs / emails)';
end $$;

-- ---- AW3: deal that lands straight in paid_in_full still gets SEO jobs
do $$
declare v_client uuid; v_deal uuid; v_web int;
begin
  insert into public.clients (name, email, country) values ('aw3_'||gen_random_uuid()::text,'aw3@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id, services_planned)
    values (v_client,'AW3','aw3','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'),
            jsonb_build_array(jsonb_build_object('service_type','local_seo','billing_type','recurring_monthly','monthly_amount','100')))
    returning id into v_deal;
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  select count(*) into v_web from public.jobs where deal_id=v_deal and service_type='local_seo' and stage_id is not null and not archived;
  if v_web < 1 then raise exception 'RESULT :: FAIL AW3 :: straight-to-paid_in_full did not place local_seo, got %', v_web; end if;
  raise exception 'RESULT :: PASS AW3 :: straight-to-paid_in_full still places SEO jobs';
end $$;
```

- [ ] **Step 5: Run the harness — expect AW1, AW2, AW3 all PASS (GREEN).** `python3 runharness.py .../seo_jobs_at_awaiting_payment.sql`. If any FAIL, STOP and report.

- [ ] **Step 6: Commit** (do NOT push):

```bash
git add supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql supabase/tests/seo_jobs_at_awaiting_payment.sql
git commit -m "$(printf 'feat(jobs): create SEO jobs + access emails at first Awaiting Payment\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task A3: Revert block + live dry-run

**Files:**
- Modify: `supabase/migrations/20260702160000_seo_jobs_at_awaiting_payment.sql` (append revert)

- [ ] **Step 1: Append a commented revert block** containing: (a) `drop function if exists public.release_seo_jobs_for_deal(uuid);`, and (b) the verbatim pre-change `deals_hold_jobs_on_stage_change` body captured in Task A2 Step 1 (which restores the paid_in_full-only behavior). Every line `--`-prefixed.

- [ ] **Step 2: Live dry-run (savepoint):** confirm that moving a real recent-New deal to awaiting_payment would place its SEO jobs — run a savepoint DO-block that picks one non-archived deal in `new` with SEO in `services_planned`, moves it to awaiting_payment, counts new on-board SEO jobs, and `RAISE`s the count (rolled back). Expect ≥1. If 0 or it errors, investigate.

- [ ] **Step 3: Commit** the revert block (do NOT push).

---

### Task B1: `jobEmailStatus` helper — badge state for every service

**Files:**
- Read first: `src/features/jobs/seoAccessButton.ts`, `src/features/jobs/useSeoAccessSentMap.ts`, `src/features/jobs/useRequestSeoAccess.ts`
- Create: `src/features/jobs/jobEmailStatus.ts`
- Test: `src/features/jobs/jobEmailStatus.test.ts`

**Interfaces:**
- Consumes: the existing `seoAccessConfig(serviceType)` (`web_seo→webseo_gsc_access`, `local_seo→localseo_gbp_access`) and the sent-map shape `{ '<template_key>|<lower_email>': last_sent }` from `useSeoAccessSentMap`.
- Produces: `jobEmailStatus(job, sentMap): { state: 'sent'|'not_sent'|'coming_soon'; templateKey: string|null; lastSent: string|null }`.

- [ ] **Step 1: Write the failing test** `src/features/jobs/jobEmailStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jobEmailStatus } from './jobEmailStatus';

const web = { service_type: 'web_seo', client_email: 'a@b.com' } as any;
const local = { service_type: 'local_seo', client_email: 'a@b.com' } as any;
const ads = { service_type: 'ads', client_email: 'a@b.com' } as any;

describe('jobEmailStatus', () => {
  it('web_seo with a sent GSC email -> sent', () => {
    const map = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };
    expect(jobEmailStatus(web, map)).toEqual({ state: 'sent', templateKey: 'webseo_gsc_access', lastSent: '2026-07-01T00:00:00Z' });
  });
  it('local_seo with no send -> not_sent', () => {
    expect(jobEmailStatus(local, {})).toEqual({ state: 'not_sent', templateKey: 'localseo_gbp_access', lastSent: null });
  });
  it('ads (no onboarding email) -> coming_soon', () => {
    expect(jobEmailStatus(ads, {})).toEqual({ state: 'coming_soon', templateKey: null, lastSent: null });
  });
  it('email match is case-insensitive', () => {
    const map = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };
    expect(jobEmailStatus({ ...web, client_email: 'A@B.com' }, map).state).toBe('sent');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run src/features/jobs/jobEmailStatus.test.ts`) → module not found.

- [ ] **Step 3: Implement** `src/features/jobs/jobEmailStatus.ts` (read `seoAccessButton.ts` first to reuse its service→template config; do not duplicate the mapping if an export already exists):

```ts
export type JobEmailState = 'sent' | 'not_sent' | 'coming_soon';

const SERVICE_TEMPLATE: Record<string, string> = {
  web_seo: 'webseo_gsc_access',
  local_seo: 'localseo_gbp_access',
};

export interface JobEmailStatusInput { service_type: string; client_email?: string | null; }

export function jobEmailStatus(
  job: JobEmailStatusInput,
  sentMap: Record<string, string>,
): { state: JobEmailState; templateKey: string | null; lastSent: string | null } {
  const templateKey = SERVICE_TEMPLATE[job.service_type] ?? null;
  if (!templateKey) return { state: 'coming_soon', templateKey: null, lastSent: null };
  const email = (job.client_email ?? '').trim().toLowerCase();
  const lastSent = email ? (sentMap[`${templateKey}|${email}`] ?? null) : null;
  return { state: lastSent ? 'sent' : 'not_sent', templateKey, lastSent };
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npx vitest run src/features/jobs/jobEmailStatus.test.ts`.

- [ ] **Step 5: Commit** (do NOT push):

```bash
git add src/features/jobs/jobEmailStatus.ts src/features/jobs/jobEmailStatus.test.ts
git commit -m "$(printf 'feat(jobs): jobEmailStatus helper (sent / not_sent / coming_soon)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task B2: `JobEmailStatusBadge` component

**Files:**
- Read first: `src/features/jobs/RequestSeoAccessButton.tsx` (reuse its resend confirm + `useRequestSeoAccess` wiring), `src/features/jobs/useRequestSeoAccess.ts`
- Create: `src/features/jobs/JobEmailStatusBadge.tsx`

**Interfaces:**
- Consumes: `jobEmailStatus` (B1), `useSeoAccessSentMap`, `useRequestSeoAccess`.
- Produces: `<JobEmailStatusBadge job={job} variant="card"|"detail" />` — renders ✅ Sent (+date, `variant="detail"` shows date; `card` shows a dot), ⚠️ Not sent + Resend, 🕒 Coming soon.

- [ ] **Step 1: Implement** `src/features/jobs/JobEmailStatusBadge.tsx`. Read `RequestSeoAccessButton.tsx` and mirror its resend flow (confirm dialog + `useRequestSeoAccess().mutate({ to: client_email, templateKey, code })`). Render per `jobEmailStatus(job, sentMap).state`:
  - `coming_soon` → grey pill "Coming soon" (no action). On the card variant, render a small muted 🕒 dot.
  - `sent` → green "✓ Access email sent" (detail shows the date via `lastSent`); card variant = green ✓ dot.
  - `not_sent` → amber "⚠ Not sent" + a **Resend** button (confirm → resend → toast). card variant = amber ⚠ dot that opens the resend on click.
  For AI SEO: the parent (`service_type='ai_seo'`) has no template → renders `coming_soon`; its `web_seo`/`local_seo` children carry the real badges. Keep all copy short; match existing pill/badge classes used in `JobsKanbanCard.tsx` (e.g. the Blocked-badge styling).

- [ ] **Step 2: Verify build.** `npm run build` must pass (strict tsc + eslint). Fix any type errors (assert array indices with `!`).

- [ ] **Step 3: Commit** (do NOT push):

```bash
git add src/features/jobs/JobEmailStatusBadge.tsx
git commit -m "$(printf 'feat(jobs): JobEmailStatusBadge — sent / not-sent+resend / coming-soon\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task B3: Wire the badge into the card + detail page

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx` (badge/owner region ~lines 79-157)
- Modify: `src/features/jobs/JobDetailPage.tsx` (header badge region ~lines 228-266)

**Interfaces:**
- Consumes: `<JobEmailStatusBadge>` (B2). The card already renders `RequestSeoAccessButton` (~lines 149-157) — replace it with `<JobEmailStatusBadge job={job} variant="card" />` (the badge subsumes the resend). The detail page adds `<JobEmailStatusBadge job={job} variant="detail" />` in the header badge row.

- [ ] **Step 1: Card** — in `JobsKanbanCard.tsx`, replace the `RequestSeoAccessButton` usage with `<JobEmailStatusBadge job={job} variant="card" />` so every card shows a status dot (⚠️ stands out). Ensure `job.client_email` (or equivalent) is available to the badge; if the card's job shape lacks the client email, thread it from the existing query (read the card's props/job type first).

- [ ] **Step 2: Detail** — in `JobDetailPage.tsx`, add `<JobEmailStatusBadge job={job} variant="detail" />` to the header badge row (near the service-type chip ~line 266).

- [ ] **Step 3: Verify build + tests.** `npm run build` passes; `npx vitest run src/features/jobs/jobEmailStatus.test.ts` passes.

- [ ] **Step 4: Commit** (do NOT push):

```bash
git add src/features/jobs/JobsKanbanCard.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "$(printf 'feat(jobs): show email-status badge on job cards + detail (all services)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task B4: Verify resend bypasses the dept toggle + manual live check

**Files:** none (verification only)

- [ ] **Step 1: Confirm the resend path bypasses `dept_technical`.** `useRequestSeoAccess` calls the `send-email` edge function directly (no `email_automation_enabled` check in `send-email/index.ts`), so a manual Resend sends even with `dept_technical` OFF. Confirm by reading `supabase/functions/send-email/index.ts` (`sendOne`) — no `email_automation_enabled` call — and record the confirmation.
- [ ] **Step 2: Manual UI smoke** (browser, on a test/synthetic job): a `web_dev` job shows 🕒 Coming soon; a `local_seo` job with no GBP send shows ⚠ Not sent + Resend; clicking Resend delivers (check email_log) and the badge flips to ✓. Clean up any synthetic rows.

---

### Task C: Push + memory

- [ ] **Step 1: Full regression.** Run `python3 runharness.py .../seo_jobs_at_awaiting_payment.sql` (AW1–AW3 PASS) + `npm run build` + `npx vitest run src/features/jobs/jobEmailStatus.test.ts`. Also re-run the stage-lock harness `enqueue_payment_reminders.sql` to confirm no billing regression.
- [ ] **Step 2: Push.** `git push origin main`.
- [ ] **Step 3: Memory.** Update `project_stage_locked_emails.md` sibling or add `project_seo_jobs_awaiting_payment.md`: SEO jobs now created at first Awaiting Payment (release_seo_jobs_for_deal + trigger branch); per-job email-status badge (jobEmailStatus + JobEmailStatusBadge) on card + detail, all services, coming-soon for web_dev/hosting/ads/social; resend bypasses dept toggle. Add a one-line MEMORY.md index entry.

---

## Self-Review

**1. Spec coverage:**
- Part A trigger at awaiting_payment/paid_in_full, SEO-scoped, idempotent, auto-emails: Tasks A1 (fn) + A2 (trigger) + tests AW1–AW3.
- web_dev/hosting (partial) + ads/social (fully-paid) + AI SEO parent + recurring untouched: A1 filters to SEO; A2 leaves other branches intact (AW1 asserts ads stay off-board).
- Part B badge states (sent/not_sent/coming_soon) on card + detail, all services: B1 (helper) + B2 (component) + B3 (wiring).
- Resend generalized + bypasses dept toggle: B2 reuses `useRequestSeoAccess`; B4 verifies bypass.
- Revert SQL: A3.

**2. Placeholder scan:** No TBD/TODO. Part A SQL is complete (verbatim-adapted from the live `release_jobs_for_deal`). Part B tasks name exact files to read for the pieces whose full source isn't inlined (existing components), with the new helper/component code given in full. Revert (A3) uses the live body captured in A2 Step 1.

**3. Type consistency:** `release_seo_jobs_for_deal(uuid) → int`; trigger calls it in the awaiting_payment branch. `jobEmailStatus(job, sentMap)` return shape is identical in B1 (definition), B2 (consumer), B3 (wiring). Template keys `webseo_gsc_access` / `localseo_gbp_access` and dedupe prefixes `webseo_gsc` / `localseo_gbp` match the live email trigger. Badge states `'sent'|'not_sent'|'coming_soon'` consistent across B1/B2.
