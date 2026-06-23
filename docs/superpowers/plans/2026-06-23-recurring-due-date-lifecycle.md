# Recurring billing keyed off the due date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recurring overdue/On-Hold/Awaiting/settle pipeline key off the **due date** (recurring = the pending payment's `start_date` = end of the prior paid period; one-time unchanged = `end_date`), let onboarded recurring clients flow through Awaiting Payment, and correct the 39 deals the prior end-date sweep mis-moved.

**Architecture:** One atomic Postgres migration applied via the Supabase MCP `apply_migration`. It re-creates four functions (`mark_overdue_payments`, `move_overdue_deals_to_on_hold`, `deal_payments_move_to_awaiting`, and replaces `deal_payments_release_from_on_hold` with `deal_payments_settle_to_paid_in_full`) to use the due-date predicate, then runs a one-time data correction with a backup table. No frontend change.

**Tech Stack:** Postgres (Supabase, security-definer functions + triggers, pg_cron). DDL applied to prod project **CRM** (`xujlrclyzxrvxszepquy`) through the Supabase MCP; verification via MCP `execute_sql`.

**Spec:** `docs/superpowers/specs/2026-06-23-recurring-due-date-lifecycle-design.md`

**Canonical "owes now" predicate** (reused verbatim in several places):
```sql
dp.status <> 'paid'
and (
     (dp.billing_type in ('recurring_monthly','recurring_yearly')
        and dp.start_date is not null and dp.start_date <= current_date)
  or (dp.billing_type = 'one_time'
        and dp.end_date  is not null and dp.end_date  <= current_date)
)
```

---

## File structure

- **Create** `supabase/migrations/20260623150000_recurring_due_date_lifecycle.sql` — the whole change (A–E) + rollback notes. (Bump the timestamp if it collides; keep it lexically last.)

No application code changes (the drag RPC `accounting_mark_paid_in_full` and the frontend are unaffected).

---

## Task 1: Author the migration (A–E)

**Files:**
- Create: `supabase/migrations/20260623150000_recurring_due_date_lifecycle.sql`

- [ ] **Step 1: Header + Change A1 — `mark_overdue_payments` keyed off the due date**

```sql
-- =============================================================================
-- Recurring billing keyed off the DUE DATE (recurring = pending payment start_date
-- = end of prior paid period; one-time unchanged = end_date).
-- Spec: docs/superpowers/specs/2026-06-23-recurring-due-date-lifecycle-design.md
-- =============================================================================

-- ── A1. mark_overdue_payments: flip pending -> overdue at the due date ────────
create or replace function public.mark_overdue_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  flipped int;
begin
  with flipped_rows as (
    update public.deal_payments dp
       set status = 'overdue'
      from public.deals d
     where d.id = dp.deal_id
       and d.archived = false
       and dp.status = 'pending'
       and (
            (dp.billing_type in ('recurring_monthly','recurring_yearly')
               and dp.start_date is not null and dp.start_date <= current_date)
         or (dp.billing_type = 'one_time'
               and dp.end_date  is not null and dp.end_date  <  current_date)
       )
    returning dp.id, dp.deal_id, dp.service_type, dp.amount_gross,
              dp.billing_type, dp.start_date, dp.end_date
  ),
  details as (
    select f.id, f.deal_id, f.service_type, f.amount_gross,
           case when f.billing_type in ('recurring_monthly','recurring_yearly')
                then f.start_date else f.end_date end as due_date,
           c.name as client_name
      from flipped_rows f
      join public.deals d on d.id = f.deal_id
      left join public.clients c on c.id = d.client_id
  ),
  recipients as (
    select p.user_id
      from public.profiles p
     where p.is_active and p.archived = false
       and (p.is_admin or exists (
             select 1 from public.user_groups ug
               join public.groups g on g.id = ug.group_id
              where ug.user_id = p.user_id and g.code = 'accounting'))
  ),
  inserted as (
    insert into public.notifications (user_id, type, payload)
    select r.user_id, 'payment_overdue',
           jsonb_build_object(
             'parent_type', 'deal', 'parent_id', det.deal_id,
             'parent_label', coalesce(det.client_name, ''),
             'service_type', det.service_type, 'amount_gross', det.amount_gross,
             'due_date', to_char(det.due_date, 'DD/MM/YYYY'),
             'payment_id', det.id)
      from details det cross join recipients r
    returning 1
  )
  select count(*) into flipped from details;
  return flipped;
end $$;
```

- [ ] **Step 2: Change A2 — `move_overdue_deals_to_on_hold` keyed off the due date**

