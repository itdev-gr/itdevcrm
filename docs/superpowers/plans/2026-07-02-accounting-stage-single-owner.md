# Accounting Stage — Single-Owner Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** This plan is **prod Postgres DDL + DML-harness applied via the Supabase Management API** (there is no local DB). Fresh subagents can hit the safety classifier on prod DDL; **inline execution by the controller is the safer choice here.** Each task = one migration file + its harness, applied live, harness green, commit.

**Goal:** Replace the three fighting writers of `deals.accounting_stage_id` with one due-date rule so the 24h grace + flip-fix + mitigation referees can retire, without changing what the accountant sees.

**Architecture:** One function `reconcile_deal_stage(deal_id)` computes a deal's payment-cycle column (`awaiting_payment`/`on_hold`/`paid_in_full`) from its earliest **unpaid charge's due date** and is the *only* writer of those columns. It is called two ways — instantly by a new `deal_payments` trigger, and by the nightly `reconcile_block_lifecycle` sweep — so they can never disagree. The two event-movers (`move_to_awaiting`, `release_from_on_hold`) and the grace are removed. Workflow/terminal columns and all billing-integrity/dedup guards are untouched.

**Tech Stack:** Postgres (Supabase project `xujlrclyzxrvxszepquy`), plpgsql triggers/functions, Supabase Management API (`/database/query`) via `curl`, RAISE-exception savepoint-rollback test harness.

## Global Constraints

- **Prod project ref:** `xujlrclyzxrvxszepquy`. There is NO local database — every apply and every test runs against prod via the Management API.
- **Management API call:** `POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, header `Authorization: Bearer <token>`, **and `User-Agent: curl/8.7.1`** (without the curl UA, Cloudflare returns a 1010 block). The token is provided out-of-band in `scratchpad/.sbp`; **NEVER commit the token or write it into any tracked file** (docs/migrations included).
- **The single rule (exact boundaries):** for a deal whose current accounting stage ∈ {`awaiting_payment`,`on_hold`,`paid_in_full`} AND `payment_method IS NOT NULL`, with `v_next_due` = `min(start_date)` over its `deal_payments` where `status NOT IN ('paid','cancelled')` and `start_date IS NOT NULL`: `v_next_due IS NULL → paid_in_full`; `v_next_due < current_date → on_hold`; `v_next_due <= current_date + 7 → awaiting_payment`; else `paid_in_full`. On-Hold uses **strict `<`** (a charge due *today* → awaiting, not on_hold — this is why no grace is needed).
- **Never touch** deals in `new`/`documents_verified`/`invoice_issued`/`partial_payment`/`done`/`closed` — those are the accountant's.
- **KEEP (do NOT remove) all billing-integrity/dedup guards:** `deal_payments_no_duplicate_period`, the `ensure_recurring_payments` end_date/null-safe/no-legacy guards, the UNIQUE recurring period-key index, `deal_payments_created_at_immutable`. This plan only removes stage-conflict referees.
- **KEEP unchanged:** `deals_hold_jobs_on_stage_change`, `deals_release_jobs_on_partial_payment`, `deals_close_jobs_on_close`, `deals_sync_client_status`, `guard_payment_method`, the reminder crons/functions, the closed-client guard.
- Every migration file ends with a commented, verbatim **revert block** (the prior bodies/triggers, captured live via `pg_get_functiondef`).
- Harness must be GREEN between every task. Push to `main`, atomic commits, no PR.

## Harness runner (set up once, before Task 1)

The controller uses two scratchpad helpers (already present this session; recreate if missing). **These live in `scratchpad/` and are NOT committed.**

`scratchpad/runsql.sh` — runs a `.sql` file as one query:
```bash
#!/usr/bin/env bash
# usage: bash runsql.sh file.sql
TOKEN="$(cat "$(dirname "$0")/.sbp")"
Q="$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' "$1")"
curl -s -A 'curl/8.7.1' -X POST \
  "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"query\": $Q}"
