# Recurring SEO First-Paid Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a recurring `local_seo`/`web_seo` job, the deal's *first* Fully-Paid lands it in **New project** (firing the onboarding access email) and marks it; every *later* Fully-Paid sends it to **Renewal** — with an email safety net so the onboarding email can't silently miss.

**Architecture:** One SQL migration. A once-only `jobs.onboarded_at` marker drives a rewritten `release_deal_jobs()` (the single function fired by every Paid-In-Full path). A shared helper `seo_onboarding_pending_jobs()` feeds both an extended `email_pipeline_health()` (admin-banner detection) and a new `reconcile_seo_onboarding_emails()` cron (self-heal). Verified with pgTAP.

**Tech Stack:** Postgres (Supabase), pgTAP tests (`supabase test db`), pg_cron.

**Spec:** `docs/superpowers/specs/2026-06-29-recurring-seo-first-paid-onboarding-design.md`

---

## File Structure

- **Create:** `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`
  — column + backfill + `release_deal_jobs` rewrite + `seo_onboarding_pending_jobs` + reconciler + cron + `email_pipeline_health` extension. (One feature, one migration, per repo convention.)
- **Create:** `supabase/tests/release_deal_jobs_onboarding.sql` — branch behavior, idempotency, defensive cases.
- **Create:** `supabase/tests/seo_onboarding_reconciler.sql` — helper/reconciler selection + exclusions.
- **Create:** `supabase/tests/paid_in_full_onboarding_integration.sql` — full trigger path (deal stage → onboarding).

## Prerequisites (once)

- [ ] **Start the local stack** (pgTAP runs against it):

Run: `supabase start`
Expected: containers up; prints API/DB URLs. (If already running, it's a no-op.)

- [ ] **Confirm a clean baseline** — all existing tests pass before changes:

Run: `supabase test db`
Expected: all existing `supabase/tests/*.sql` report `ok` (no failures). Note the count so you can spot regressions.

> Note: `supabase test db` applies migrations + `seed.sql` to a test database, runs every `supabase/tests/*.sql`, and rolls back. There is no per-file flag — run the whole suite and read the new file's lines. If the local stack cannot run in this environment, apply the migration to a branch/preview DB via the Supabase MCP and run each test file's SQL through `execute_sql`; do **not** apply to production until Task 8.

---

## Task 1: Marker column + conservative backfill

**Files:**
- Create: `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`
- Create: `supabase/tests/release_deal_jobs_onboarding.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/release_deal_jobs_onboarding.sql`:

```sql
-- supabase/tests/release_deal_jobs_onboarding.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(1);

select has_column('public','jobs','onboarded_at','jobs.onboarded_at exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db`
Expected: `release_deal_jobs_onboarding.sql` FAILS — `column "onboarded_at" ... does not exist` / `not ok ... jobs.onboarded_at exists`.

- [ ] **Step 3: Create the migration with the column + backfill**

Create `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`:

```sql
-- 20260629100000_recurring_seo_first_paid_onboarding.sql
-- Spec: docs/superpowers/specs/2026-06-29-recurring-seo-first-paid-onboarding-design.md
-- First Fully-Paid -> New project (+onboarding email) for recurring local_seo/web_seo;
-- later Fully-Paid -> Renewal. Once-only marker + email safety net (detect + self-heal).

-- 1. Marker column
alter table public.jobs add column if not exists onboarded_at timestamptz;
comment on column public.jobs.onboarded_at is
  'Set the first time a recurring local_seo/web_seo job is onboarded (placed in New project at first Fully-Paid). Null = never onboarded. Drives first-time vs renewal routing in release_deal_jobs().';

-- 2. Conservative backfill (+ backup): every existing SEO job is "already onboarded"
--    so no current client gets a surprise onboarding email on the next payment.
create table if not exists public.jobs_onboarded_backfill_backup_20260629 as
  select id as job_id, onboarded_at as prev_onboarded_at, now() as backed_up_at
    from public.jobs
   where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;

update public.jobs
   set onboarded_at = coalesce(started_at, created_at, now())
 where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;
```

- [ ] **Step 4: Extend the test to cover the backup table, then run to verify it passes**

Edit `supabase/tests/release_deal_jobs_onboarding.sql` — change `plan(1)` to `plan(2)` and add before `finish()`:

```sql
select has_table('public','jobs_onboarded_backfill_backup_20260629','backfill backup table exists');
```

Run: `supabase test db`
Expected: `release_deal_jobs_onboarding.sql` reports `ok 1` / `ok 2`, no failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql supabase/tests/release_deal_jobs_onboarding.sql
git commit -m "feat(jobs): add onboarded_at marker + conservative backfill"
```

---

## Task 2: Rewrite `release_deal_jobs` (first-paid → New project, later → Renewal)

**Files:**
- Modify: `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql` (append section 3)
- Modify: `supabase/tests/release_deal_jobs_onboarding.sql`

- [ ] **Step 1: Write the failing tests**

Replace the body of `supabase/tests/release_deal_jobs_onboarding.sql` with (keeps the two passing checks, adds branch coverage):

```sql
-- supabase/tests/release_deal_jobs_onboarding.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(13);

-- Shared target deal/client + automation toggles on + client has an email.
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  perform set_config('t.client', v_client::text, true);
  update public.clients set email = 'onboard-test@example.gr' where id = v_client;
  update public.email_automation_settings set enabled = true
    where key in ('dept_technical','localseo_gbp','webseo_gsc');
end $$;

select has_column('public','jobs','onboarded_at','jobs.onboarded_at exists');
select has_table('public','jobs_onboarded_backfill_backup_20260629','backfill backup table exists');

-- helper: reset SEO jobs + email rows for the target deal, then insert one job.
-- 1a. off-board recurring local_seo -> New project + marker + email
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
        v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type in ('local_seo','web_seo');
  delete from public.email_outbox where dedupe_key in ('localseo_gbp:'||v_deal,'webseo_gsc:'||v_deal);
  delete from public.email_log    where dedupe_key in ('localseo_gbp:'||v_deal,'webseo_gsc:'||v_deal);
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;

select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', '1a: off-board local_seo -> New project');
select isnt((select onboarded_at from public.jobs
             where deal_id=current_setting('t.deal')::uuid and service_type='local_seo'),
            null, '1a: onboarded_at set');
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, '1a: GBP onboarding email queued');