```sql
-- ── A2. Overdue cron -> On Hold at the due date (recurring=start, one-time=end) ─
create or replace function public.move_overdue_deals_to_on_hold()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  on_hold_id uuid;
  moved int := 0;
begin
  select id into on_hold_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'on_hold'
   limit 1;
  if on_hold_id is null then
    return 0;
  end if;

  with overdue_deals as (
    select distinct dp.deal_id
      from public.deal_payments dp
     where dp.status <> 'paid'
       and (
            (dp.billing_type in ('recurring_monthly','recurring_yearly')
               and dp.start_date is not null and dp.start_date <= current_date)
         or (dp.billing_type = 'one_time'
               and dp.end_date  is not null and dp.end_date  <= current_date)
       )
  )
  update public.deals d
     set accounting_stage_id = on_hold_id
    from overdue_deals od
   where d.id = od.deal_id
     and d.accounting_stage_id is not null
     and d.accounting_stage_id <> on_hold_id
     and not exists (
       select 1 from public.pipeline_stages ps
        where ps.id = d.accounting_stage_id
          and (ps.is_terminal = true or ps.code = 'closed')  -- never re-hold done/closed
     );
  get diagnostics moved = row_count;
  return moved;
end $function$;
```

- [ ] **Step 3: Change B — onboarded recurring clients enter Awaiting (7 days prior)**

```sql
-- ── B. New payment row -> Awaiting Payment, including completed recurring deals.
-- Moves from any non-terminal, non-On-Hold stage (so paid_in_full -> awaiting now
-- works). Never pulls a deal out of On Hold (owing an earlier month).
create or replace function public.deal_payments_move_to_awaiting()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  awaiting_id uuid;
  on_hold_id  uuid;
  d record;
  current_stage_code text;
begin
  if new.billing_type = 'recurring_test_2min' then
    return new;
  end if;

  select id into awaiting_id from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'awaiting_payment' limit 1;
  if awaiting_id is null then
    return new;
  end if;

  select id into on_hold_id from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'on_hold' limit 1;

  select id, accounting_stage_id into d
    from public.deals where id = new.deal_id limit 1;
  if d is null or d.accounting_stage_id is null then
    return new;
  end if;
  if d.accounting_stage_id = awaiting_id then
    return new;
  end if;
  if on_hold_id is not null and d.accounting_stage_id = on_hold_id then
    return new;  -- leave On Hold deals alone (still owe an earlier month)
  end if;

  select code into current_stage_code
    from public.pipeline_stages where id = d.accounting_stage_id;
  -- Brand-new deals stay in the New column (accounting moves them out manually);
  -- preserves migration 20260503000021. NOTE: unlike that version we DO NOT skip
  -- completed deals — a resting recurring client in paid_in_full must reach Awaiting.
  if current_stage_code = 'new' then
    return new;
  end if;

  if exists (select 1 from public.pipeline_stages ps
              where ps.id = d.accounting_stage_id and ps.is_terminal = true) then
    return new;  -- done / closed
  end if;

  update public.deals set accounting_stage_id = awaiting_id where id = new.deal_id;
  return new;
end $$;
```

- [ ] **Step 4: Change C — replace the settle trigger (On Hold + Awaiting, due-date rule)**

```sql
-- ── C. Pay -> Paid In Full from On Hold OR Awaiting, using the due-date rule. ──
create or replace function public.deal_payments_settle_to_paid_in_full()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  on_hold_id    uuid;
  awaiting_id   uuid;
  paid_stage_id uuid;
  cur_stage_id  uuid;
  still_owes    boolean;
begin
  if new.status <> 'paid' or old.status is not distinct from 'paid' then
    return new;
  end if;

  select accounting_stage_id into cur_stage_id
    from public.deals where id = new.deal_id;
  if cur_stage_id is null then
    return new;
  end if;

  select id into on_hold_id  from public.pipeline_stages
    where board='accounting_onboarding' and code='on_hold' limit 1;
  select id into awaiting_id from public.pipeline_stages
    where board='accounting_onboarding' and code='awaiting_payment' limit 1;

  if cur_stage_id is distinct from on_hold_id
     and cur_stage_id is distinct from awaiting_id then
    return new;  -- only settle from On Hold or Awaiting
  end if;

  select exists (
    select 1 from public.deal_payments dp
     where dp.deal_id = new.deal_id
       and dp.status <> 'paid'
       and (
            (dp.billing_type in ('recurring_monthly','recurring_yearly')
               and dp.start_date is not null and dp.start_date <= current_date)
         or (dp.billing_type = 'one_time'
               and dp.end_date  is not null and dp.end_date  <= current_date)
       )
  ) into still_owes;
  if still_owes then
    return new;
  end if;

  select id into paid_stage_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full' limit 1;
  if paid_stage_id is null then
    return new;
  end if;

  update public.deals set accounting_stage_id = paid_stage_id where id = new.deal_id;
  return new;
end $$;

-- swap the old trigger/function for the new one
drop trigger   if exists deal_payments_release_from_on_hold on public.deal_payments;
drop function  if exists public.deal_payments_release_from_on_hold();
drop trigger   if exists deal_payments_settle_to_paid_in_full on public.deal_payments;
create trigger deal_payments_settle_to_paid_in_full
  after update on public.deal_payments
  for each row execute function public.deal_payments_settle_to_paid_in_full();
```

