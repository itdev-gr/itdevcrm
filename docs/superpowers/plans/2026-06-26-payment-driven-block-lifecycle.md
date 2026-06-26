# Payment-driven Block & On-Hold Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive deal On-Hold/block state from the payment **due date** with a self-correcting nightly reconciler, blocking every open job except website + hosting, and unblocking → Renewal/Active when accounting marks paid — never modifying accounting's entered payment dates.

**Architecture:** The deal's accounting stage is the single source of truth. A pure SQL function maps `(next_due, today) → target stage`. A rewritten stage-change trigger blocks/unblocks the deal's jobs + syncs client status. A nightly reconciler re-asserts both stage and block flags (self-healing). All payment-date columns are read-only throughout.

**Tech Stack:** Postgres (pl/pgSQL functions, triggers, pg_cron), applied via Supabase MCP; React/TS + vitest for the UI piece.

**Spec:** `docs/superpowers/specs/2026-06-26-payment-driven-block-lifecycle-design.md`

**Prod project:** `CRM` ref `xujlrclyzxrvxszepquy`. DDL applied via Supabase MCP `apply_migration`; behavioral tests via `execute_sql` rolled-back `DO` blocks. **Confirm with the user before each prod apply.**

**Reference identifiers (verified 2026-06-26):**
- Accounting stages: `new, awaiting_payment, on_hold, documents_verified, invoice_issued, partial_payment, paid_in_full`; terminal = `done, closed`.
- Blocked stages = `on_hold, partial_payment`. Due date = `deal_payments.start_date`.
- Block targets = open jobs with `service_type IN ('web_seo','local_seo','social_media','ads')`. Never block `web_dev`, `hosting`, or `ai_seo` billing parents.
- Unblock destinations: web_seo/local_seo → stage `renewal`; social_media/ads → stage `active`.

**Open decisions (recommended defaults baked in; change here if the user overrides at review):**
1. Release auto-advances to `paid_in_full` when the last due payment is marked `paid` (Task 5). If "manual only", drop Task 5's auto-advance and keep only the `paid_in_full`-transition handler in Task 3.
2. `partial_payment` is a blocked stage the nightly mover leaves alone (Task 4 excludes it from moves).
3. One-time reconciliation places currently-paid On-Hold deals into `paid_in_full` (Task 6). If "leave for accounting", Task 6 only re-asserts flags, no stage moves toward release.

---

## File Map

- `supabase/migrations/20260626000005_block_target_stage_fn.sql` — pure `target_accounting_stage()` + `deal_next_due()` helpers.
- `supabase/migrations/20260626000006_block_lifecycle_triggers.sql` — rewritten stage-change block/unblock + client-status sync; helper `block_deal_jobs()` / `release_deal_jobs()`.
- `supabase/migrations/20260626000007_block_lifecycle_reconciler.sql` — nightly `reconcile_block_lifecycle()` + cron; disable old `move_overdue_deals_to_on_hold` cron.
- `supabase/migrations/20260626000008_release_on_payment.sql` — auto-advance to `paid_in_full` when last due payment marked paid (decision 1).
- `supabase/migrations/20260626000009_block_lifecycle_backfill.sql` — one-time reconciliation + backup table.
- `src/features/jobs/kanbanGrouping.ts` — add `social_media`, `ads` to the Blocked-column boards.
- `src/features/jobs/kanbanGrouping.test.ts` — test the grouping includes blocked cards for the new boards.

---

## Task 1: Pure date → target-stage function

**Files:** Create `supabase/migrations/20260626000005_block_target_stage_fn.sql`

- [ ] **Step 1: Write the function + helper**

```sql
-- Pure mapping: given the earliest unpaid due date and today, what accounting stage
-- should a billing-active deal be in? NULL next_due = nothing owed = paid_in_full.
create or replace function public.target_accounting_stage(next_due date, today date)
returns text language sql immutable as $$
  select case
    when next_due is null then 'paid_in_full'
    when next_due <= today then 'on_hold'
    when next_due <= today + 7 then 'awaiting_payment'
    else 'paid_in_full'
  end;
$$;

-- Earliest unpaid payment due date for a deal (read-only; never writes dates).
create or replace function public.deal_next_due(p_deal_id uuid)
returns date language sql stable as $$
  select min(dp.start_date)
    from public.deal_payments dp
   where dp.deal_id = p_deal_id and dp.status <> 'paid';
$$;
```