-- 1c. already-onboarded local_seo, second paid -> Renewal
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  perform public.release_deal_jobs(v_deal);  -- second call; job now has onboarded_at
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'renewal', '1c: second paid -> Renewal');
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, '1c: no duplicate email on second paid');

-- 1b. not-onboarded but already on a board (new_project) -> mark + stay (no bounce)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid; v_np uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  select id into v_np from public.pipeline_stages where board='local_seo' and code='new_project' and not archived limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', v_np, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', '1b: stays in New project (no bounce)');
select isnt((select onboarded_at from public.jobs
             where deal_id=current_setting('t.deal')::uuid and service_type='local_seo'),
            null, '1b: marked onboarded');

-- 2. one-time local_seo -> Renewal (unchanged), not New project
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid; v_np uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  select id into v_np from public.pipeline_stages where board='local_seo' and code='new_project' and not archived limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'one_time', 240, 24,
            'active', v_np, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'renewal', '2: one-time local_seo -> Renewal (unchanged)');

-- null billing_type treated as recurring -> onboards
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', null, 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', 'null billing_type treated as recurring -> New project');

-- idempotency: re-running 1a scenario twice queues exactly one email and stays put
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select count(*)::int from public.email_outbox where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, 'idempotency: one email after two calls');

-- web_seo analog of 1a (GSC)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='web_seo';
  delete from public.email_outbox where dedupe_key='webseo_gsc:'||v_deal;
  delete from public.email_log    where dedupe_key='webseo_gsc:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 300, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='web_seo'),
          'new_project', 'web_seo: off-board -> New project');
select is((select count(*)::int from public.email_outbox where dedupe_key='webseo_gsc:'||current_setting('t.deal')),
          1, 'web_seo: GSC onboarding email queued');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `supabase test db`
Expected: `release_deal_jobs_onboarding.sql` FAILS the new branch assertions (the *old* `release_deal_jobs` only does renewal/unblock, so e.g. `1a: off-board local_seo -> New project` is `not ok`).

- [ ] **Step 3: Append the rewritten function to the migration**

Append section 3 to `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`:

```sql
-- 3. release_deal_jobs: first-time onboarding (New project + email) vs renewal.
--    RECURRING == billing_type is distinct from 'one_time' (defensive: null/odd -> recurring).
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fail loud (never silent): SEO boards must have their New project stage.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- (1a) recurring SEO, never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email. Fixes the direct-drag gap.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) recurring SEO, never onboarded, already on a board -> mark + unblock; leave in place.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is not null;

  -- (1c) recurring SEO, already onboarded -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (2) UNCHANGED renewal-move: one-time SEO + all ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and ( (j.service_type in ('web_seo','local_seo') and j.billing_type='one_time')
           or j.service_type in ('ads','social_media') )
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;
```

- [ ] **Step 4: Run to verify all assertions pass**

Run: `supabase test db`
Expected: `release_deal_jobs_onboarding.sql` reports `ok 1`..`ok 13`, no failures. No regressions elsewhere.

> Coverage note: the fail-loud "missing `new_project` stage" guard (the `raise warning` + the `exists(...)` clause on branch 1a) is defensive-by-construction and intentionally **not** unit-tested — doing so would require archiving the shared `new_project` stage row mid-suite, which would destabilize other tests. Both SEO boards are verified to have `new_project` (live check, 2026-06-29). The guard's contract: if it were ever missing, the job is left off-board (stage stays null) rather than nulled/crashed, and a warning is logged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql supabase/tests/release_deal_jobs_onboarding.sql
git commit -m "feat(jobs): release_deal_jobs onboards recurring SEO on first paid, renews after"
```

---

## Task 3: Safety-net helper + self-heal reconciler + cron

**Files:**
- Modify: `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql` (append sections 4 & 5)
- Create: `supabase/tests/seo_onboarding_reconciler.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/seo_onboarding_reconciler.sql`:

```sql
-- supabase/tests/seo_onboarding_reconciler.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(6);

select has_function('public','seo_onboarding_pending_jobs','helper exists');
select has_function('public','reconcile_seo_onboarding_emails','reconciler exists');

-- Setup: an already-onboarded local_seo job >1h old, toggles on, client email, no email rows.
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  update public.clients set email='reconcile-test@example.gr' where id=v_client;
  update public.email_automation_settings set enabled=true where key in ('dept_technical','localseo_gbp');
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24, 'active',
            (select id from public.pipeline_stages where board='local_seo' and code='renewal' and not archived limit 1),
            now() - interval '2 hours', false, now(), (select code from public.deals where id=v_deal));
end $$;

select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          1, 'pending: unsent onboarding job is detected');

-- Reconciler re-queues exactly one email with the right template + dedupe key.
do $$ begin perform public.reconcile_seo_onboarding_emails(); end $$;
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')
             and template_key='localseo_gbp_access'),
          1, 'reconciler re-queues the missing GBP email');

-- A delivered email_log row excludes the job from the pending set.
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.email_log (to_email, template_key, status, dedupe_key, created_at)
    values ('reconcile-test@example.gr','localseo_gbp_access','delivered','localseo_gbp:'||v_deal, now());
end $$;
select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          0, 'pending: excludes jobs whose email already delivered');

-- toggle off -> excluded (deliberate admin choice; surfaced by health, not re-queued)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  delete from public.email_log where dedupe_key='localseo_gbp:'||v_deal;
  update public.email_automation_settings set enabled=false where key='dept_technical';
end $$;
select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          0, 'pending: excludes jobs when the dept toggle is off');

select * from finish();
rollback;
```

> If `public.email_log` requires more NOT NULL columns than `(to_email, template_key, status, dedupe_key, created_at)`, add them to the INSERT with sensible values — inspect with `\d public.email_log`. The dedupe key is the only column the helper joins on.

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db`
Expected: `seo_onboarding_reconciler.sql` FAILS — `function seo_onboarding_pending_jobs() does not exist`.

- [ ] **Step 3: Append helper + reconciler + cron to the migration**

Append sections 4 & 5 to `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`:

