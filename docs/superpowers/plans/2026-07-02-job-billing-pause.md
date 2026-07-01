# Per-Job Billing Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let accounting pause billing for ONE service on a deal (e.g., client pays local_seo but pauses ads) so the deal can sit in Paid In Full while the paused job stays blocked and generates no new billing — and resume it later with a fresh period starting on the resume date.

**Architecture:** Introduce a `'cancelled'` payment status (excused, audit-preserving) + two SECURITY DEFINER RPCs (`job_pause_billing` / `job_resume_billing`) that flag the job (`blocked_reason='billing_paused'`, `billing_active=false`) and cancel/recreate the chain rows. The pause rides the S2 rail shipped 2026-07-02: cron only renews chains with a `billing_active` job, so `billing_active=false` IS the billing stop. Every defense layer shipped on 2026-07-01/02 (L1 cron guard, L2 trigger, L3 grace, L4 audit, S4 UNIQUE index, `deal_next_due`, release trigger) gets a `status <> 'cancelled'` filter so cancelled rows are invisible to the state machine but visible in history.

**Tech Stack:** Postgres 15 (Supabase) via MCP `apply_migration`/`execute_sql`; React 18 + TanStack Query frontend; Vitest; strict `npm run build`.

**Design decisions (locked with user 2026-07-01):**
- **Excused semantics ⭐** — paused months are gone forever. No deferral, no back-billing. On pause, unpaid recurring rows for the chain are marked `cancelled` (kept for audit, never deleted). On resume, a fresh period starts on the resume date.
- **Manual resume only** — no auto-resume date. Accountant clicks "Resume billing" when ready.
- **UI on the Job detail page ⭐** — new "Billing" card, buttons visible to admin + accounting only; technical team sees a read-only "⏸ paused" banner.
- **Chain-scoped** — pause acts on the job's `(deal_id, service_type)` chain (all non-archived jobs of that service on the deal), because payments are chain-scoped, not job-scoped. For AI SEO, pause is offered on the `ai_seo` parent (the billing holder).
- **Recurring only** — pause cancels `recurring_monthly`/`recurring_yearly` unpaid rows. `one_time` installments (web-dev) are contractual and untouched.

**Interaction with the shipped defense layers (why each filter is needed):**

| Layer | Shipped | Change needed |
|---|---|---|
| `deal_payments.status` CHECK | `pending\|paid\|overdue` | Add `'cancelled'` |
| S4 UNIQUE partial index | blocks all recurring period-key dupes | Recreate with `and status <> 'cancelled'` so a cancelled row frees its period-key for a future re-insert |
| L1 `ensure_recurring_payments` | `dp2.end_date > dp.end_date` guard | Exclude cancelled from BOTH the renewal-source loop and the chain-cover guard |
| L2 `deal_payments_no_duplicate_period` | drops period-key dupes | Exclude cancelled from the dup check (allow re-inserting over a cancelled row) |
| `deal_next_due()` | `min(start_date) where status <> 'paid'` | Add `and status <> 'cancelled'` — THE change that lets the deal reach paid_in_full while the paused chain has unpaid history |
| `deal_payments_release_from_on_hold` | blocks release if any unpaid past-due | Add cancelled filter |
| L3 `reconcile_block_lifecycle` | grace subqueries use `status <> 'paid'` | Add cancelled filter (2 places) |
| L4 `reconcile_payment_integrity` | dupe detection | Exclude cancelled rows |
| S2 cron job gate | requires `billing_active` job | No change — pause sets `billing_active=false`, which stops renewals for free |
| S3 `move_to_awaiting` | skips paid inserts | No change — resume inserts a `pending` row, which SHOULD move the deal to awaiting_payment |

**User's exact scenario, traced through the design:** client has local_seo + ads; pays local, pauses ads for ~3 months. Accountant opens the ads job → "Pause billing" → ads chain's unpaid rows become `cancelled`, ads job blocked + `billing_active=false`. `deal_next_due` now sees only local_seo rows → all paid → accountant drags deal to Paid In Full → nightly reconcile does NOT flip it back (cancelled rows are invisible; L3/L1 respect the pause). Local_seo renews monthly as normal. ~3 months later: "Resume billing" → ads job unblocked, `billing_active=true`, fresh pending row `[today, today+1mo]` inserted → deal moves to awaiting_payment → client pays → paid_in_full.