- [ ] **Step 2: Apply to prod** (confirm with user). Supabase MCP `apply_migration` name `block_target_stage_fn`.

- [ ] **Step 3: Test boundaries (deterministic SELECT assertions)**

Run via Supabase MCP `execute_sql`:

```sql
select
  public.target_accounting_stage(null, date '2026-06-26')                 as a_null,      -- paid_in_full
  public.target_accounting_stage(date '2026-06-19', date '2026-06-26')    as b_overdue,   -- on_hold
  public.target_accounting_stage(date '2026-06-26', date '2026-06-26')    as c_due_today, -- on_hold
  public.target_accounting_stage(date '2026-07-02', date '2026-06-26')    as d_in_6d,     -- awaiting_payment (<=+7)
  public.target_accounting_stage(date '2026-07-03', date '2026-06-26')    as e_in_7d,     -- awaiting_payment
  public.target_accounting_stage(date '2026-07-04', date '2026-06-26')    as f_in_8d;     -- paid_in_full (resting)
```
Expected: `paid_in_full, on_hold, on_hold, awaiting_payment, awaiting_payment, paid_in_full`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000005_block_target_stage_fn.sql
git commit -m "feat(billing): target_accounting_stage + deal_next_due helpers (read-only on dates)"
```

---

## Task 2: Block/Release job helpers + stage-change trigger

**Files:** Create `supabase/migrations/20260626000006_block_lifecycle_triggers.sql`

- [ ] **Step 1: Write the helpers + trigger**

```sql
-- Block all of a deal's open, eligible jobs. Never web_dev/hosting/ai_seo-parent.
create or replace function public.block_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
    from public.pipeline_stages s
   where j.deal_id = p_deal_id
     and s.id = j.stage_id and not s.is_terminal
     and not j.archived and not j.is_blocked
     and j.service_type in ('web_seo','local_seo','social_media','ads');
end $$;

-- Release a deal's account_on_hold blocks and move jobs to their renewal lane.
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j record; v_target uuid;
begin
  for j in
    select id, service_type from public.jobs
     where deal_id = p_deal_id and is_blocked and blocked_reason = 'account_on_hold' and not archived
  loop
    -- destination stage on the job's own board
    select ps.id into v_target from public.pipeline_stages ps
     where ps.board = (case j.service_type when 'web_seo' then 'web_seo' when 'local_seo' then 'local_seo'
                                            when 'social_media' then 'social_media' when 'ads' then 'ads' end)
       and ps.code = (case when j.service_type in ('web_seo','local_seo') then 'renewal' else 'active' end)
       and not ps.archived
     limit 1;
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
           stage_id = coalesce(v_target, stage_id)
     where id = j.id;
  end loop;
end $$;

-- On deal accounting-stage change: block on entering a blocked stage, release on paid_in_full,
-- and keep the client status label in sync. Single source of truth = the stage.
create or replace function public.deals_block_lifecycle_on_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_old_code text;
begin
  if new.accounting_stage_id is not distinct from old.accounting_stage_id then return new; end if;
  select code into v_code from public.pipeline_stages where id = new.accounting_stage_id;
  select code into v_old_code from public.pipeline_stages where id = old.accounting_stage_id;

  if v_code in ('on_hold','partial_payment') then
    perform public.block_deal_jobs(new.id);
    update public.clients set status = 'blocked'
      where id = new.client_id and status <> 'blocked' and status not in ('done');
  elsif v_code = 'paid_in_full' then
    perform public.release_deal_jobs(new.id);
    update public.clients set status = 'active'
      where id = new.client_id and status = 'blocked';
  elsif v_old_code in ('on_hold','partial_payment') then
    -- left a blocked stage to a non-paid stage (e.g. awaiting_payment): just clear blocks.
    update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
      where deal_id = new.id and is_blocked and blocked_reason = 'account_on_hold';
  end if;
  return new;
end $$;