```sql
-- 4. Shared helper: recurring SEO jobs whose onboarding email has NOT landed.
--    Used by both email_pipeline_health (count) and the reconciler (re-queue).
--    SECURITY DEFINER, not granted to public (exposes client emails); the two
--    definer callers reach it as owner.
create or replace function public.seo_onboarding_pending_jobs()
returns table (job_id uuid, deal_id uuid, service_type text, to_email text,
               setting_key text, template_key text, dedupe_key text, code text)
language sql stable security definer set search_path = public as $$
  select j.id, j.deal_id, j.service_type, c.email,
         m.setting_key, m.template_key, (m.setting_key || ':' || j.deal_id::text), j.code
    from public.jobs j
    join public.clients c on c.id = j.client_id
    join (values ('local_seo','localseo_gbp','localseo_gbp_access'),
                 ('web_seo','webseo_gsc','webseo_gsc_access')) as m(service_type, setting_key, template_key)
      on m.service_type = j.service_type
   where not j.archived
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and j.onboarded_at < now() - interval '1 hour'
     and coalesce(trim(c.email),'') <> ''
     and public.email_automation_enabled(m.setting_key)
     and not exists (select 1 from public.email_log el
                      where el.dedupe_key = m.setting_key || ':' || j.deal_id::text
                        and el.status in ('sent','delivered','bounced','complained'))
     and not exists (select 1 from public.email_outbox eo
                      where eo.dedupe_key = m.setting_key || ':' || j.deal_id::text
                        and eo.status in ('pending','sending'));
$$;
revoke all on function public.seo_onboarding_pending_jobs() from public;

-- 5. Self-heal reconciler + 15-min cron. Idempotent: dedupe key + email_log unique
--    index prevent duplicates; pending rows are skipped (the drain owns those).
create or replace function public.reconcile_seo_onboarding_emails()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.seo_onboarding_pending_jobs() loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
      values ('accounting', r.to_email, r.template_key,
              jsonb_build_object('code', coalesce(r.code,'')), r.dedupe_key);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_seo_onboarding_emails() from public;

do $$ begin perform cron.unschedule('reconcile_seo_onboarding_emails'); exception when others then null; end $$;
select cron.schedule('reconcile_seo_onboarding_emails', '*/15 * * * *',
  $$ select public.reconcile_seo_onboarding_emails(); $$);
```

- [ ] **Step 4: Run to verify it passes**

Run: `supabase test db`
Expected: `seo_onboarding_reconciler.sql` reports `ok 1`..`ok 5`, no failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql supabase/tests/seo_onboarding_reconciler.sql
git commit -m "feat(email): self-heal reconciler + cron for missed SEO onboarding emails"
```

---

## Task 4: Surface the count in the admin email-health banner

**Files:**
- Modify: `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql` (append section 6)
- Modify: `supabase/tests/seo_onboarding_reconciler.sql`

- [ ] **Step 1: Write the failing test**

Edit `supabase/tests/seo_onboarding_reconciler.sql` — change `plan(6)` to `plan(7)` and add before `finish()`:

```sql
-- email_pipeline_health returns the new key (structure check; the count logic is
-- fully exercised via seo_onboarding_pending_jobs above — health just counts it).
select ok(
  public.email_pipeline_health() ? 'onboarding_unsent_count'
  or public.email_pipeline_health()->>'status' = 'ok',
  'email_pipeline_health exposes onboarding_unsent_count (or is non-admin ok)');
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db`
Expected: FAILS — current `email_pipeline_health()` has no `onboarding_unsent_count` key (and as a superuser/admin in the test it returns the full object without that key).

- [ ] **Step 3: Append the extended health function to the migration**

Append section 6 to `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql`:

```sql
-- 6. email_pipeline_health(): also report onboarding emails that never landed.
create or replace function public.email_pipeline_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  last_run_age int; stuck int; maxed int; failed_recent int; oldest_pending int;
  onboarding_unsent int; v_status text; v_reason text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select extract(epoch from now() - last_run_at)::int into last_run_age
    from public.email_drain_heartbeat where id;
  select count(*) into stuck from public.email_outbox
    where status='pending' and created_at < now() - interval '15 minutes';
  select count(*) into maxed from public.email_outbox
    where status='pending' and attempts >= 5;
  select count(*) into failed_recent from public.email_log
    where status='failed' and created_at > now() - interval '1 hour';
  select extract(epoch from now() - min(created_at))::int into oldest_pending
    from public.email_outbox where status='pending';
  select count(*) into onboarding_unsent from public.seo_onboarding_pending_jobs();

  if last_run_age is null or last_run_age > 600 then
    v_status := 'down';
  elsif coalesce(stuck,0) > 0 or coalesce(maxed,0) > 0 or coalesce(failed_recent,0) > 0
        or coalesce(onboarding_unsent,0) > 0 then
    v_status := 'degraded';
  else
    v_status := 'ok';
  end if;

  v_reason := case
    when last_run_age is null              then 'drain has never run'
    when last_run_age > 600                then 'drain last ran ' || last_run_age || 's ago'
    when coalesce(stuck,0) > 0             then stuck || ' email(s) stuck pending'
    when coalesce(maxed,0) > 0             then maxed || ' email(s) hit max retries'
    when coalesce(failed_recent,0) > 0     then failed_recent || ' send failure(s) in the last hour'
    when coalesce(onboarding_unsent,0) > 0 then onboarding_unsent || ' onboarding email(s) not sent'
    else 'ok' end;

  return jsonb_build_object(
    'status', v_status, 'reason', v_reason,
    'last_run_age_seconds', last_run_age,
    'stuck_count', coalesce(stuck,0),
    'failed_count', coalesce(failed_recent,0),
    'onboarding_unsent_count', coalesce(onboarding_unsent,0),
    'oldest_pending_age_seconds', oldest_pending);
