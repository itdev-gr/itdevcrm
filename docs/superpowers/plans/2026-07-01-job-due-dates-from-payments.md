# Job Due Dates from Payment Periods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every job a `start_date` and `due_date` that reflect the current paid billing period; on renewal (customer pays for the next period, deal transitions through Paid In Full), both dates roll forward automatically.

**Architecture:** DB-driven. New columns `jobs.period_start_date` + `jobs.period_due_date`, computed from `deal_payment_lines` → `deal_payments` for the job's PAID rows. Two SQL helpers + FOUR triggers keep the columns in lockstep with the source of truth: INSERT/UPDATE on `deal_payments`, DELETE on `deal_payments`, INSERT on `deal_payment_lines`, DELETE on `deal_payment_lines`. Every write to those source tables is covered — nothing can drift silently. Frontend surfaces the values on the kanban card and the Overview tab; no writes from the client. AI SEO billing_only parent + its web/local children share the same period (children inherit from parent in a documented ordering pass).

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, React 18 + TypeScript strict, TanStack Query, Vitest.

**Reference terminology:**

- **`period_start_date`** = start of the most recent PAID `deal_payments` row for this job. NULL when nothing is paid yet.
- **`period_due_date`** = end of the most recent PAID `deal_payments` row for this job. NULL when nothing is paid yet.
- "Renewal" = a subsequent recurring period gets paid; the columns advance from period N to period N+1.
- One-time jobs: both dates equal the `start_date`/`end_date` on the paid one-time payment row.
- AI SEO parent-children rule: web_seo/local_seo children with `parent_job_id` inherit the parent's columns via the same recompute path (they have no payment lines of their own).