drop trigger if exists deals_hold_jobs_on_stage_change on public.deals;       -- replace old SEO-only one
drop trigger if exists deals_block_lifecycle_on_stage on public.deals;
create trigger deals_block_lifecycle_on_stage
  after update of accounting_stage_id on public.deals
  for each row execute function public.deals_block_lifecycle_on_stage();
```

- [ ] **Step 2: Apply to prod** (confirm). Name `block_lifecycle_triggers`.

- [ ] **Step 3: Behavioral test (rolled-back) — block scope + never web_dev/hosting**

```sql
do $$
declare v_deal uuid; v_onhold uuid; v_paid uuid; v_blocked int; v_webdev_blocked int;
begin
  select id into v_onhold from pipeline_stages where board='accounting_onboarding' and code='on_hold';
  select id into v_paid   from pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  select d.id into v_deal from deals d join jobs j on j.deal_id=d.id
   where not d.archived and j.service_type in ('web_seo','local_seo','social_media','ads') and not j.is_blocked
   limit 1;
  update deals set accounting_stage_id = v_onhold where id = v_deal;            -- fires trigger
  select count(*) into v_blocked from jobs where deal_id=v_deal and is_blocked and service_type in ('web_seo','local_seo','social_media','ads');
  select count(*) into v_webdev_blocked from jobs where deal_id=v_deal and is_blocked and service_type in ('web_dev','hosting');
  raise notice 'blocked_eligible=% webdev_or_hosting_blocked=% (expect >0 and 0)', v_blocked, v_webdev_blocked;
  if v_webdev_blocked <> 0 then raise exception 'FAIL: web_dev/hosting blocked'; end if;
  raise exception 'ROLLBACK_OK eligible=% webdevhost=%', v_blocked, v_webdev_blocked;  -- force rollback
end $$;
```
Expected: error message `ROLLBACK_OK eligible=<n>` with the web_dev/hosting count = 0; nothing persists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000006_block_lifecycle_triggers.sql
git commit -m "feat(billing): block/release job helpers + stage-change lifecycle trigger + client-status sync"
```

---

## Task 3: Nightly reconciler + cron (self-healing)

**Files:** Create `supabase/migrations/20260626000007_block_lifecycle_reconciler.sql`

- [ ] **Step 1: Write the reconciler + cron**

```sql
-- Nightly: move billing-active deals to the correct stage by due date, then re-assert
-- job-block flags to match the stage. Self-heals drift. Reads payment dates only.
create or replace function public.reconcile_block_lifecycle()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_target text; v_target_id uuid; v_cur text; moved int := 0;
begin
  for r in
    select d.id, d.accounting_stage_id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
      from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived
       and ps.code not in ('done','closed')                      -- never touch terminal
       and exists (select 1 from public.deal_payments dp where dp.deal_id = d.id and dp.start_date is not null)  -- billing exists (Q1)
  loop
    -- (A) stage move — only within the managed set; leave onboarding/partial to accounting.
    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full') then
      v_target := public.target_accounting_stage(r.next_due, current_date);
      -- Do NOT auto-release: never move OUT of on_hold toward paid here (decision 1 = manual/payment-driven).
      if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full') then
        if v_target is distinct from r.cur_code then
          select id into v_target_id from public.pipeline_stages where board='accounting_onboarding' and code=v_target;
          update public.deals set accounting_stage_id = v_target_id where id = r.id;  -- fires Task 2 trigger
          moved := moved + 1;
          continue;  -- trigger already reconciled flags for this deal
        end if;
      end if;
    end if;

    -- (B) re-assert flags to match the (unchanged) stage.
    select code into v_cur from public.pipeline_stages where id = r.accounting_stage_id;
    if v_cur in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
    end if;
  end loop;
  return moved;
end $$;

-- Replace the old end_date overdue cron with the new due-date reconciler.
do $$ begin
  perform cron.alter_job((select jobid from cron.job where jobname='daily_move_overdue_deals_to_on_hold'), active:=false);
exception when others then null; end $$;
select cron.schedule('reconcile_block_lifecycle', '20 2 * * *', $$ select public.reconcile_block_lifecycle(); $$);
```

