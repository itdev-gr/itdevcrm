# On-Hold Holds Jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal:** When a deal moves to accounting **"On Hold"**, automatically hold (block) its jobs; when it leaves On Hold to a paying/active stage, release them. Fix the 50 deals already sitting in On Hold whose jobs are not held.

**Architecture:** A deal-stage change already fires triggers. The hold is the *same* mechanism the partial-payment flow uses — `jobs.is_blocked = true` + `blocked_reason` (the job cards already render a red badge for any `is_blocked` job). Add an AFTER-UPDATE trigger on `deals` that blocks the deal's jobs with `blocked_reason = 'account_on_hold'` when the accounting stage becomes `on_hold`, and clears those blocks when it becomes anything else. One-time backfill for deals currently in On Hold.

**Tech stack:** Postgres trigger function + migration (Management API), applied to prod.

## Root Cause (confirmed)

- `deals_sync_client_status` (BEFORE UPDATE, when `accounting_stage_id` changes) → `on_hold` sets only `clients.status='blocked'` (cosmetic).
- The enforced/visible hold is `jobs.is_blocked`/`blocked_reason` (UI badge; `release_jobs_for_deal` sets `partial_payment_pending`; `complete_accounting` clears it). `on_hold` never touches it.
- `client_blocks` (hard stage-move guard via `is_client_blocked` + `enforce_no_stage_move_when_blocked`) is also never written on `on_hold`.
- Both the manual board move and `move_overdue_deals_to_on_hold` (cron) only set the stage → jobs never held.

## Decisions (baked in — flag if you want them changed)

1. **Mechanism = soft hold** (`jobs.is_blocked=true, blocked_reason='account_on_hold'`), matching the existing `partial_payment_pending` pattern + the job-card badge. (NOT a hard `client_blocks` guard — that stays a manual admin action via `block_client`. If you want On-Hold to also *prevent* stage moves, say so and I'll add a `client_blocks` row keyed `reason='account_on_hold'`.)
2. **Scope = all non-terminal, non-archived jobs of the deal**, INCLUDING web_dev. (Rationale: On Hold = the whole account is paused, unlike partial_payment which lets web builds proceed. Flag if web_dev should be exempt.)
3. **Release on leaving On Hold** only clears blocks whose `blocked_reason='account_on_hold'` — it never touches `partial_payment_pending` or `manual` blocks.

---

### Task 1: Trigger — hold/release jobs on accounting-stage change

**Files:** Create `supabase/migrations/20260618000013_onhold_holds_jobs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- When a deal enters accounting "On Hold", hold its jobs (is_blocked +
-- blocked_reason='account_on_hold'); when it leaves On Hold, release exactly
-- those holds. Fires for both the manual board move and the overdue cron.
create or replace function public.deals_hold_jobs_on_stage_change()
returns trigger
language plpgsql
as $$
declare
  new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;

  select code into new_code
    from public.pipeline_stages
   where id = new.accounting_stage_id and board = 'accounting_onboarding';

  if new_code = 'on_hold' then
    -- Hold every live job of this deal (skip already-blocked + terminal-stage jobs).
    update public.jobs j
       set is_blocked = true,
           blocked_reason = 'account_on_hold',
           blocked_at = now()
      from public.pipeline_stages s
     where j.deal_id = new.id
       and not j.archived
       and not j.is_blocked
       and s.id = j.stage_id
       and not s.is_terminal;
  elsif new_code is not null then
    -- Any non-hold stage: release only the holds this feature created.
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null
     where deal_id = new.id
       and is_blocked = true
       and blocked_reason = 'account_on_hold';
  end if;

  return new;
end $$;

drop trigger if exists deals_hold_jobs_on_hold on public.deals;
create trigger deals_hold_jobs_on_hold
  after update on public.deals
  for each row
  when (new.accounting_stage_id is distinct from old.accounting_stage_id)
  execute function public.deals_hold_jobs_on_stage_change();

-- ROLLBACK:
-- drop trigger if exists deals_hold_jobs_on_hold on public.deals;
-- drop function if exists public.deals_hold_jobs_on_stage_change();
```

- [ ] **Step 2: Apply to prod** via the Management API; record version `20260618000013` in `schema_migrations`.

- [ ] **Step 3: Verify the trigger logic** with a transactional dry-run on one On-Hold deal:

```sql
-- Pick an on_hold deal, nudge the stage to itself? No — instead test block/release:
begin;
-- move a test deal OUT of on_hold then back, asserting job blocks toggle.
-- (Use a real on_hold deal id; rollback after.)
rollback;
```
Expected: moving to `on_hold` sets its jobs `is_blocked=true, blocked_reason='account_on_hold'`; moving to e.g. `partial_payment` clears them.

### Task 2: Backfill — hold jobs for deals already in On Hold

**Files:** same migration (second statement) or `20260618000014_backfill_onhold_jobs.sql`

- [ ] **Step 1: Backfill SQL**

```sql
-- Deals already parked in On Hold (~50) whose jobs were never held.
update public.jobs j
   set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
  from public.deals d
  join public.pipeline_stages acs on acs.id = d.accounting_stage_id
  join public.pipeline_stages s on s.id = j.stage_id
 where j.deal_id = d.id
   and acs.code = 'on_hold' and not d.archived
   and not j.archived and not j.is_blocked and not s.is_terminal;
-- ROLLBACK: update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null
--   where blocked_reason='account_on_hold';
```

- [ ] **Step 2: Verify** — `select count(*) from jobs where blocked_reason='account_on_hold'` ≈ live jobs under On-Hold deals; spot-check a couple deals.

### Task 3: Confirm the UI reflects the hold

- [ ] Open a held job's board (`/jobs/...` or the department kanban) — the job shows the existing red **blocked** badge (driven by `is_blocked`). No code change expected; if the badge text should read "Account on hold", add an i18n label keyed on `blocked_reason` (small follow-up). On localhost confirm: move a deal to On Hold → its jobs show blocked; move it to Partial Payment / Paid → blocked clears.

## Changes / Revert
- New trigger `deals_hold_jobs_on_hold` + function; one-time backfill (reversible by clearing `blocked_reason='account_on_hold'`). No schema/table changes. Revert via the `-- ROLLBACK:` blocks.

## Out of scope
- Hard stage-move prevention (client_blocks) — left as the manual `block_client` admin action unless you ask for it.
- Changing `clients.status='blocked'` behavior (kept as-is; it still flips on On Hold).