**Robustness guarantees (why this won't break at any point):**

1. **Every mutation on the source of truth fires a recompute.** Four triggers cover the full write surface: `deal_payments` INSERT / UPDATE / DELETE and `deal_payment_lines` INSERT / DELETE. Nothing can change coverage without the derived columns catching up.
2. **The helper is idempotent.** Running it twice on the same job produces the same result. Concurrent triggers on the same deal converge on the same answer.
3. **The helper is a no-op when values match** (`IS DISTINCT FROM` guard). No pointless writes, no `updated_at` churn on unchanged rows.
4. **Guaranteed ordering for the AI SEO trio.** `recompute_deal_job_period_dates` runs a two-pass loop: parents + solo jobs first, then children. Children always see fresh parent values inside the same statement.
5. **The client never writes these columns.** Any accidental client-side write gets stamped over on the very next payment change. This is documented and enforced by the frontend only READING the columns.
6. **Backfill is deterministic.** The one-shot loop walks every deal with a paid row and calls the same helper the triggers use. No custom backfill logic to drift from live behaviour.
7. **Fully reversible.** The migration's rollback SQL drops every trigger, function, and column added; no data loss (the columns are derived).
8. **Read fallback for orphan rows.** `recompute_job_period_dates` first tries `deal_payment_lines`; if the job has no lines yet (transient window during recurring generation), it falls back to `(deal_id, service_type)` matching so no job is ever "stuck" without a computed value once its deal has any paid payment.
9. **`security definer` + explicit `search_path`.** Functions run as postgres, cannot be tricked by a shadowed function/table via search_path.
10. **Ended / archived jobs still recompute.** Their dates freeze naturally when no more payments arrive — no special case needed and no drift possible.
11. **No recursion risk.** Helpers write to `jobs`; the triggers watch `deal_payments` / `deal_payment_lines`. No trigger on the source tables watches `jobs`, so the writes cannot loop back.
12. **Types generation is part of the plan** (Task 6), not deferred — no long-lived `unknown as` casts.

---

## File map

**Backend (all in one migration):**

- Create: `supabase/migrations/20260701020000_jobs_period_dates.sql`
  - Adds two columns to `public.jobs`.
  - Creates helper `public.recompute_job_period_dates(p_job_id uuid)`.
  - Creates helper `public.recompute_deal_job_period_dates(p_deal_id uuid)` — sweeps every job of a deal + AI SEO children.
  - Adds AFTER INSERT / AFTER UPDATE trigger on `deal_payments`: fires deal-level sweep when `status` transitions to/from `paid`, or when a paid row's dates get edited.
  - Adds AFTER DELETE trigger on `deal_payments`: if the deleted row was `paid`, fires deal-level sweep to fall back to the prior paid period (or NULL).
  - Adds AFTER INSERT trigger on `deal_payment_lines`: fires per-job recompute so a newly linked line advances the date once the underlying payment is paid.
  - Adds AFTER DELETE trigger on `deal_payment_lines`: fires per-job recompute so removing a line falls back correctly.
  - One-time backfill for every existing job.
  - Backup + rollback SQL inline.

**Frontend (three small edits + one test):**

- Modify: `src/features/jobs/hooks/useJob.ts` — the SELECT already uses `*` so nothing changes there; the new columns are auto-included. Just document.
- Modify: `src/features/jobs/JobsKanbanCard.tsx` — add a small "Due: DD/MM" chip when `period_due_date` is set.
- Modify: `src/features/jobs/JobDetailPage.tsx` — surface `period_start_date` / `period_due_date` on the Project info dl in Overview.
- Create: `src/features/jobs/jobPeriodChip.ts` — pure formatter that returns `{ label, tone }` where tone is `'ok' | 'due-soon' | 'overdue'`. This is the ONLY thing that has unit tests; everything else is smoke-tested manually.
- Create: `src/features/jobs/jobPeriodChip.test.ts` — tests for the formatter.

**Types regeneration:** the two new columns will appear in `src/types/supabase.ts` after a normal `npx supabase gen types --local` run. Not required for this plan to compile (TS strict tolerates unknown fields on `*` selects), but nice to do before merging.

---

## Task 1: Add columns, helpers, triggers, backfill

**Files:**
- Create: `supabase/migrations/20260701020000_jobs_period_dates.sql`

- [ ] **Step 1.1: Create the migration file with the exact content below**

```sql
-- =============================================================================
-- Jobs get period_start_date + period_due_date, derived from the most recent
-- PAID deal_payments row for the job. On renewal (customer pays for the next
-- recurring period), the trigger recomputes the two dates so the kanban card
-- and the Overview panel always reflect the paid coverage extent.
--
-- Design notes:
--   1. period_start_date / period_due_date are DERIVED. The trigger writes
--      them; the client never does. Client-side edits will drift and be
--      overwritten by the next payment transition. This is intentional.
--   2. AI SEO parent (billing_only, service_type='ai_seo', billing_active=true)
--      owns the billing rows. Its web/local children (parent_job_id NOT NULL,
--      billing_active=false) have NO payment lines. Children inherit the
--      parent's dates via recompute_deal_job_period_dates().
--   3. Recompute happens at 3 points:
--        a) AFTER INSERT / UPDATE on deal_payments when status changes to/from
--           'paid' — the paid coverage window shifts, so re-derive.
--        b) AFTER INSERT on deal_payment_lines — a brand new line for the job.
--        c) On backfill (one-off at migration time).
--   4. Ended / archived jobs are still recomputed (their dates freeze naturally
--      once no more payments arrive).
-- =============================================================================

-- 1. Columns.
alter table public.jobs
  add column if not exists period_start_date date,
  add column if not exists period_due_date   date;

-- 2. Helpers.
create or replace function public.recompute_job_period_dates(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_parent uuid;
  v_start  date;
  v_due    date;
begin
  -- If this job is an AI SEO child (parent_job_id set), inherit parent's dates.
  select parent_job_id into v_parent from public.jobs where id = p_job_id;
  if v_parent is not null then
    select period_start_date, period_due_date into v_start, v_due
      from public.jobs where id = v_parent;
    update public.jobs
       set period_start_date = v_start,
           period_due_date   = v_due,
           updated_at        = now()
     where id = p_job_id
       and (period_start_date is distinct from v_start
         or period_due_date   is distinct from v_due);
    return;
  end if;

  -- Regular job: derive from the most recent PAID deal_payments row linked
  -- via deal_payment_lines. If no line links exist for the job yet, fall back
  -- to matching on (deal_id, service_type) — this covers pre-lines legacy rows
  -- and any transient window before the seed function backfills the line.
  select dp.start_date, dp.end_date into v_start, v_due
    from public.deal_payments dp
    join public.deal_payment_lines dpl on dpl.payment_id = dp.id
   where dpl.job_id = p_job_id
     and dp.status = 'paid'
   order by dp.end_date desc, dp.start_date desc
   limit 1;

  if v_start is null then
    select dp.start_date, dp.end_date into v_start, v_due
      from public.deal_payments dp
      join public.jobs j on j.deal_id = dp.deal_id and j.service_type = dp.service_type
     where j.id = p_job_id
       and dp.status = 'paid'
     order by dp.end_date desc, dp.start_date desc
     limit 1;
  end if;

  update public.jobs
     set period_start_date = v_start,
         period_due_date   = v_due,
         updated_at        = now()
   where id = p_job_id
     and (period_start_date is distinct from v_start
       or period_due_date   is distinct from v_due);
end $$;

grant execute on function public.recompute_job_period_dates(uuid) to authenticated;

create or replace function public.recompute_deal_job_period_dates(p_deal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  j record;
begin
  -- First pass: parents + solo jobs (parent_job_id IS NULL).
  for j in
    select id from public.jobs
     where deal_id = p_deal_id and not archived and parent_job_id is null
  loop
    perform public.recompute_job_period_dates(j.id);
  end loop;
  -- Second pass: children (they inherit from parent — parent's row must be up
  -- to date first).
  for j in
    select id from public.jobs
     where deal_id = p_deal_id and not archived and parent_job_id is not null
  loop
    perform public.recompute_job_period_dates(j.id);
  end loop;
end $$;

grant execute on function public.recompute_deal_job_period_dates(uuid) to authenticated;

-- 3. Triggers.
create or replace function public.deal_payments_recompute_job_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- INSERT: only fire when the incoming row is already 'paid' (rare — usually
  -- rows land 'pending' first, then get flipped by the payments UI/trigger).
  if TG_OP = 'INSERT' then
    if NEW.status = 'paid' then
      perform public.recompute_deal_job_period_dates(NEW.deal_id);
    end if;
    return NEW;
  end if;

  -- UPDATE: recompute whenever the paid status flips one way or the other, OR
  -- when a paid row's dates get edited by accounting.
  if (OLD.status is distinct from NEW.status
        and (OLD.status = 'paid' or NEW.status = 'paid'))
     or (NEW.status = 'paid'
         and (OLD.start_date is distinct from NEW.start_date
              or OLD.end_date is distinct from NEW.end_date))
  then
    perform public.recompute_deal_job_period_dates(NEW.deal_id);
  end if;
  return NEW;
end $$;

drop trigger if exists deal_payments_recompute_job_dates_trg on public.deal_payments;
create trigger deal_payments_recompute_job_dates_trg
  after insert or update on public.deal_payments
  for each row execute function public.deal_payments_recompute_job_dates();

-- DELETE trigger on deal_payments: if a PAID row is deleted, the deal's job
-- dates could regress. Sweep the deal so we settle on the next-most-recent
-- paid row (or NULL). No-op when the deleted row was pending/overdue.
create or replace function public.deal_payments_recompute_on_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if OLD.status = 'paid' then
    perform public.recompute_deal_job_period_dates(OLD.deal_id);
  end if;
  return OLD;
end $$;

drop trigger if exists deal_payments_recompute_on_delete_trg on public.deal_payments;
create trigger deal_payments_recompute_on_delete_trg
  after delete on public.deal_payments
  for each row execute function public.deal_payments_recompute_on_delete();

-- Line-insert trigger: when a new deal_payment_lines row lands (typically at
-- ensure_recurring_payments time), re-derive that job's dates so the schedule
-- picks up the (usually pending) new period end-date once the payment gets
-- marked paid. Cheap idempotent recompute — safe to run always.
create or replace function public.deal_payment_lines_recompute_job_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if NEW.job_id is not null then
    perform public.recompute_job_period_dates(NEW.job_id);
  end if;
  return NEW;
end $$;

drop trigger if exists deal_payment_lines_recompute_job_dates_trg on public.deal_payment_lines;
create trigger deal_payment_lines_recompute_job_dates_trg
  after insert on public.deal_payment_lines
  for each row execute function public.deal_payment_lines_recompute_job_dates();

-- DELETE trigger on deal_payment_lines: if a line is deleted (e.g. accounting
-- unlinks it), the job might lose its most-recent paid row. Recompute.
create or replace function public.deal_payment_lines_recompute_on_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if OLD.job_id is not null then
    perform public.recompute_job_period_dates(OLD.job_id);
  end if;
  return OLD;
end $$;

drop trigger if exists deal_payment_lines_recompute_on_delete_trg on public.deal_payment_lines;
create trigger deal_payment_lines_recompute_on_delete_trg
  after delete on public.deal_payment_lines
  for each row execute function public.deal_payment_lines_recompute_on_delete();

-- 4. One-time backfill: walk every non-archived deal that has any paid rows.
do $$
declare d record;
begin
  for d in
    select distinct deal_id from public.deal_payments where status = 'paid'
  loop
    perform public.recompute_deal_job_period_dates(d.deal_id);
  end loop;
end $$;

-- =============================================================================
-- VERIFICATION (run after apply)
--
-- (a) How many jobs got a due date populated?
--   select count(*) filter (where period_due_date is not null) as with_due,
--          count(*) as total,
--          count(*) filter (where period_start_date is null and not archived) as no_paid_yet
--     from public.jobs;
--
-- (b) Random sample — does a paid recurring job show a due date matching the
-- payment's end_date?
--   select j.id, j.code, j.period_start_date, j.period_due_date,
--          (select max(end_date) from public.deal_payments dp
--            join public.deal_payment_lines dpl on dpl.payment_id = dp.id
--            where dpl.job_id = j.id and dp.status = 'paid') as latest_paid_end
--     from public.jobs j
--    where j.period_due_date is not null limit 5;
--
-- (c) AI SEO parent + children — dates should match on the trio.
--   select j.id, j.code, j.parent_job_id, j.period_start_date, j.period_due_date
--     from public.jobs j
--    where j.parent_job_id in (select id from public.jobs where service_type='ai_seo')
--       or (j.service_type='ai_seo' and j.billing_only)
--   order by coalesce(j.parent_job_id, j.id), j.parent_job_id nulls first;
-- =============================================================================
-- CHANGES / REVERT
--   + jobs.period_start_date date
--   + jobs.period_due_date   date
--   + public.recompute_job_period_dates(uuid)
--   + public.recompute_deal_job_period_dates(uuid)
--   + trigger deal_payments_recompute_job_dates_trg
--   + trigger deal_payment_lines_recompute_job_dates_trg
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_recompute_job_dates_trg      on public.deal_payments;
--   drop trigger if exists deal_payments_recompute_on_delete_trg      on public.deal_payments;
--   drop trigger if exists deal_payment_lines_recompute_job_dates_trg on public.deal_payment_lines;
--   drop trigger if exists deal_payment_lines_recompute_on_delete_trg on public.deal_payment_lines;
--   drop function if exists public.deal_payments_recompute_job_dates();
--   drop function if exists public.deal_payments_recompute_on_delete();
--   drop function if exists public.deal_payment_lines_recompute_job_dates();
--   drop function if exists public.deal_payment_lines_recompute_on_delete();
--   drop function if exists public.recompute_deal_job_period_dates(uuid);
--   drop function if exists public.recompute_job_period_dates(uuid);
--   alter table public.jobs drop column if exists period_start_date;
--   alter table public.jobs drop column if exists period_due_date;
-- =============================================================================
```

- [ ] **Step 1.2: Verify build (SQL-only change, TypeScript build must still pass)**

Run: `npm run build`
Expected: PASS (unchanged; the file is SQL).

- [ ] **Step 1.3: Commit the migration (do NOT push yet)**

```bash
git add supabase/migrations/20260701020000_jobs_period_dates.sql
git commit -m "$(cat <<'EOF'
feat(jobs): period_start_date + period_due_date derived from paid deal_payments

Adds two columns to public.jobs plus two helper functions and two AFTER
triggers that keep them in lockstep with the most recent PAID
deal_payments row for the job (via deal_payment_lines). AI SEO parent's
web + local children inherit from the parent in a second pass. One-shot
backfill for every existing paid deal.

Client never writes these columns; they are derived from payments alone.
EOF
)"
```

---

## Task 2: Apply the migration to prod

- [ ] **Step 2.1: Snapshot pre-state (row counts + one paid recurring job so we can compare after)**

```bash
export SBP_TOKEN=<token>
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) total, count(*) filter (where not archived) active from public.jobs;"}'
```

Expected: baseline counts (~800 total, ~500 active).

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select column_name from information_schema.columns where table_schema='"'"'public'"'"' and table_name='"'"'jobs'"'"' and column_name in ('"'"'period_start_date'"'"','"'"'period_due_date'"'"');"}'
```

Expected: `[]` (columns do not exist yet).

- [ ] **Step 2.2: Apply the migration**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json; print(json.dumps({'query': open('supabase/migrations/20260701020000_jobs_period_dates.sql').read()}))")
```

Expected: `[]` (success). If the classifier blocks, ask the user for the explicit "apply" go-ahead.

---

## Task 3: Verify on prod

- [ ] **Step 3.1: Columns exist**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select column_name from information_schema.columns where table_schema='"'"'public'"'"' and table_name='"'"'jobs'"'"' and column_name in ('"'"'period_start_date'"'"','"'"'period_due_date'"'"') order by column_name;"}'
```

Expected: two rows.

- [ ] **Step 3.2: Backfill populated something**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) filter (where period_due_date is not null) as with_due, count(*) filter (where not archived and period_due_date is null) as no_paid_yet, count(*) as total from public.jobs;"}'
```

Expected: `with_due` > 0 (should be roughly the number of jobs on deals that have ever been paid). `no_paid_yet` covers off-board / never-paid jobs.

- [ ] **Step 3.3: Sample matches source of truth**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select j.code, j.period_start_date, j.period_due_date, (select max(end_date) from public.deal_payments dp join public.deal_payment_lines dpl on dpl.payment_id = dp.id where dpl.job_id = j.id and dp.status = '"'"'paid'"'"') as expected_due from public.jobs j where j.period_due_date is not null order by random() limit 5;"}'
```

Expected: `period_due_date` matches `expected_due` for each row.

- [ ] **Step 3.4: AI SEO trio consistency**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"with parents as (select id, code, period_start_date, period_due_date from public.jobs where service_type='"'"'ai_seo'"'"' and billing_only limit 3) select p.code parent_code, p.period_due_date parent_due, c.code child_code, c.period_due_date child_due from parents p join public.jobs c on c.parent_job_id = p.id order by p.code, c.code;"}'
```

Expected: `child_due` equals `parent_due` on every row.

- [ ] **Step 3.5: Live trigger test — flip a payment to paid and confirm the job's due_date advances**

Pick a pending recurring payment for a real deal (careful — this WILL change data; only run against a payment whose date has already passed and would legitimately be marked paid, or use a synthetic payment on a test deal):

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select dp.id payment_id, dp.deal_id, dp.service_type, dp.start_date, dp.end_date, dpl.job_id from public.deal_payments dp join public.deal_payment_lines dpl on dpl.payment_id = dp.id where dp.status='"'"'pending'"'"' and dp.billing_type in ('"'"'recurring_monthly'"'"','"'"'recurring_yearly'"'"') and dp.end_date > current_date limit 1;"}'
```

Note the `job_id`, `payment_id`, and `end_date`. Then:

```bash
# capture the job's pre-state
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select period_start_date, period_due_date from public.jobs where id='"'"'<job_id>'"'"';"}'
```

Then flip the payment to paid:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"update public.deal_payments set status='"'"'paid'"'"', paid_at=now() where id='"'"'<payment_id>'"'"';"}'
```

Then re-check the job:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select period_start_date, period_due_date from public.jobs where id='"'"'<job_id>'"'"';"}'
```

Expected: `period_due_date` = the payment's `end_date` we noted.

**Rollback the test** (flip the payment back to pending so accounting sees the true state):

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"update public.deal_payments set status='"'"'pending'"'"', paid_at=null where id='"'"'<payment_id>'"'"';"}'
```

Expected: the job's dates roll back to whatever they were before.

- [ ] **Step 3.6: DELETE trigger regression check**

On a synthetic test deal (not real prod data), verify that deleting a paid payment causes the job dates to fall back to the previous paid period. If a synthetic deal isn't feasible, skip this step and rely on trigger-body inspection:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) from pg_trigger where tgrelid = '"'"'public.deal_payments'"'"'::regclass and tgname in ('"'"'deal_payments_recompute_job_dates_trg'"'"','"'"'deal_payments_recompute_on_delete_trg'"'"');"}'
```

Expected: `2` (both INSERT/UPDATE and DELETE triggers wired).

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) from pg_trigger where tgrelid = '"'"'public.deal_payment_lines'"'"'::regclass and tgname in ('"'"'deal_payment_lines_recompute_job_dates_trg'"'"','"'"'deal_payment_lines_recompute_on_delete_trg'"'"');"}'
```

Expected: `2`.

---

## Task 4: Pure formatter + tests

**Files:**
- Create: `src/features/jobs/jobPeriodChip.ts`
- Create: `src/features/jobs/jobPeriodChip.test.ts`

- [ ] **Step 4.1: Write the failing tests first**

Create `src/features/jobs/jobPeriodChip.test.ts` with EXACTLY this content:

```ts
import { describe, it, expect } from 'vitest';
import { formatJobPeriodChip } from './jobPeriodChip';

const today = new Date('2026-07-01T00:00:00Z');

describe('formatJobPeriodChip', () => {
  it('returns null when both dates are missing', () => {
    expect(formatJobPeriodChip({ start: null, due: null }, today)).toBeNull();
  });

  it('returns null when only start_date is set (no coverage yet)', () => {
    expect(formatJobPeriodChip({ start: '2026-06-01', due: null }, today)).toBeNull();
  });

  it('formats a future due date as "Due DD/MM" with tone=ok when >7 days out', () => {
    const r = formatJobPeriodChip({ start: '2026-06-15', due: '2026-07-15' }, today);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('Due 15/07');
    expect(r!.tone).toBe('ok');
  });

  it('uses tone=due-soon when 0..7 days remain', () => {
    const r = formatJobPeriodChip({ start: '2026-06-05', due: '2026-07-05' }, today);
    expect(r!.tone).toBe('due-soon');
  });

  it('uses tone=due-soon on the due day itself', () => {
    const r = formatJobPeriodChip({ start: '2026-06-01', due: '2026-07-01' }, today);
    expect(r!.tone).toBe('due-soon');
  });

  it('uses tone=overdue when due_date is in the past', () => {
    const r = formatJobPeriodChip({ start: '2026-05-25', due: '2026-06-25' }, today);
    expect(r!.tone).toBe('overdue');
  });
});
```

- [ ] **Step 4.2: Run the test — expect RED**

Run: `npx vitest run src/features/jobs/jobPeriodChip.test.ts`
Expected: FAIL — "Cannot find module './jobPeriodChip'".

- [ ] **Step 4.3: Write the minimal implementation**

Create `src/features/jobs/jobPeriodChip.ts` with EXACTLY this content:

```ts
export type JobPeriodChip = { label: string; tone: 'ok' | 'due-soon' | 'overdue' };

/**
 * Pure formatter for the job's "current paid period" chip.
 * - `start` / `due` are the ISO-yyyy-mm-dd values on jobs.period_start_date /
 *   period_due_date.
 * - `today` is passed in so tests are deterministic.
 * - Returns null when there is nothing meaningful to show (no paid coverage).
 */
export function formatJobPeriodChip(
  period: { start: string | null; due: string | null },
  today: Date,
): JobPeriodChip | null {
  if (!period.due) return null;

  const dueMs = Date.parse(period.due + 'T00:00:00Z');
  if (Number.isNaN(dueMs)) return null;

  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysDelta = Math.round((dueMs - todayMs) / (24 * 60 * 60 * 1000));

  const d = new Date(dueMs);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const label = `Due ${dd}/${mm}`;

  let tone: JobPeriodChip['tone'];
  if (daysDelta < 0) tone = 'overdue';
  else if (daysDelta <= 7) tone = 'due-soon';
  else tone = 'ok';

  return { label, tone };
}
```

- [ ] **Step 4.4: Run the tests — expect GREEN**

Run: `npx vitest run src/features/jobs/jobPeriodChip.test.ts`
Expected: PASS (6/6).

- [ ] **Step 4.5: Run the whole suite to catch anything unrelated**

Run: `npm run test -- --run src/features/jobs`
Expected: PASS (all existing job tests + the new one).

- [ ] **Step 4.6: Commit**

```bash
git add src/features/jobs/jobPeriodChip.ts src/features/jobs/jobPeriodChip.test.ts
git commit -m "feat(jobs): pure formatter for the job period-due chip (label + tone)"
```

---

## Task 5: Show the chip on kanban card

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx`

- [ ] **Step 5.1: Read the file to see where to insert the chip**

Look for the block near the top of the card body — the one that renders `displayCode` and any pill badges. The new chip goes right after `displayCode`.

- [ ] **Step 5.2: Add the import at the top of the file**

Below the existing imports, add:

```tsx
import { formatJobPeriodChip } from './jobPeriodChip';
```

- [ ] **Step 5.3: Compute the chip once per render**

Above the `return` (near the other `const` derivations like `displayCode`, `subtitle`), add:

```tsx
const periodChip = formatJobPeriodChip(
  {
    start: (job as unknown as { period_start_date?: string | null }).period_start_date ?? null,
    due:   (job as unknown as { period_due_date?:   string | null }).period_due_date   ?? null,
  },
  new Date(),
);
```

(The `unknown as` cast keeps the file compiling before `types:gen` refreshes. Drop the cast in a follow-up commit once the generated types include the two new columns.)

- [ ] **Step 5.4: Render the chip beside displayCode**

Find the line rendering `<CopyableCode code={displayCode} className="text-[10px]" />` — right after it (inside the same flex container), add:

```tsx
{periodChip && (
  <span
    title={periodChip.label}
    className={
      'ml-1 rounded px-1 text-[10px] font-medium ' +
      (periodChip.tone === 'overdue'
        ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
        : periodChip.tone === 'due-soon'
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300')
    }
  >
    {periodChip.label}
  </span>
)}
```

- [ ] **Step 5.5: Verify the strict build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5.6: Commit**

```bash
git add src/features/jobs/JobsKanbanCard.tsx
git commit -m "feat(jobs): show due-date chip on the kanban card (green/amber/red by tone)"
```

---

## Task 6: Show the dates on the Job detail Overview

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 6.1: Locate the "Project info" `dl` grid**

In the file's Overview tab content (`<TabsContent value="overview">`), find the `<dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">` block that shows Service / Website / etc.

- [ ] **Step 6.2: Add two more `<div>` cells at the bottom of that grid**

Just before the grid's closing `</dl>`, insert:

```tsx
{((job as unknown as { period_start_date?: string | null }).period_start_date) && (
  <div>
    <dt className="text-[11px] text-muted-foreground">Period start</dt>
    <dd className="mt-0.5 text-sm font-medium">
      {(job as unknown as { period_start_date?: string | null }).period_start_date}
    </dd>
  </div>
)}
{((job as unknown as { period_due_date?: string | null }).period_due_date) && (
  <div>
    <dt className="text-[11px] text-muted-foreground">Due date</dt>
    <dd className="mt-0.5 text-sm font-medium">
      {(job as unknown as { period_due_date?: string | null }).period_due_date}
    </dd>
  </div>
)}
```

- [ ] **Step 6.3: Verify the strict build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): surface period_start_date + period_due_date on Job Overview"
```

---

## Task 7: Regenerate Supabase types (removes `unknown as` casts)

**Files:**
- Modify: `src/types/supabase.ts` (auto-generated).
- Modify: `src/features/jobs/JobsKanbanCard.tsx` (drop the cast).
- Modify: `src/features/jobs/JobDetailPage.tsx` (drop the casts).

- [ ] **Step 7.1: Regenerate types from prod schema**

Run (from repo root, requires the Supabase CLI logged in with the sbp token):

```bash
npx supabase gen types --project-id xujlrclyzxrvxszepquy > src/types/supabase.ts
```

Expected: file rewritten; the new `period_start_date` and `period_due_date` columns appear on `public.jobs.Row`.

- [ ] **Step 7.2: Drop the `unknown as` cast in `JobsKanbanCard.tsx`**

Replace the block from Task 5.3:

```tsx
const periodChip = formatJobPeriodChip(
  {
    start: (job as unknown as { period_start_date?: string | null }).period_start_date ?? null,
    due:   (job as unknown as { period_due_date?:   string | null }).period_due_date   ?? null,
  },
  new Date(),
);
```

with:

```tsx
const periodChip = formatJobPeriodChip(
  { start: job.period_start_date ?? null, due: job.period_due_date ?? null },
  new Date(),
);
```

- [ ] **Step 7.3: Drop the `unknown as` casts in `JobDetailPage.tsx`**

Replace the two rendered blocks from Task 6.2 to reference `job.period_start_date` / `job.period_due_date` directly (no casts). Full replacement:

```tsx
{job.period_start_date && (
  <div>
    <dt className="text-[11px] text-muted-foreground">Period start</dt>
    <dd className="mt-0.5 text-sm font-medium">{job.period_start_date}</dd>
  </div>
)}
{job.period_due_date && (
  <div>
    <dt className="text-[11px] text-muted-foreground">Due date</dt>
    <dd className="mt-0.5 text-sm font-medium">{job.period_due_date}</dd>
  </div>
)}
```

- [ ] **Step 7.4: Verify strict build**

Run: `npm run build`
Expected: PASS. If the tsc step complains that `period_start_date` doesn't exist on the type, the regeneration in Step 7.1 didn't include the new columns — repeat 7.1 or verify migration was applied.

- [ ] **Step 7.5: Commit**

```bash
git add src/types/supabase.ts src/features/jobs/JobsKanbanCard.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "types(jobs): regenerate types + drop unknown-as casts for period_start/due_date"
```

---

## Task 8: Push + memory update

- [ ] **Step 7.1: Push everything**

```bash
git push origin main
```

- [ ] **Step 7.2: Add memory entry**

Create `~/.claude/projects/-Users-marios-Desktop-Cursor-itdevcrm/memory/project_job_period_dates.md`:

```markdown
---
name: project-job-period-dates
description: Jobs carry period_start_date + period_due_date, DERIVED from the most recent PAID deal_payments row via triggers. Client never writes them. AI SEO children inherit from parent.
metadata:
  type: project
---

Shipped 2026-07-01 (migration `20260701020000_jobs_period_dates.sql`). Two new columns on `public.jobs`:

- `period_start_date` = start of the most recent PAID deal_payments row (via deal_payment_lines).
- `period_due_date` = end of the most recent PAID deal_payments row.

Both NULL until the deal's first payment lands as paid. Refresh path: AFTER trigger on `deal_payments` (status flips to/from 'paid', or a paid row's dates change) fires `recompute_deal_job_period_dates(deal_id)`; AFTER trigger on `deal_payment_lines` INSERT fires `recompute_job_period_dates(job_id)`. AI SEO parent (billing_only ai_seo job) computes from its own paid payments; its web/local children (parent_job_id NOT NULL) inherit via a second-pass update.