- [ ] **Step 5: Change D — one-time data correction + backup, then rollback notes**

```sql
-- ── D. Correct the 39 deals the prior (end-date) sweep mis-moved. ─────────────
create table if not exists public.deals_due_date_resweep_backup_20260623 as
select b.deal_id, d.accounting_stage_id as stage_before_resweep, now() as backed_up_at
  from public.deals_onhold_sweep_backup_20260623 b
  join public.deals d on d.id = b.deal_id;

-- (1) Owes now -> On Hold (hold trigger re-freezes web_seo/local_seo/ai_seo).
update public.deals d
   set accounting_stage_id = (select id from public.pipeline_stages
        where board='accounting_onboarding' and code='on_hold' limit 1)
 where d.id in (select deal_id from public.deals_due_date_resweep_backup_20260623)
   and exists (
     select 1 from public.deal_payments dp
      where dp.deal_id = d.id and dp.status <> 'paid'
        and ((dp.billing_type in ('recurring_monthly','recurring_yearly')
                and dp.start_date is not null and dp.start_date <= current_date)
          or (dp.billing_type = 'one_time'
                and dp.end_date  is not null and dp.end_date  <= current_date)));

-- (2) Not owing, but has a recurring pre-due pending payment -> Awaiting Payment.
update public.deals d
   set accounting_stage_id = (select id from public.pipeline_stages
        where board='accounting_onboarding' and code='awaiting_payment' limit 1)
 where d.id in (select deal_id from public.deals_due_date_resweep_backup_20260623)
   and not exists (
     select 1 from public.deal_payments dp
      where dp.deal_id = d.id and dp.status <> 'paid'
        and ((dp.billing_type in ('recurring_monthly','recurring_yearly')
                and dp.start_date is not null and dp.start_date <= current_date)
          or (dp.billing_type = 'one_time'
                and dp.end_date  is not null and dp.end_date  <= current_date)))
   and exists (
     select 1 from public.deal_payments dp
      where dp.deal_id = d.id and dp.status <> 'paid'
        and dp.billing_type in ('recurring_monthly','recurring_yearly')
        and dp.start_date is not null and dp.start_date > current_date);
-- (3) Everything else stays in paid_in_full (no action).

-- =============================================================================
-- CHANGES / REVERT
--   A1. mark_overdue_payments        : end_date  -> due-date basis
--   A2. move_overdue_deals_to_on_hold: end_date  -> due-date basis
--   B.  deal_payments_move_to_awaiting: handle completed recurring + On-Hold guard
--   C.  deal_payments_release_from_on_hold -> deal_payments_settle_to_paid_in_full
--   D.  data correction + deals_due_date_resweep_backup_20260623
--
-- ROLLBACK:
--   -- restore prior bodies:
--   --   mark_overdue_payments()        from 20260610000005
--   --   move_overdue_deals_to_on_hold()      from 20260623140000
--   --   deal_payments_move_to_awaiting()     from 20260503000021 (has the 'new' guard)
--   drop trigger if exists deal_payments_settle_to_paid_in_full on public.deal_payments;
--   drop function if exists public.deal_payments_settle_to_paid_in_full();
--   -- re-create deal_payments_release_from_on_hold() + trigger from 20260623140000.
--   -- restore stages: update deals set accounting_stage_id = stage_before_resweep
--   --   from deals_due_date_resweep_backup_20260623 (hold trigger re-syncs jobs).
-- =============================================================================
```

- [ ] **Step 6: Commit the migration file**

```bash
git add supabase/migrations/20260623150000_recurring_due_date_lifecycle.sql
git commit -m "feat(accounting): recurring billing keyed off due date (period start) + Awaiting flow + resweep"
```

---

## Task 2: Apply the migration + verify

**Files:** none (Supabase MCP).

- [ ] **Step 1: Apply via the Supabase MCP**

Use `mcp__plugin_supabase__apply_migration` with `project_id: "xujlrclyzxrvxszepquy"`, `name: "recurring_due_date_lifecycle"`, `query:` = the full file contents.
Expected: `{"success":true}`. (If MCP disconnected, run `/mcp` first — Bash/curl are blocked for DDL.)

- [ ] **Step 2: Verify the functions now use the due-date basis**