end $$;
revoke all on function public.email_pipeline_health() from public;
grant execute on function public.email_pipeline_health() to authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `supabase test db`
Expected: `seo_onboarding_reconciler.sql` reports `ok 1`..`ok 6`, no failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql supabase/tests/seo_onboarding_reconciler.sql
git commit -m "feat(email): email_pipeline_health surfaces unsent onboarding email count"
```

---

## Task 5: Integration test — the real Paid-In-Full trigger path

Proves the wiring: setting a deal's accounting stage to `paid_in_full` fires
`deals_hold_jobs_on_stage_change` → `release_deal_jobs`, onboarding the SEO job.

**Files:**
- Create: `supabase/tests/paid_in_full_onboarding_integration.sql`

- [ ] **Step 1: Write the test**

Create `supabase/tests/paid_in_full_onboarding_integration.sql`:

```sql
-- supabase/tests/paid_in_full_onboarding_integration.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(2);

do $$
declare v_deal uuid; v_client uuid; v_paid uuid; v_other uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  update public.clients set email='integration-test@example.gr' where id=v_client;
  update public.email_automation_settings set enabled=true where key in ('dept_technical','localseo_gbp');

  select id into v_paid from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full' limit 1;
  select id into v_other from public.pipeline_stages
    where board='accounting_onboarding' and code='invoice_issued' limit 1;

  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));

  -- Move OFF paid first (so the next move is a real transition INTO paid_in_full).
  update public.deals set accounting_stage_id = v_other where id = v_deal;
  update public.deals set accounting_stage_id = v_paid  where id = v_deal;   -- fires the trigger
end $$;