**Prod facts (verified during design):**
- `jobs` columns: `is_blocked, blocked_reason, blocked_at, blocked_by, billing_active (NOT NULL), billing_only, billing_group_id, client_id (NOT NULL), billing_type (NOT NULL)`.
- `deal_payments` has GENERATED columns `vat_amount`, `amount_gross` — never in explicit column lists.
- Existing `blocked_reason` value in use: `'account_on_hold'` (set by `block_deal_jobs`). `block_deal_jobs` only blocks `not j.is_blocked` jobs and its unblock paths only clear `blocked_reason='account_on_hold'` — so `'billing_paused'` is never clobbered by the on-hold machinery. Verified in the deployed `reconcile_block_lifecycle` body.
- Accounting-gate pattern (from `mark_overdue_payments` recipients query): `p.is_admin OR exists (user_groups ug join groups g on g.id=ug.group_id where ug.user_id=p.user_id and g.code='accounting')`.
- 14 deals have ≥2 active jobs of the same service_type — hence chain-scoped pause (flag ALL of them).

**Files:**
- Create: `supabase/migrations/20260702100000_job_billing_pause.sql` (5 sections + revert)
- Create: `supabase/tests/job_billing_pause_harness.sql` (8 scenarios)
- Create: `src/features/jobs/hooks/useJobBillingPause.ts` (two mutations)
- Create: `src/features/jobs/JobBillingPauseCard.tsx` (the Billing card)
- Modify: `src/features/jobs/JobDetailPage.tsx` (mount the card in the Overview column)
- Modify: `src/features/deals/PaymentsPanel.tsx` (render `cancelled` badge)
- Modify: whatever file maps `blocked_reason` → label (grep, see Task 6)

**Changes / Revert:** One migration, idempotent sections, verbatim revert SQL at the bottom (restore CHECK, swap index back, restore 6 function bodies from `pg_get_functiondef` snapshots taken in Task 1, drop the 2 RPCs). Frontend revert = `git revert`.

---

### Task 1: Pre-flight snapshot + migration Sections 1–2 (status CHECK + index swap)

**Files:**
- Create: `supabase/migrations/20260702100000_job_billing_pause.sql`

- [ ] **Step 1: Snapshot current bodies for the revert block.** Via `mcp__plugin_supabase_supabase__execute_sql` (project `xujlrclyzxrvxszepquy`):

  ```sql
  select proname, pg_get_functiondef(oid)
    from pg_proc
   where proname in ('deal_next_due','ensure_recurring_payments',
                     'deal_payments_no_duplicate_period',
                     'deal_payments_release_from_on_hold',
                     'reconcile_block_lifecycle','reconcile_payment_integrity')
   order by proname;
  ```

  Save all 6 verbatim to `/tmp/prior_bodies_pause_20260702.sql`. Also snapshot the CHECK + index:

  ```sql
  select pg_get_constraintdef(oid) from pg_constraint where conname='deal_payments_status_check';
  select indexdef from pg_indexes where indexname='deal_payments_recurring_period_key_unique';
  ```

- [ ] **Step 2: Write Sections 1–2.** Create the migration file:

  ```sql
  -- =========================================================================
  -- 20260702100000_job_billing_pause.sql
  -- Per-job (chain-scoped) billing pause for accounting.
  --   S1: add 'cancelled' to deal_payments.status CHECK
  --   S2: swap UNIQUE partial index to exclude cancelled rows
  --   S3: thread status <> 'cancelled' through the 6 state-machine functions
  --   S4: job_pause_billing / job_resume_billing RPCs
  --   S5 (bottom): revert SQL
  -- =========================================================================

  -- ---- Section 1: status CHECK gains 'cancelled' ------------------------
  alter table public.deal_payments
    drop constraint if exists deal_payments_status_check;
  alter table public.deal_payments
    add constraint deal_payments_status_check
    check (status = any (array['pending'::text,'paid'::text,'overdue'::text,'cancelled'::text]));

  -- ---- Section 2: UNIQUE index excludes cancelled ------------------------
  -- Cancelled rows leave the index, freeing the period-key so resume /
  -- manual re-billing of a paused period cannot hit unique_violation.
  create unique index if not exists deal_payments_recurring_period_key_unique_v2
    on public.deal_payments (deal_id, service_type, billing_type, start_date, end_date)
    where billing_type in ('recurring_monthly','recurring_yearly')
      and start_date is not null and end_date is not null
      and status <> 'cancelled';
  drop index if exists public.deal_payments_recurring_period_key_unique;
  ```