Run via `mcp__plugin_supabase__execute_sql` (project `xujlrclyzxrvxszepquy`):
```sql
select
  pg_get_functiondef('public.move_overdue_deals_to_on_hold'::regproc) like '%start_date <= current_date%' as cron_uses_due_date,
  pg_get_functiondef('public.mark_overdue_payments'::regproc)         like '%start_date <= current_date%' as flip_uses_due_date,
  (select count(*) from pg_proc where proname='deal_payments_settle_to_paid_in_full') as settle_fn,
  (select count(*) from pg_trigger where tgname='deal_payments_settle_to_paid_in_full') as settle_trg,
  (select count(*) from pg_proc where proname='deal_payments_release_from_on_hold') as old_fn_gone;
```
Expected: `cron_uses_due_date=true`, `flip_uses_due_date=true`, `settle_fn=1`, `settle_trg=1`, `old_fn_gone=0`.

- [ ] **Step 3: Verify the data correction (ECODIN + the backlog)**

```sql
select
  (select code from public.pipeline_stages ps
     join public.deals d on d.accounting_stage_id = ps.id
    where d.id='961d01a8-ea62-4fcc-9199-173452e4df80') as ecodin_stage,
  (select count(*) from public.jobs j
    where j.deal_id='961d01a8-ea62-4fcc-9199-173452e4df80'
      and j.is_blocked and j.blocked_reason='account_on_hold') as ecodin_seo_frozen,
  (select count(*) from public.deals d
     join public.pipeline_stages ps on ps.id=d.accounting_stage_id
    where d.id in (select deal_id from public.deals_due_date_resweep_backup_20260623)
      and ps.code='on_hold') as resweep_back_on_hold,
  (select count(*) from public.deals d
     join public.pipeline_stages ps on ps.id=d.accounting_stage_id
    where d.id in (select deal_id from public.deals_due_date_resweep_backup_20260623)
      and ps.code='paid_in_full') as resweep_still_paid,
  (select count(*) from public.deals_due_date_resweep_backup_20260623) as resweep_total;
```
Expected: `ecodin_stage='on_hold'`, `ecodin_seo_frozen>=1`, `resweep_back_on_hold≈28`, `resweep_still_paid` = the genuinely-paid remainder, summing to `resweep_total` (39, minus any moved to awaiting).

- [ ] **Step 4: Non-destructive behavioral test — Awaiting → Paid In Full on payment**

Run (a `DO` block that creates a pre-due recurring payment on a scratch-free path is heavy; instead test the settle-from-Awaiting path on a real Awaiting deal inside a rolled-back transaction):
```sql
do $$
declare v_deal uuid; v_before text; v_after text;
begin
  select d.id, ps.code into v_deal, v_before
    from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id
   where ps.board='accounting_onboarding' and ps.code in ('on_hold','awaiting_payment')
     and exists (select 1 from public.deal_payments dp where dp.deal_id=d.id
                  and dp.status<>'paid'
                  and ((dp.billing_type in ('recurring_monthly','recurring_yearly') and dp.start_date<=current_date)
                    or (dp.billing_type='one_time' and dp.end_date<=current_date)))
   limit 1;
  if v_deal is null then raise exception 'SETTLE_TEST no eligible deal'; end if;
  update public.deal_payments dp set status='paid', paid_at=now()
   where dp.deal_id=v_deal and dp.status<>'paid'
     and ((dp.billing_type in ('recurring_monthly','recurring_yearly') and dp.start_date<=current_date)
       or (dp.billing_type='one_time' and dp.end_date<=current_date));
  select ps.code into v_after from public.deals d
    join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  raise exception 'SETTLE_TEST deal=% before=% after=%', v_deal, v_before, v_after;
end $$;
```
Expected: the RAISE shows `before=on_hold` (or `awaiting_payment`) and `after=paid_in_full`, then rolls back (no real change).

---

## Self-review

- **Spec coverage:** Decision 1 predicate → used in A1/A2/C/D. Change A→Task 1 Steps 1-2 (+verify Task 2 Step 2). Change B→Step 3. Change C→Step 4 (+verify Step 2, behavioral Step 4). Change D→Step 5 (+verify Task 2 Step 3). Recurring-only (one-time keeps `end_date`) honored in every predicate. Lifecycle (Paid In Full→Awaiting→On Hold→Paid In Full) covered by B (enter Awaiting), A2 (→On Hold), C (→Paid In Full).
- **Placeholders:** none — every SQL block is complete and self-contained.
- **Consistency:** the "owes now" predicate (`recurring start_date<=today` / `one_time end_date<=today`) is byte-identical across A2, C, and D(1)/D(2); function/trigger names (`deal_payments_settle_to_paid_in_full`) match between create, drop-old, and verify; project id `xujlrclyzxrvxszepquy` consistent.
- **Note for executor:** Task 1 → Task 2 are sequential; Task 2 applies DDL to prod and runs the live data correction. No frontend/types work (no new RPC).
```