select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', 'first paid_in_full transition onboards the SEO job to New project');
select is((select count(*)::int from public.email_outbox where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, 'first paid_in_full transition queues the onboarding email');

select * from finish();
rollback;
```

> If `invoice_issued` is not a stage code on `accounting_onboarding`, substitute any non-`paid_in_full` code from `select code from pipeline_stages where board='accounting_onboarding'` (e.g. `documents_verified`).

- [ ] **Step 2: Run to verify it passes**

Run: `supabase test db`
Expected: `paid_in_full_onboarding_integration.sql` reports `ok 1` / `ok 2`. (No code change — this validates the wiring against the function from Task 2.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/paid_in_full_onboarding_integration.sql
git commit -m "test(jobs): integration test for paid_in_full -> SEO onboarding"
```

---

## Task 6: Full suite green + advisors

**Files:** none (verification only)

- [ ] **Step 1: Run the full pgTAP suite**

Run: `supabase test db`
Expected: every file reports `ok`, zero `not ok`, zero failures. Confirm the pre-change baseline count from Prerequisites plus the new files.

- [ ] **Step 2: Run database advisors on the migration**

Run: `supabase db advisors` (CLI ≥2.81.3; this repo is on 2.90.0) — or MCP `get_advisors`
Expected: no new security/performance errors attributable to this migration. The two new functions are `security definer` with `set search_path = public` and revoked from public — confirm no "function search_path mutable" warnings for them.

- [ ] **Step 3: Commit (if any advisor fixes were needed)**

```bash
git add -A && git commit -m "chore(db): advisor fixes for SEO onboarding migration"
```

(Skip if nothing changed.)

---

## Task 7: Regenerate DB types (keep `jobs` Row in sync)

**Files:**
- Modify: `src/types/supabase.ts` (generated DB types)

- [ ] **Step 1: Regenerate types**

Run: `npm run types:gen` (`supabase gen types typescript --project-id xujlrclyzxrvxszepquy --schema public > src/types/supabase.ts`)
Expected: the `jobs` Row/Insert/Update types gain `onboarded_at: string | null`. If CLI auth blocks generation (known in this repo), hand-add `onboarded_at: string | null` to `jobs` Row/Insert/Update in `src/types/supabase.ts` as a temporary stub and note it.

- [ ] **Step 2: Verify the frontend still builds**

Run: `npm run build`
Expected: `tsc -b` + `vite build` succeed, eslint `--max-warnings=0` clean. (No frontend logic changed; this only confirms the type addition compiles.)

- [ ] **Step 3: Commit**

```bash
git add src && git commit -m "chore(types): add jobs.onboarded_at to generated DB types"
```

---

## Task 8: Deploy to production (GATED — get explicit user go-ahead first)

> Per project policy, do not mutate production until the user explicitly approves this task. DDL on prod is applied via the Supabase MCP (Bash/API DDL is safety-blocked in this repo).

- [ ] **Step 1: Apply the migration to prod**

Apply `supabase/migrations/20260629100000_recurring_seo_first_paid_onboarding.sql` via the Supabase MCP `apply_migration` (project `xujlrclyzxrvxszepquy`). Verify it returns success.

- [ ] **Step 2: Verify the backfill counts**

Run (MCP `execute_sql`):
```sql
select count(*) filter (where onboarded_at is not null) as marked,
       count(*) filter (where onboarded_at is null)     as unmarked
  from public.jobs where service_type in ('web_seo','local_seo') and not archived;
```
Expected: `unmarked = 0` (every existing SEO job marked). Record the numbers.

- [ ] **Step 2b: Verify the cron is scheduled**

Run (MCP `execute_sql`): `select jobname, schedule, active from cron.job where jobname='reconcile_seo_onboarding_emails';`
Expected: one active row, schedule `*/15 * * * *`.

- [ ] **Step 3: Live smoke (Playwright, admin login)**

On `https://www.itdevcrm.com`, with a test deal whose SEO job is off-board, move the deal to **Paid In Full** and confirm: the SEO job appears in **New project**, and the GBP/GSC access email is queued/sent (card ✉ flips to "Access requested …"). Clean up the smoke deal afterward.

- [ ] **Step 4: Confirm no regression in the email-health banner**

As admin, confirm the banner reflects `email_pipeline_health()` (no spurious "onboarding email(s) not sent" beyond known cases).

---

## Task 9: Record the outcome in memory

- [ ] **Step 1:** Add a `project` memory file summarizing: first-paid → New project (+email) / later-paid → Renewal for recurring SEO; `onboarded_at` marker; `release_deal_jobs` is the single Paid-In-Full handler; `reconcile_seo_onboarding_emails` cron + `email_pipeline_health.onboarding_unsent_count` safety net; conservative backfill (backup `jobs_onboarded_backfill_backup_20260629`). Add a one-line pointer in `MEMORY.md`. (Per the no-secrets rule, reference env/keys by name only.)

---

## Notes / Rollback

Rollback (from the spec's Changes/Revert):
- `select cron.unschedule('reconcile_seo_onboarding_emails');`
- `drop function if exists public.reconcile_seo_onboarding_emails();`
- `drop function if exists public.seo_onboarding_pending_jobs();`
- restore `public.release_deal_jobs` from `20260628040000_release_deal_jobs_partial_payment.sql`
- restore `public.email_pipeline_health` from `20260615000003_email_health.sql`
- optional: `alter table public.jobs drop column onboarded_at;` (backup table `jobs_onboarded_backfill_backup_20260629` retains prior values)