- [ ] **Step 2: Apply to prod** (confirm). Name `block_lifecycle_reconciler`.

- [ ] **Step 3: Dry-run test (rolled-back) — reconciler picks correct targets without persisting**

```sql
do $$
declare v_due_overdue int; v_due_soon int;
begin
  -- Count what the reconciler WOULD target, without moving (pure check via the helper).
  select count(*) into v_due_overdue from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
   where not d.archived and ps.code in ('awaiting_payment','paid_in_full')
     and public.target_accounting_stage(public.deal_next_due(d.id), current_date)='on_hold';
  select count(*) into v_due_soon from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
   where not d.archived and ps.code in ('paid_in_full')
     and public.target_accounting_stage(public.deal_next_due(d.id), current_date)='awaiting_payment';
  raise notice 'would_move_to_on_hold=% would_move_to_awaiting=%', v_due_overdue, v_due_soon;
end $$;
```
Expected: a notice with sane counts (review them before the real backfill in Task 6).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000007_block_lifecycle_reconciler.sql
git commit -m "feat(billing): nightly due-date block reconciler + cron; retire end_date overdue cron"
```

---

## Task 4: Auto-advance to paid_in_full when last due payment is marked paid (decision 1)

**Files:** Create `supabase/migrations/20260626000008_release_on_payment.sql`

- [ ] **Step 1: Write the payment trigger**

```sql
-- When a payment is marked paid and the deal has no remaining due (start_date<=today) unpaid
-- payment, advance an On-Hold/Partial deal to paid_in_full (fires the release trigger).
create or replace function public.deal_payment_advance_to_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_paid uuid;
begin
  if not (new.status = 'paid' and old.status is distinct from 'paid') then return new; end if;
  select ps.code into v_code from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id
   where d.id = new.deal_id;
  if v_code not in ('on_hold','partial_payment') then return new; end if;
  if exists (select 1 from public.deal_payments dp
              where dp.deal_id = new.deal_id and dp.status <> 'paid'
                and dp.start_date is not null and dp.start_date <= current_date) then
    return new;  -- still owes a due payment
  end if;
  select id into v_paid from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid where id = new.deal_id;  -- fires release
  return new;
end $$;

drop trigger if exists deal_payment_advance_to_paid on public.deal_payments;
create trigger deal_payment_advance_to_paid
  after update of status on public.deal_payments
  for each row execute function public.deal_payment_advance_to_paid();

-- Retire the old end_date-based release trigger (superseded).
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
```

- [ ] **Step 2: Apply to prod** (confirm). Name `release_on_payment`.

- [ ] **Step 3: Behavioral test (rolled-back) — paying the due payment releases + moves jobs to renewal**

```sql
do $$
declare v_deal uuid; v_onhold uuid; v_pay uuid; v_after_stage text; v_still_blocked int;
begin
  select id into v_onhold from pipeline_stages where board='accounting_onboarding' and code='on_hold';
  select d.id into v_deal from deals d join jobs j on j.deal_id=d.id
   where not d.archived and j.service_type in ('web_seo','local_seo') limit 1;
  update deals set accounting_stage_id=v_onhold where id=v_deal;     -- block it
  update deal_payments set status='paid' where deal_id=v_deal and status<>'paid';  -- pay all -> advance
  select ps.code into v_after_stage from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  select count(*) into v_still_blocked from jobs where deal_id=v_deal and is_blocked;
  raise exception 'ROLLBACK_OK stage=% still_blocked=% (expect paid_in_full and 0)', v_after_stage, v_still_blocked;
end $$;
```
Expected: error `ROLLBACK_OK stage=paid_in_full still_blocked=0`; nothing persists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000008_release_on_payment.sql
git commit -m "feat(billing): auto-advance to paid_in_full on last due payment; retire end_date release"
```

---

## Task 5: One-time reconciliation with backup (decision 3)

**Files:** Create `supabase/migrations/20260626000009_block_lifecycle_backfill.sql`

- [ ] **Step 1: Write backup + backfill**