```

`scratchpad/runharness.py` — runs each `do $$ ... $$;` block in a file separately and prints its `RESULT :: <STATUS> <label> :: <detail>` line (each block RAISEs at the end, so nothing persists; the RESULT rides in the exception message):
```python
import json,re,subprocess,sys,os
sql=open(sys.argv[1]).read()
blocks=re.findall(r'do \$\$.*?\$\$;',sql,re.S)
tok=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'.sbp')).read().strip()
for i,b in enumerate(blocks,1):
    r=subprocess.run(['curl','-s','-A','curl/8.7.1','-X','POST',
      'https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query',
      '-H',f'Authorization: Bearer {tok}','-H','Content-Type: application/json',
      '-d',json.dumps({'query':b})],capture_output=True,text=True)
    m=re.search(r'RESULT :: (.*?)(?:\\n|")',r.stdout)
    print(f'[{i}] '+(m.group(1) if m else 'NO RESULT :: '+r.stdout[:200]))
```

- [ ] **Setup Step: confirm the runner works**

Run: `cd scratchpad && printf "do \$\$ begin raise exception 'RESULT :: PASS smoke :: ok'; end \$\$;" > t.sql && python3 runharness.py t.sql`
Expected: `[1] PASS smoke :: ok`

---

### Task 1: `reconcile_deal_stage(uuid)` — the single due-date rule (additive)

Create the function only. Nothing is wired to it yet, so this is safe/additive. Test it in isolation by forcing the deal's stage after setup (to neutralize the still-present `move_to_awaiting`), then calling the function directly.

**Files:**
- Create: `supabase/migrations/20260702150000_reconcile_deal_stage.sql`
- Create (test, not committed as a migration): `scratchpad/h1_reconcile_deal_stage.sql`

**Interfaces:**
- Produces: `public.reconcile_deal_stage(p_deal_id uuid) RETURNS boolean` — returns `true` iff it changed the deal's stage; always reconciles the deal's jobs (block on on_hold / unblock `account_on_hold` otherwise). Consumed by Tasks 2 and 3.
- Consumes (existing): `public.block_deal_jobs(uuid)`, `public.pipeline_stages`, `public.deal_payments`.

- [ ] **Step 1: Write the failing harness** — `scratchpad/h1_reconcile_deal_stage.sql`, 6 blocks. Each creates a client + deal (payment_method `cash`), inserts a charge, **forces the deal stage** to the scenario's start (overriding any trigger), calls `reconcile_deal_stage`, asserts, and RAISEs a RESULT. Template for block A (repeat with the variations in the table):

```sql
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1a','h1a@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1A','h1a','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 30, current_date + 60, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='paid_in_full' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % A future-charge(+30)-stays-paid_in_full :: got %', v_status, v_after;
end $$;
```

The 6 scenarios (block letter → charge `start_date` → forced start stage → expected `v_after`):

| Blk | charge due | force start | expect |
|---|---|---|---|
| A | `+30` | paid_in_full | **paid_in_full** (no flip on a far-future charge — the bug, fixed) |
| B | `+3` | paid_in_full | **awaiting_payment** (Fully Paid → Awaiting when due soon) |
| C | `-2` | awaiting_payment | **on_hold** (overdue → On Hold) |
| D | `current_date` (today) | awaiting_payment | **awaiting_payment** (due today is NOT overdue — strict `<`, no grace) |
| E | none inserted, all `paid` | on_hold | **paid_in_full** (release_from_on_hold subsumed) — insert one row with `status='paid'` |
| F | `-2` | documents_verified | **documents_verified** (boundary: rule never touches workflow columns) |

For block E, insert the charge as `status='paid'` (so `v_next_due` is NULL). For block F, force the start stage to `documents_verified`.

- [ ] **Step 2: Run harness, verify it FAILS**

Run: `cd scratchpad && python3 runharness.py h1_reconcile_deal_stage.sql`
Expected: every line shows `NO RESULT :: ...ERROR... function public.reconcile_deal_stage(uuid) does not exist` (the function isn't created yet).

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260702150000_reconcile_deal_stage.sql`:

```sql
-- Single-owner accounting stage: one due-date rule for the payment-cycle columns.
create or replace function public.reconcile_deal_stage(p_deal_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur_code text; v_pm boolean; v_next_due date; v_target text;
  v_target_id uuid; v_moved boolean := false;
begin
  select ps.code, (d.payment_method is not null) into cur_code, v_pm
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where d.id = p_deal_id and not d.archived;

  -- only the system-managed payment-cycle columns; workflow + terminal are the accountant's
  if cur_code is null
     or cur_code not in ('awaiting_payment','on_hold','paid_in_full')
     or not v_pm then
    return false;
  end if;

  select min(dp.start_date) into v_next_due
    from public.deal_payments dp
   where dp.deal_id = p_deal_id
     and dp.status not in ('paid','cancelled')
     and dp.start_date is not null;

  v_target := case
    when v_next_due is null              then 'paid_in_full'
    when v_next_due <  current_date      then 'on_hold'
    when v_next_due <= current_date + 7  then 'awaiting_payment'
    else                                      'paid_in_full'
  end;

  if v_target is distinct from cur_code then
    select id into v_target_id from public.pipeline_stages
      where board='accounting_onboarding' and code=v_target limit 1;
    if v_target_id is not null then
      update public.deals set accounting_stage_id = v_target_id where id = p_deal_id;
      v_moved := true;
    end if;
  end if;

  -- jobs follow the column
  if v_target = 'on_hold' then
    perform public.block_deal_jobs(p_deal_id);
  else
    update public.jobs
       set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
     where deal_id = p_deal_id and is_blocked and blocked_reason='account_on_hold';
  end if;

  return v_moved;
end $$;

-- REVERT: drop function public.reconcile_deal_stage(uuid);
```

- [ ] **Step 4: Apply the migration live**

Run: `cd scratchpad && cp ../supabase/migrations/20260702150000_reconcile_deal_stage.sql apply.sql && bash runsql.sh apply.sql`
Expected: `[]` (success, no rows).

- [ ] **Step 5: Run harness, verify all PASS**

Run: `cd scratchpad && python3 runharness.py h1_reconcile_deal_stage.sql`
Expected: `[1] PASS A...` … `[6] PASS F...` — all six PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260702150000_reconcile_deal_stage.sql
git commit -m "feat(accounting): reconcile_deal_stage — single due-date rule for payment-cycle columns"
```

---

### Task 2: point the nightly sweep at the rule + drop the 24h grace

Rewrite `reconcile_block_lifecycle` to iterate the payment-cycle deals and call `reconcile_deal_stage` (removing the grace + the old per-deal logic). The two event-movers still exist after this task — that's fine; the sweep now agrees with the rule, and the flip scenarios that used to depend on grace now pass by construction.

**Files:**
- Create: `supabase/migrations/20260702150100_reconcile_block_lifecycle_single_owner.sql`
- Create (test): `scratchpad/h2_sweep.sql`

**Interfaces:**
- Consumes: `public.reconcile_deal_stage(uuid)` (Task 1).
- Produces: `public.reconcile_block_lifecycle(p_allow_release boolean DEFAULT false) RETURNS integer` — same signature (callers unchanged); returns the count of deals it moved. `p_allow_release` is now ignored (the rule always applies).

- [ ] **Step 1: Write the failing harness** — `scratchpad/h2_sweep.sql`, 2 blocks:
  - **G:** a deal forced to `paid_in_full` with a `+30` future charge, then call `select public.reconcile_block_lifecycle(false);`, assert the deal is **still paid_in_full** (the sweep no longer flips it out — proves the grace removal is safe). RAISE RESULT.
  - **H:** a deal forced to `awaiting_payment` with a `-3` overdue charge, call the sweep, assert **on_hold**. RAISE RESULT.

Block G template:
```sql
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h2g','h2g@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H2G','h2g','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 30, current_date + 60, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='paid_in_full' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % G sweep-keeps-future-charge-paid :: got %', v_status, v_after;
end $$;
```

- [ ] **Step 2: Run harness, verify current behavior** — Run: `cd scratchpad && python3 runharness.py h2_sweep.sql`. Note the result (block G may currently PASS via the 24h grace since the charge is >24h... it is freshly created, so grace applies and it stays paid_in_full — capture the baseline). This step documents the before-state; the rewrite must keep G green for the *right* reason.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260702150100_reconcile_block_lifecycle_single_owner.sql`:

```sql
create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; moved int := 0;
begin
  for r in
    select d.id
      from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived
       and ps.code in ('awaiting_payment','on_hold','paid_in_full')
       and d.payment_method is not null
  loop
    if public.reconcile_deal_stage(r.id) then moved := moved + 1; end if;
  end loop;

  -- safety net: terminal/done jobs never stay account_on_hold-blocked
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
    from public.pipeline_stages s
   where s.id = j.stage_id and (s.is_terminal or s.code='done')
     and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;

  return moved;
end $$;

-- REVERT: restore the prior body captured live via
--   select pg_get_functiondef('public.reconcile_block_lifecycle(boolean)'::regprocedure);
-- (the grace version). Paste that CREATE OR REPLACE here before applying.
```

Before applying, the implementer MUST first capture the current body into the revert comment: run `select pg_get_functiondef('public.reconcile_block_lifecycle(boolean)'::regprocedure);` and paste it into the REVERT block (it is the grace version fetched at plan-time; confirm it matches live).

- [ ] **Step 4: Apply live** — Run: `cd scratchpad && cp ../supabase/migrations/20260702150100_reconcile_block_lifecycle_single_owner.sql apply.sql && bash runsql.sh apply.sql`. Expected: `[]`.

- [ ] **Step 5: Run harness, verify G + H PASS** — Run: `cd scratchpad && python3 runharness.py h2_sweep.sql`. Expected: `[1] PASS G...`, `[2] PASS H...`.

- [ ] **Step 6: Regression — re-run Task 1 harness** — Run: `cd scratchpad && python3 runharness.py h1_reconcile_deal_stage.sql`. Expected: all 6 still PASS.

- [ ] **Step 7: Commit**
```bash
git add supabase/migrations/20260702150100_reconcile_block_lifecycle_single_owner.sql
git commit -m "refactor(accounting): nightly sweep delegates to reconcile_deal_stage; drop 24h grace"
```

---

### Task 3: instant trigger + remove the two event-movers (atomic swap)

Add the `deal_payments` trigger that calls `reconcile_deal_stage` on any payment change, and in the **same migration** drop `deal_payments_move_to_awaiting` and `deal_payments_release_from_on_hold`. Doing both together means there is never a moment with two conflicting mover-sets.

**Files:**
- Create: `supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql`
- Create (test): `scratchpad/h3_trigger.sql`

**Interfaces:**
- Produces: trigger `deal_payments_reconcile_stage` AFTER INSERT/UPDATE/DELETE on `public.deal_payments` → `public.deal_payments_reconcile_stage()` → `reconcile_deal_stage(coalesce(new.deal_id, old.deal_id))`.
- Removes: triggers `deal_payments_move_to_awaiting`, `deal_payments_release_from_on_hold` (functions kept for revert).