- [ ] **Step 3: Apply.** `apply_migration` name `job_billing_pause_S1_S2`, query = the file so far. Then verify:

  ```sql
  select pg_get_constraintdef(oid) ~ 'cancelled' as check_ok
    from pg_constraint where conname='deal_payments_status_check';
  select
    exists (select 1 from pg_indexes where indexname='deal_payments_recurring_period_key_unique_v2') as v2_present,
    not exists (select 1 from pg_indexes where indexname='deal_payments_recurring_period_key_unique') as v1_gone;
  ```

  Expected: all `true`.

- [ ] **Step 4: Prove the index swap behaves** (savepoint):

  ```sql
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_a uuid; v_b uuid;
  begin
    insert into public.clients (name) values ('pause_s2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
      values (v_client,'PAUSE-S2','pause s2','cash',
        (select id from public.pipeline_stages where board='sales' and code='won'),
        (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal,'ads',0,'recurring_monthly',100,24,current_date,current_date+30,'cancelled')
      returning id into v_a;
    -- Same period-key over a cancelled row must be ALLOWED now:
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal,'ads',0,'recurring_monthly',100,24,current_date,current_date+30,'pending')
      returning id into v_b;
    if v_b is null then
      raise exception 'RESULT :: FAIL S2CHECK :: L2 trigger still blocks insert over cancelled (fix lands in Task 2)';
    end if;
    raise exception 'RESULT :: PASS S2CHECK :: index + insert over cancelled OK (id=%)', v_b;
  end $$;
  rollback;
  ```

  Note: this may legitimately report FAIL at this point because the **L2 trigger** still counts cancelled rows — that gets fixed in Task 2. Record the result either way; re-run after Task 2 expecting PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add supabase/migrations/20260702100000_job_billing_pause.sql
  git commit -m "feat(billing): pause S1+S2 — cancelled status + index excludes cancelled"
  ```

---

### Task 2: Section 3 — thread `status <> 'cancelled'` through 6 functions

**Files:**
- Modify: `supabase/migrations/20260702100000_job_billing_pause.sql` (append Section 3)

For each function, take the CURRENT deployed body (from the Task 1 snapshot — NOT from any .sql file; per memory, prod bodies drift) and apply ONLY the listed edits. Append all six `create or replace function` statements as Section 3.

- [ ] **Step 1: `deal_next_due`** — the one-liner becomes:

  ```sql
  create or replace function public.deal_next_due(p_deal_id uuid)
  returns date language sql stable set search_path = public as $$
    select min(dp.start_date) from public.deal_payments dp
     where dp.deal_id = p_deal_id
       and dp.status <> 'paid'
       and dp.status <> 'cancelled';
  $$;
  ```

- [ ] **Step 2: `ensure_recurring_payments`** — two edits to the deployed body (which already has the S1/S2/S6 mitigations + the `v_payment_id is null` guard):
  - Outer loop WHERE: add `and dp.status <> 'cancelled'` (a cancelled row is never a renewal source).
  - Chain-cover guard: add `and dp2.status <> 'cancelled'` inside the `not exists (... dp2 ...)`.

- [ ] **Step 3: `deal_payments_no_duplicate_period`** — add `and dp.status <> 'cancelled'` to the `exists (...)` so inserting over a cancelled row is allowed.

- [ ] **Step 4: `deal_payments_release_from_on_hold`** — the past-due check becomes:

  ```sql
  if exists (select 1 from public.deal_payments dp
              where dp.deal_id = new.deal_id
                and dp.status not in ('paid','cancelled')
                and dp.start_date is not null and dp.start_date <= current_date) then
    return new;
  end if;
  ```

- [ ] **Step 5: `reconcile_block_lifecycle`** — in the deployed body, the `v_eff_next_due` subquery gets `and dp.status <> 'cancelled'` (alongside its `dp.status <> 'paid'`). `r.next_due` needs no edit — it calls `deal_next_due`, already fixed.

- [ ] **Step 6: `reconcile_payment_integrity`** — the duplicate-detection CTE's WHERE gets `and status <> 'cancelled'`.

- [ ] **Step 7: Apply** (`apply_migration` name `job_billing_pause_S3`, query = Section 3 only) and verify all six:

  ```sql
  select
    pg_get_functiondef('public.deal_next_due(uuid)'::regprocedure) ~ 'cancelled' as f1,
    (select count(*) from regexp_matches(pg_get_functiondef('public.ensure_recurring_payments()'::regprocedure), 'cancelled', 'g')) >= 2 as f2,
    pg_get_functiondef('public.deal_payments_no_duplicate_period()'::regprocedure) ~ 'cancelled' as f3,
    pg_get_functiondef('public.deal_payments_release_from_on_hold()'::regprocedure) ~ 'cancelled' as f4,
    pg_get_functiondef('public.reconcile_block_lifecycle(boolean)'::regprocedure) ~ 'cancelled' as f5,
    pg_get_functiondef('public.reconcile_payment_integrity()'::regprocedure) ~ 'cancelled' as f6;
  ```

  Expected: all `true`. Also re-run Task 1 Step 4's savepoint check — now expecting `RESULT :: PASS S2CHECK`.

- [ ] **Step 8: Check `enqueue_payment_reminders`** (read-only): `select pg_get_functiondef('public.enqueue_payment_reminders()'::regprocedure);` — confirm it filters on `status in ('pending','overdue')` or similar. If it uses `status <> 'paid'`, add a seventh replacement with the cancelled filter to Section 3 and re-apply. Record which case held.

- [ ] **Step 9: Commit.**

  ```bash
  git add supabase/migrations/20260702100000_job_billing_pause.sql
  git commit -m "feat(billing): pause S3 — cancelled rows invisible to the state machine"
  ```

---

### Task 3: Section 4 — the two RPCs

**Files:**
- Modify: `supabase/migrations/20260702100000_job_billing_pause.sql` (append Section 4)

- [ ] **Step 1: Append Section 4.**

  ```sql

  -- ---- Section 4: pause / resume RPCs -----------------------------------
  create or replace function public.job_pause_billing(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $function$
  declare
    v_job record; v_cancelled int; v_flagged int;
  begin
    if not (
      exists (select 1 from public.profiles p
               where p.user_id = auth.uid() and p.is_admin and not p.archived)
      or exists (select 1 from public.profiles p
                   join public.user_groups ug on ug.user_id = p.user_id
                   join public.groups g on g.id = ug.group_id
                  where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
    ) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
    if v_job is null then raise exception 'job_not_found'; end if;
    if v_job.blocked_reason = 'billing_paused' then raise exception 'already_paused'; end if;
    if not v_job.billing_active then raise exception 'not_billing_active'; end if;

    -- Flag every non-archived job of this (deal, service_type) chain.
    update public.jobs j
       set is_blocked = true, blocked_reason = 'billing_paused',
           blocked_at = now(), blocked_by = auth.uid(),
           billing_active = false
     where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
       and not j.archived;
    get diagnostics v_flagged = row_count;

    -- Excuse the chain's unpaid RECURRING rows (audit-preserving).
    update public.deal_payments dp
       set status = 'cancelled'
     where dp.deal_id = v_job.deal_id
       and dp.service_type = v_job.service_type
       and dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.status in ('pending','overdue');
    get diagnostics v_cancelled = row_count;

    return jsonb_build_object('jobs_flagged', v_flagged, 'payments_cancelled', v_cancelled);
  end $function$;

  create or replace function public.job_resume_billing(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $function$
  declare
    v_job record; v_src record; v_new_id uuid; v_next_end date; v_unflagged int;
  begin
    if not (
      exists (select 1 from public.profiles p
               where p.user_id = auth.uid() and p.is_admin and not p.archived)
      or exists (select 1 from public.profiles p
                   join public.user_groups ug on ug.user_id = p.user_id
                   join public.groups g on g.id = ug.group_id
                  where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
    ) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
    if v_job is null then raise exception 'job_not_found'; end if;
    if v_job.blocked_reason is distinct from 'billing_paused' then raise exception 'not_paused'; end if;

    update public.jobs j
       set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
           billing_active = true
     where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
       and not j.archived and j.blocked_reason = 'billing_paused';
    get diagnostics v_unflagged = row_count;

    -- Fresh period starting TODAY (excused semantics — no back-billing).
    -- Copy pricing from the chain's latest row (any status).
    select dp.* into v_src from public.deal_payments dp
     where dp.deal_id = v_job.deal_id and dp.service_type = v_job.service_type
       and dp.billing_type in ('recurring_monthly','recurring_yearly')
     order by dp.created_at desc limit 1;

    if v_src is not null then
      v_next_end := case when v_src.billing_type = 'recurring_yearly'
                         then (current_date + interval '1 year')::date
                         else (current_date + interval '1 month')::date end;
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status)
        values (v_job.deal_id, v_src.service_type, v_src.service_index, v_src.billing_type,
                v_src.amount_net, v_src.vat_rate, current_date, v_next_end, 'pending')
        returning id into v_new_id;
    end if;

    return jsonb_build_object('jobs_unflagged', v_unflagged, 'new_payment_id', v_new_id,
                              'next_start', current_date, 'next_end', v_next_end);
  end $function$;

  revoke all on function public.job_pause_billing(uuid)  from public, anon;
  revoke all on function public.job_resume_billing(uuid) from public, anon;
  grant execute on function public.job_pause_billing(uuid)  to authenticated, service_role;
  grant execute on function public.job_resume_billing(uuid) to authenticated, service_role;
  ```

- [ ] **Step 2: Apply** (`apply_migration` name `job_billing_pause_S4`) and verify:

  ```sql
  select proname, prosecdef from pg_proc
   where proname in ('job_pause_billing','job_resume_billing');
  ```

  Expected: 2 rows, both `prosecdef = true`.

- [ ] **Step 3: Commit.**

  ```bash
  git add supabase/migrations/20260702100000_job_billing_pause.sql
  git commit -m "feat(billing): pause S4 — job_pause_billing / job_resume_billing RPCs"
  ```

---

### Task 4: SQL harness — 8 pause/resume scenarios

**Files:**
- Create: `supabase/tests/job_billing_pause_harness.sql`

All scenarios: savepoint-rollback against prod, terminal `RAISE EXCEPTION 'RESULT :: <STATUS> Pn :: <detail>'`, per-deal delta assertions, seeds include `client_id` + `billing_type` on jobs and `payment_method='cash'` on deals. Standard seed = deal in `paid_in_full` + one `billing_active` ads job + chain rows as listed. **Auth note:** RPCs check `auth.uid()` — in the harness, wrap each scenario with `set local role postgres;` is NOT enough; instead call the RPC bodies' effects by first stubbing `select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.profiles where is_admin limit 1))::text, true);` so `auth.uid()` resolves to an admin. If that pattern fails on this stack, temporarily `alter function ... security invoker` is NOT acceptable — instead run the RPC as-is and, on `not_allowed`, mark the scenario `HARNESS BUG` and fall back to invoking the RPC bodies' SQL inline. Record which path worked.

- **P1 — pause cancels + flags:** seed ads chain (1 paid old row + 1 overdue current row). Call `job_pause_billing(job)`. Assert: returned `payments_cancelled = 1`; job has `is_blocked=true, blocked_reason='billing_paused', billing_active=false`; the overdue row is now `cancelled`; the paid row untouched.
- **P2 — cron silence:** after P1 state, `perform ensure_recurring_payments()`; assert per-deal delta = 0 (no renewal — `billing_active=false` + cancelled rows aren't sources).
- **P3 — user's exact flow:** seed local_seo (paid, current) + ads (overdue). Pause ads. Assert `deal_next_due(deal)` is the local_seo value or NULL once local is paid; set deal to `paid_in_full`; run full nightly chain (`ensure_recurring_payments` → `mark_overdue_payments` → `reconcile_block_lifecycle(false)`); assert stage STAYS `paid_in_full`.
- **P4 — resume:** after P1, call `job_resume_billing(job)`. Assert: job unblocked + `billing_active=true`; new `pending` row with `start_date = current_date` and correct 1-month end; deal moved to `awaiting_payment` (move_to_awaiting fired on the pending insert).
- **P5 — precedence:** seed job already blocked with `account_on_hold`. Pause → reason becomes `billing_paused`. Resume → clears only `billing_paused`-reason jobs (assert a sibling job blocked `account_on_hold` is untouched).
- **P6 — re-insert over cancelled:** after P1, manually insert a pending row with the SAME period-key as the cancelled row. Assert insert succeeds (L2 + v2 index both allow).
- **P7 — chain scope:** seed TWO ads jobs on one deal (the 14-deals case). Pause via one of them. Assert BOTH are flagged (`jobs_flagged = 2`).
- **P8 — release ignores cancelled:** deal `on_hold` with one overdue ads row + one overdue local row. Pause ads (ads row → cancelled). Mark the local row `paid`. Assert release trigger promotes deal → `paid_in_full` (the cancelled ads row no longer blocks).

- [ ] **Step 1: Write all 8 scenarios** in the harness file (full SQL per scenario, following `supabase/tests/payments_accounting_full_smoke.sql` patterns).
- [ ] **Step 2: Run all 8 via `execute_sql`.** Expected: 8 × PASS. Any FAIL → STOP, fix the migration section it exposes, re-run.
- [ ] **Step 3: Commit.**

  ```bash
  git add supabase/tests/job_billing_pause_harness.sql
  git commit -m "test(billing): pause/resume harness — 8 scenarios PASS"
  ```

---

### Task 5: Frontend — hooks + Billing card + JobDetailPage wiring

**Files:**
- Create: `src/features/jobs/hooks/useJobBillingPause.ts`
- Create: `src/features/jobs/JobBillingPauseCard.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx` (mount card in the Overview left column, near `JobBillingEditCard`)

- [ ] **Step 1: Hook.** Follow the RPC-call pattern used by `useDeleteJobs` (`src/features/jobs/hooks/useDeleteJobs.ts`) — including its typing workaround for RPCs missing from generated types:

  ```ts
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { supabase } from '@/lib/supabase';
  import { queryKeys } from '@/lib/queryKeys';

  type PauseResult = { jobs_flagged: number; payments_cancelled: number };
  type ResumeResult = { jobs_unflagged: number; new_payment_id: string | null };

  export function useJobPauseBilling(jobId: string, dealId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async () => {
        const rpc = supabase.rpc.bind(supabase) as (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>;
        const { data, error } = await rpc('job_pause_billing', { p_job_id: jobId });
        if (error) throw error;
        return data as unknown as PauseResult;
      },
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
        void qc.invalidateQueries({ queryKey: ['deal-payments', dealId] });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      },
    });
  }

  export function useJobResumeBilling(jobId: string, dealId: string) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async () => {
        const rpc = supabase.rpc.bind(supabase) as (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>;
        const { data, error } = await rpc('job_resume_billing', { p_job_id: jobId });
        if (error) throw error;
        return data as unknown as ResumeResult;
      },
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
        void qc.invalidateQueries({ queryKey: ['deal-payments', dealId] });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      },
    });
  }
  ```

  Adjust the two `invalidateQueries` keys to whatever `queryKeys` actually exposes (read `src/lib/queryKeys.ts` first; mirror how `useMoveJobStage` invalidates). **Remember `supabase.rpc.bind(supabase)`** per memory `reference_supabase_from_binding` — a detached `rpc` throws silently.

- [ ] **Step 2: Card.** `src/features/jobs/JobBillingPauseCard.tsx`:

  ```tsx
  import { useState } from 'react';
  import { PauseCircle, PlayCircle } from 'lucide-react';
  import { Button } from '@/components/ui/button';
  import { ConfirmDialog } from '@/components/ui/confirm-dialog';
  import { useAuthStore } from '@/lib/stores/authStore';
  import { formatDate } from '@/lib/datetime';
  import { useJobPauseBilling, useJobResumeBilling } from './hooks/useJobBillingPause';

  type Props = {
    jobId: string;
    dealId: string;
    isBlocked: boolean;
    blockedReason: string | null;
    blockedAt: string | null;
    billingActive: boolean;
    billingType: string;
  };

  export function JobBillingPauseCard({ jobId, dealId, isBlocked, blockedReason, blockedAt, billingActive, billingType }: Props) {
    const isAdmin = useAuthStore((s) => s.isAdmin);
    const groupCodes = useAuthStore((s) => s.groupCodes);
    const canToggle = isAdmin || groupCodes.includes('accounting');
    const paused = blockedReason === 'billing_paused';
    const recurring = billingType === 'recurring_monthly' || billingType === 'recurring_yearly';
    const pause = useJobPauseBilling(jobId, dealId);
    const resume = useJobResumeBilling(jobId, dealId);
    const [confirm, setConfirm] = useState<'pause' | 'resume' | null>(null);

    if (!recurring) return null;               // one_time chains aren't pausable
    if (!paused && !billingActive) return null; // inactive-for-other-reasons: hide
    if (!paused && !canToggle) return null;     // nothing to show non-accounting when active

    return (
      <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Billing
        </h2>
        {paused ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              ⏸ Billing paused{blockedAt ? ` since ${formatDate(blockedAt)}` : ''}. No new
              payments are generated for this service; the deal ignores its unpaid history.
            </p>
            {canToggle && (
              <Button size="sm" onClick={() => setConfirm('resume')} disabled={resume.isPending}>
                <PlayCircle className="size-3.5" /> Resume billing
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Billing is active for this service.
            </p>
            <Button variant="outline" size="sm" onClick={() => setConfirm('pause')} disabled={pause.isPending}>
              <PauseCircle className="size-3.5" /> Pause billing
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm === 'pause' ? 'Pause billing for this service?' : 'Resume billing?'}
          description={
            confirm === 'pause'
              ? 'Unpaid payments for this service will be cancelled (kept in history) and no new periods will be generated. The deal can move to Paid In Full on its other services. Paused months are never back-billed.'
              : 'The job is unblocked and a fresh billing period starts today. The deal will move to Awaiting Payment.'
          }
          onConfirm={() => {
            if (confirm === 'pause') pause.mutate();
            else resume.mutate();
            setConfirm(null);
          }}
        />
      </section>
    );
  }
  ```

  Check `ConfirmDialog`'s actual prop names in `src/components/ui/confirm-dialog.tsx` before wiring (the delete flow on JobDetailPage already uses it — copy its call shape exactly).

- [ ] **Step 3: Mount** in `src/features/jobs/JobDetailPage.tsx`, in the Overview left column right after the `JobBillingEditCard` block (~line 494):

  ```tsx
              <JobBillingPauseCard
                jobId={job.id}
                dealId={job.deal_id}
                isBlocked={!!job.is_blocked}
                blockedReason={job.blocked_reason ?? null}
                blockedAt={job.blocked_at ?? null}
                billingActive={!!job.billing_active}
                billingType={job.billing_type}
              />
  ```

  Add the import. If `useJob`'s select-list omits `billing_active`/`billing_type`/`blocked_at`, extend it (read `src/features/jobs/hooks/useJob.ts` and add the columns).

- [ ] **Step 4: Build.** `npm run build` — strict (per `reference_build_strictness`). Fix `exactOptionalPropertyTypes` complaints with the conditional-spread idiom already used in this file.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/features/jobs/hooks/useJobBillingPause.ts src/features/jobs/JobBillingPauseCard.tsx src/features/jobs/JobDetailPage.tsx src/features/jobs/hooks/useJob.ts
  git commit -m "feat(jobs): Billing pause/resume card on job detail (admin + accounting)"
  ```

---

### Task 6: Frontend — cancelled badge + blocked_reason label

**Files:**
- Modify: `src/features/deals/PaymentsPanel.tsx`
- Modify: the `blocked_reason` label map (locate via `grep -rn "account_on_hold" src/ --include="*.tsx" --include="*.ts"`)

- [ ] **Step 1: PaymentsPanel badge.** Find the status badge/style map in `src/features/deals/PaymentsPanel.tsx` (grep `overdue` inside it). Add a `cancelled` entry rendered muted + strikethrough amount, e.g. `'cancelled': 'bg-muted text-muted-foreground line-through'`, and add `cancelled` to any status filter dropdown so accountants can see excused rows. If a TS union type for status exists, extend it with `'cancelled'`.

- [ ] **Step 2: blocked_reason label.** In every file the grep from above finds mapping `account_on_hold` to a display string, add `billing_paused: 'Billing paused'` (+ Greek `'Παύση χρέωσης'` if the map is i18n-keyed — follow whichever pattern each file uses). Kanban cards already render blocked badges from this map, so no other kanban change is needed.

- [ ] **Step 3: Build + commit.**

  ```bash
  npm run build
  git add -A src/
  git commit -m "feat(billing): cancelled payment badge + billing_paused label"
  ```

---

### Task 7: Regression sweep + live dry-run

**Files:** none (verification only)

- [ ] **Step 1: Re-run the key prior harness scenarios** touched by Section 3's function edits — from `paid_in_full_flip_harness.sql`: B, C, G, H; from `paid_in_full_flip_edgecases.sql`: A2, E4, E5, I1, I2, I3; from `payments_accounting_full_smoke.sql`: A3, A4, B1–B7, G2, G4, G5. Expected: identical results to the post-mitigation baseline in `docs/superpowers/reports/2026-07-02-billing-mitigations-report.md` (no new failures — cancelled filters are no-ops while zero cancelled rows exist outside savepoints).
- [ ] **Step 2: Live dry-runs** (savepoint): `ensure_recurring_payments` and `reconcile_block_lifecycle(false)` — expect the same small numbers as the Task 8 baseline of the mitigations plan (≈3 created / ≈1 moved; investigate if wildly different).
- [ ] **Step 3: Confirm** the 5 sentinel deals (`000131 000051 000203 000512 000066`) unchanged.

---

### Task 8: Revert SQL + push + live UI smoke + memory

- [ ] **Step 1: Append Section 5 (revert)** to the migration — commented block containing: restore old CHECK (without `cancelled` — NOTE: only valid while zero cancelled rows exist; document that rows must be deleted/re-statused first), recreate v1 index + drop v2, the 6 verbatim pre-patch bodies from `/tmp/prior_bodies_pause_20260702.sql`, `drop function job_pause_billing(uuid); drop function job_resume_billing(uuid);`. Commit: `docs(billing): revert SQL for job billing pause`.
- [ ] **Step 2: Push** `git push origin main`; wait for Vercel (poll the bundle hash like prior deploys; beware `reference_vercel_stale_chunk_404`).
- [ ] **Step 3: Live UI smoke** (Playwright, admin `info@itdev.gr`): open a real recurring job → Billing card visible → **do NOT pause a real client** — instead verify the card renders and the confirm dialog opens/closes. Full pause/resume was already proven at the SQL layer (Task 4, rolled back). If the user wants a real end-to-end, ask them to nominate a sacrificial deal.
- [ ] **Step 4: Memory** — new `project_job_billing_pause.md` (feature summary, chain-scoped semantics, excused billing, RPC names, cancelled-status ripple through all layers, revert caveat about the CHECK) + one-line MEMORY.md index entry.

---

## Self-Review

**1. Spec coverage:** pause per job ✅ (chain-scoped, Task 3); accountant-selectable ✅ (RPC gate + card visibility, Tasks 3/5); deal movable to fully-paid while one service unpaid ✅ (`deal_next_due` cancelled filter, Task 2; proven by harness P3); paid job renews ✅ (unaffected chain, P3); paused job stays blocked ✅ (`is_blocked` + `billing_paused`, P1/P5); resume ✅ (P4).
**2. Placeholder scan:** none — every step has code or an exact command; the two "read the file first" notes (ConfirmDialog props, queryKeys) are verification steps, not gaps.
**3. Type consistency:** RPC names `job_pause_billing`/`job_resume_billing` consistent across Tasks 3/4/5; status literal `'cancelled'` everywhere; index name `_v2` consistent in Task 1 and revert.
**4. Memory caveats:** DDL via MCP only; `.bind(supabase)` for rpc; strict `npm run build`; atomic commits, no PRs, push at the end; revert SQL embedded; no secrets.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-02-job-billing-pause.md`.