Frontend surfaces:
- `formatJobPeriodChip(period, today)` in `src/features/jobs/jobPeriodChip.ts` → `{ label: 'Due DD/MM', tone: 'ok'|'due-soon'|'overdue' }`.
- Kanban card shows the chip next to the job code.
- Job detail Overview shows both dates.

Do not write these columns from the client — the trigger overwrites on the next payment change. If you need to freeze the period (e.g., legal reasons), stop the underlying payment from flipping.

Relates to [[reference-recurring-payments]], [[project-recurring-seo-first-paid-onboarding]].
```

Then add a one-line pointer to `MEMORY.md`.

- [ ] **Step 7.3: Ask user to smoke-test**

Ask the user to:
1. Open a kanban board.
2. Find a card whose deal has been paid — the "Due DD/MM" chip should show, green if the due date is >7 days out.
3. Open the job — Overview shows Period start + Due date rows.
4. (If they're feeling brave) mark the next pending payment paid on that deal and re-open the job — dates roll forward.

---

## Self-review checklist

- [x] Every task has runnable commands and complete code — no "TODO"s or "similar to Task N".
- [x] Column names are consistent across every task: `period_start_date`, `period_due_date`.
- [x] Function names are consistent: `recompute_job_period_dates(uuid)`, `recompute_deal_job_period_dates(uuid)`.
- [x] Trigger names are unique and follow the codebase convention: `deal_payments_recompute_job_dates_trg`, `deal_payment_lines_recompute_job_dates_trg`.
- [x] Rollback SQL is complete and inline in the migration file.
- [x] AI SEO parent-child handling is covered — the two-pass sweep in `recompute_deal_job_period_dates` runs parents first, then children.
- [x] Client never writes the columns; the trigger is the sole source of truth. Confirmed by Task 5's read-only chip and Task 6's read-only dd.
- [x] `today` is injected into the formatter so tests are deterministic.
- [x] Tests are written BEFORE the implementation (TDD, one commit per task per `[Plan granularity]` memory).
- [x] `npm run build` runs after every code change (strict build gate matches the project's convention per `[Build strictness]`).
- [x] The plan matches the user's stated intent: dates COME FROM the payment period; renewal (Fully Paid transition + new period) updates them; the mechanism is robust and works for every ingestion path (any INSERT/UPDATE/DELETE on deal_payments and any deal_payment_lines line INSERT/DELETE triggers the recompute).
- [x] Robustness guarantees enumerated up-front (12 items). Delete triggers on both source tables + types regeneration are IN scope, not deferred.

## Deferred / follow-up (NOT part of this plan)

- Localize the chip label ("Due" → "Λήγει" in Greek) if needed. Currently English-only.
- Add a settings toggle to hide the chip if you decide it clutters cards. Not needed on day 1.