- [ ] **Step 1: Write the failing harness** — `scratchpad/h3_trigger.sql`, 4 blocks. These do NOT force the stage — they rely on the trigger. Because `move_to_awaiting` is still present until Step 3 applies, these will initially misbehave (that's the failing state).
  - **I:** deal at `paid_in_full`, insert a `+30` future charge → assert **paid_in_full** (trigger runs the rule; no flip). *(Today `move_to_awaiting` flips it to awaiting → this FAILS pre-swap.)*
  - **J:** deal at `paid_in_full`, insert a `+3` charge → assert **awaiting_payment**.
  - **K:** deal at `awaiting_payment`, insert a `-2` overdue charge → assert **on_hold**.
  - **L:** deal at `on_hold` with one unpaid `-2` charge; UPDATE that charge to `status='paid'` → assert **paid_in_full** (trigger on UPDATE runs the rule; nothing left due).

Block I template:
```sql
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h3i','h3i@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3I','h3i','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 30, current_date + 60, 'pending');
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='paid_in_full' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % I trigger-no-flip-future :: got %', v_status, v_after;
end $$;
```

- [ ] **Step 2: Run harness, verify I FAILS** — Run: `cd scratchpad && python3 runharness.py h3_trigger.sql`. Expected: block I shows `FAIL ... got awaiting_payment` (the current `move_to_awaiting` flips it). This proves the harness catches the bug.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql`:

```sql
create or replace function public.deal_payments_reconcile_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.reconcile_deal_stage(coalesce(new.deal_id, old.deal_id));
  return coalesce(new, old);
end $$;

drop trigger if exists deal_payments_reconcile_stage on public.deal_payments;
create trigger deal_payments_reconcile_stage
  after insert or update or delete on public.deal_payments
  for each row execute function public.deal_payments_reconcile_stage();

-- retire the two event-movers (functions kept for revert)
drop trigger if exists deal_payments_move_to_awaiting on public.deal_payments;
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;

-- REVERT:
--   drop trigger if exists deal_payments_reconcile_stage on public.deal_payments;
--   drop function if exists public.deal_payments_reconcile_stage();
--   create trigger deal_payments_move_to_awaiting after insert on public.deal_payments
--     for each row execute function public.deal_payments_move_to_awaiting();
--   create trigger deal_payments_release_from_on_hold after update on public.deal_payments
--     for each row execute function public.deal_payments_release_from_on_hold();
```

- [ ] **Step 4: Apply live** — Run: `cd scratchpad && cp ../supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql apply.sql && bash runsql.sh apply.sql`. Expected: `[]`.

- [ ] **Step 5: Run harness, verify I–L PASS** — Run: `cd scratchpad && python3 runharness.py h3_trigger.sql`. Expected: `[1] PASS I...` … `[4] PASS L...`.

- [ ] **Step 6: Live rolled-back dry-run of the sweep** — confirm the whole live dataset is stable (no churn) under the new rule. Write `scratchpad/h3_dryrun.sql`:
```sql
do $$
declare v_moved int;
begin
  v_moved := public.reconcile_block_lifecycle(false);
  raise exception 'RESULT :: PASS dryrun :: sweep moved % deals (rolled back)', v_moved;
end $$;
```
Run: `cd scratchpad && python3 runharness.py h3_dryrun.sql`. Expected: a **small, sane** move count (single/low-double digits — deals genuinely mis-columned before the rule). A huge number (hundreds) means the rule is churning — STOP and investigate before Step 7.

- [ ] **Step 7: Commit**
```bash
git add supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql
git commit -m "feat(accounting): instant reconcile trigger; retire move_to_awaiting + release_from_on_hold"
```

---

### Task 4: regression sweep + retire the grace-asserting scenarios + docs

Prove the existing 100+-scenario harnesses still pass (rewriting any that asserted grace behavior), update the audit/spec status + memory, and do a final live confirmation.

**Files:**
- Modify: `supabase/tests/paid_in_full_flip*.sql`, `supabase/tests/payments_accounting_full_smoke.sql`, `supabase/tests/enqueue_payment_reminders.sql` — only scenarios that asserted the 24h grace / the old movers.
- Modify: `docs/system-analysis/2026-07-02-accounting-processes-map-and-overlap-audit.md` and `docs/superpowers/specs/2026-07-02-accounting-stage-single-owner-design.md` — add a "SHIPPED" status line.

**Interfaces:** none new.

- [ ] **Step 1: Locate the existing harness files** — Run: `ls supabase/tests/ | grep -Ei 'flip|smoke|reminder'`. Read each; find blocks that assert grace-specific behavior (e.g., "a charge created <24h ago keeps paid_in_full") or that depend on `move_to_awaiting`/`release_from_on_hold` firing.

- [ ] **Step 2: Run each existing harness live, capture failures** — For each file: `cd scratchpad && cp ../supabase/tests/<file> h4.sql && python3 runharness.py h4.sql`. Record which blocks FAIL. Expected failures are only grace/mover-specific assertions; a flip scenario should now PASS by construction.

- [ ] **Step 3: Rewrite the failing grace/mover scenarios** — for each failing block, change the assertion to the new rule (charge due-date-based; strict `<` for on_hold; future charge stays paid_in_full). Keep the block's setup; only change the expected value + label. Do NOT delete coverage — convert it.

- [ ] **Step 4: Re-run all three harnesses, verify GREEN** — For each: `cd scratchpad && cp ../supabase/tests/<file> h4.sql && python3 runharness.py h4.sql`. Expected: every block PASS.

- [ ] **Step 5: Update docs status** — append to the audit doc and the spec a line: `> **SHIPPED 2026-07-02** — single-owner stage live; grace + move_to_awaiting + release_from_on_hold retired; harnesses green.`

- [ ] **Step 6: Commit**
```bash
git add supabase/tests/ docs/system-analysis/2026-07-02-accounting-processes-map-and-overlap-audit.md docs/superpowers/specs/2026-07-02-accounting-stage-single-owner-design.md
git commit -m "test(accounting): convert grace-era scenarios to the single-owner rule; mark shipped"
```

- [ ] **Step 7: Final live verification** — re-run the Task 1 + Task 3 harnesses once more to confirm end-state green, and run the dry-run sweep again to confirm the move count is still small/stable:
```
cd scratchpad && python3 runharness.py h1_reconcile_deal_stage.sql && python3 runharness.py h3_trigger.sql && python3 runharness.py h3_dryrun.sql
```
Expected: all PASS; dry-run move count small/stable.

- [ ] **Step 8: Push + memory**
```bash
git push origin main
```
Then update memory: mark `project_stage_locked_emails` / add a note that the single-owner stage shipped and the grace/flip-fix/mitigation referees retired (revert = the three migrations' REVERT blocks). Rotate the chat-shared `sbp` token.

---

## Self-Review

**Spec coverage:** the single rule (Task 1) ✓; one-writer-two-ways (Task 1 fn + Task 2 sweep + Task 3 trigger) ✓; remove move_to_awaiting + release_from_on_hold + grace (Tasks 2–3) ✓; keep billing-integrity guards (Global Constraints — none of the migrations touch them) ✓; Fully Paid→Awaiting kept (Task 1 block B, Task 3 block J) ✓; never touch workflow/terminal (Task 1 block F) ✓; reminders unchanged (not modified; Task 4 confirms the reminder harness still green) ✓; revert blocks (each migration) ✓; live dry-run (Task 3 Step 6, Task 4 Step 7) ✓.

**Placeholder scan:** the Task 2 REVERT block requires the implementer to paste the live grace-version body — flagged explicitly in Step 3, not left as a silent TODO. No other placeholders.

**Type/name consistency:** `reconcile_deal_stage(uuid) returns boolean` defined in Task 1, consumed as boolean in Task 2 (`if public.reconcile_deal_stage(r.id) then`). Trigger fn `deal_payments_reconcile_stage()` and trigger name `deal_payments_reconcile_stage` consistent in Task 3. Dropped triggers named exactly as enumerated live (`deal_payments_move_to_awaiting`, `deal_payments_release_from_on_hold`).