```sql
-- Backup every non-terminal deal's stage + its jobs' block state before reconciling.
create table if not exists public.block_lifecycle_backup_20260626 as
  select d.id as deal_id, d.accounting_stage_id, now() as backed_up_at from public.deals d
   join public.pipeline_stages ps on ps.id=d.accounting_stage_id
   where not d.archived and ps.code not in ('done','closed');
create table if not exists public.block_lifecycle_jobs_backup_20260626 as
  select id as job_id, deal_id, stage_id, is_blocked, blocked_reason, blocked_at, blocked_by, now() as backed_up_at
    from public.jobs where not archived;

-- Place every non-terminal billing-active deal in its correct category, then heal flags.
select public.reconcile_block_lifecycle();

-- Belt-and-braces: also release currently-paid On-Hold deals (decision 3 = clean slate).
do $$
declare r record; v_paid uuid;
begin
  select id into v_paid from pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  for r in
    select d.id from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments dp where dp.deal_id=d.id and dp.status<>'paid'
                        and dp.start_date is not null and dp.start_date<=current_date)
  loop
    update deals set accounting_stage_id=v_paid where id=r.id;  -- fires release (unblock + renewal)
  end loop;
end $$;

-- ROLLBACK: restore deals.accounting_stage_id + jobs block columns from the two backup tables.
```

- [ ] **Step 2: Apply to prod** (confirm — this MUTATES live deals/jobs; run the Task 3 Step 3 dry-run counts first and show the user).

- [ ] **Step 3: Verify post-state**

```sql
select
  (select count(*) from jobs j join deals d on d.id=j.deal_id left join pipeline_stages ps on ps.id=d.accounting_stage_id
     where j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived and ps.code is distinct from 'on_hold' and ps.code <> 'partial_payment') as stale_blocks,
  (select count(*) from jobs where is_blocked and service_type in ('web_dev','hosting') and not archived) as webdev_hosting_blocked,
  (select count(*) from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where ps.code='on_hold' and not d.archived
       and not exists(select 1 from deal_payments dp where dp.deal_id=d.id and dp.status<>'paid' and dp.start_date is not null and dp.start_date<=current_date)) as paid_but_onhold;
```
Expected: `stale_blocks=0, webdev_hosting_blocked=0, paid_but_onhold=0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000009_block_lifecycle_backfill.sql
git commit -m "chore(billing): one-time block-lifecycle reconciliation + backups"
```

---

## Task 6: UI — show Blocked work on the social_media + ads boards

**Files:** Modify `src/features/jobs/kanbanGrouping.ts`; Test `src/features/jobs/kanbanGrouping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { BLOCKED_COLUMN_BOARDS } from './kanbanGrouping';

describe('BLOCKED_COLUMN_BOARDS', () => {
  it('includes the boards whose jobs can now be blocked', () => {
    for (const b of ['web_seo', 'local_seo', 'social_media', 'ads'] as const) {
      expect(BLOCKED_COLUMN_BOARDS.has(b)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`social_media`/`ads` not in the set).

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`

- [ ] **Step 3: Add the boards** in `src/features/jobs/kanbanGrouping.ts` (extend the existing `BLOCKED_COLUMN_BOARDS` set to include `'social_media'` and `'ads'`). Confirm the exported symbol name by reading the file first.

- [ ] **Step 4: Run test + full build**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts` → PASS
Run: `npm run build` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/kanbanGrouping.ts src/features/jobs/kanbanGrouping.test.ts
git commit -m "feat(jobs): show Blocked column on social_media + ads boards"
```

---

## Task 7: Regenerate types + push

- [ ] **Step 1:** If any new column/type surfaced (none expected — no schema columns added), update `src/types/supabase.ts`. Otherwise skip.
- [ ] **Step 2:** `npm run build` → PASS.
- [ ] **Step 3:** `git push origin main` (confirm) — backend already applied via MCP; this syncs git + deploys the UI.

---

## Self-review notes
- Spec coverage: due-date stages (T1), block scope incl. never-block web_dev/hosting (T2), client-status sync (T2), reconciler/self-heal (T3), release+renewal (T2/T4), one-time clean slate (T5), UI visibility (T6), date read-only (every function reads `start_date` only — no writes). 
- The 3 open decisions are isolated to Tasks 4, 3(A guard), and 5 so they can flip with minimal churn.
