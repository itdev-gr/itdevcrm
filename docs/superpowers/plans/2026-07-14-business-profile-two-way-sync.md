# Business Profile Two-Way Sync (deal ⇄ local_seo job) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Business Profile Name + URL genuinely mirror between the deal page (accounting/sales edit `deals.business_profile_name/url`) and the local SEO job Info tab (`jobs.details.business_profile` / `.profile_url`), then reconcile the existing prod drift (job side wins conflicts).

**Architecture:** DB-trigger-only change; zero frontend edits (both UIs keep reading/writing their own copy — the DB keeps the copies equal). Three triggers: deal→job name (existing fn, guard relaxed), deal→job URL (new, was missing entirely), job→deal reverse (new). Overwrites happen only when the deal has EXACTLY ONE active local_seo job; with 2+ active jobs (multi-business deals — e.g. deal `72ec7bb3` has a mini-market and a café as two local_seo jobs) auto-overwrite is ambiguous, so deal→job stays fill-empty-only and job→deal is skipped. A one-off backfill reconciles existing rows with the same rules.

**Tech Stack:** Supabase Postgres (prod project `xujlrclyzxrvxszepquy` — "CRM"), plpgsql triggers, MCP `apply_migration`/`execute_sql`.

## Global Constraints

- Prod DB is live. Every mutation step: backup first, verify via SELECT after, rollback SQL documented. (User rule: track changes for revert.)
- Verification of trigger behavior uses the raise-exception DO-block technique (test writes roll back automatically).
- Do NOT run the vitest suite — it executes against PROD (user memory).
- No frontend changes; do not touch `src/`.
- Commit style: `fix(...)`/`feat(...)` one-liners, push directly to `main` (no PRs). `git pull --rebase` before push — the owner commits in parallel (a `20260714150000` migration landed today; ours is numbered `20260714170000`).
- Do NOT `git add` the owner's untracked files (`DELETE_E2E_TEST_CLIENTS.sql`, `src/lib/clientIntake.test.ts`).
- New trigger functions are `security definer set search_path = public`, return `trigger` (not RPC-exposable — no extra grant handling needed). Do NOT add standalone callable helper functions (grant-boundary rule).
- Sync propagates NON-EMPTY values only: clearing a field on one side never clears the other.
- Values are stored trimmed. Job JSONB keys are exactly `business_profile` and `profile_url` (NOT `business_profile_name`).
- "Active local_seo job" throughout = `service_type='local_seo' and not archived and status='active'`.

## Background (verified live, 2026-07-14)

- 275 non-archived local_seo jobs (232 active / 43 completed). Drift: 14 name conflicts, 11 URL conflicts, 136 names existing only on the job, 29 job URLs blank while the deal has one, 10 deal URLs blank while the job has one.
- Current prod triggers (read via `pg_get_functiondef`): `jobs_seed_local_business_profile` + `jobs_seed_local_profile_url` (BEFORE INSERT seeds), `deals_sync_business_profile_name` (AFTER UPDATE, fills ONLY empty job values — see `supabase/migrations/20260703120000_business_profile_name.sql:115-134`). No URL late-sync, no job→deal sync — that's the whole bug.
- UI writers (unchanged by this plan): deal page `src/features/deals/DealNotesArea.tsx:28-42` → deal columns; job Info tab `src/features/jobs/JobInfoPanel.tsx:43-44` → `jobs.details` (NOTE: it saves details as a full-object replace; the reverse trigger therefore compares OLD vs NEW key values, never assumes merge semantics).
- Exactly one deal has 2+ active local_seo jobs with DISAGREEING names: `72ec7bb3-7636-40d7-91e2-dd8420d715ad` (two real businesses). Its name conflict must survive the backfill untouched.

## Recursion-safety argument (for the implementer)

Every UPDATE in the triggers carries an `is distinct from` guard in its WHERE clause, so a synced value never produces a second write: deal edit → job updated → reverse trigger fires → deal value already equal → 0 rows → stop (and vice versa). No depth counters needed.

## Non-goals

- `ai_seo` parent-card titles (they read `details.business_profile` but are never auto-populated) — separate decision.
- Propagating clears/empties.
- The `clients.website` → web_seo pipeline (separate feature, untouched).

---

### Task 1: Migration — two-way sync triggers

**Files:**
- Create: `supabase/migrations/20260714170000_business_profile_two_way_sync.sql`

**Interfaces:**
- Consumes: existing columns `deals.business_profile_name/url`, `jobs.details` JSONB keys `business_profile`/`profile_url`; existing trigger `deals_sync_business_profile_name` (function body replaced, trigger event unchanged).
- Produces: functions `deals_sync_business_profile_name` (replaced), `deals_sync_business_profile_url` (new), `jobs_sync_business_profile_to_deal` (new) + their triggers. Task 2 relies on these being live so backfill UPDATEs self-guard.

- [ ] **Step 1: Red — prove current behavior is broken (raise-exception DO block, rolls back)**

Run via MCP `execute_sql` on project `xujlrclyzxrvxszepquy`:

```sql
do $$
declare d_id uuid; j_id uuid; v_job text; v_deal text;
begin
  select deal_id into d_id from public.jobs
   where service_type='local_seo' and not archived and status='active' and deal_id is not null
   group by deal_id having count(*) = 1 limit 1;
  select id into j_id from public.jobs
   where deal_id = d_id and service_type='local_seo' and not archived and status='active';

  update public.deals set business_profile_name = 'SYNCTEST-A' where id = d_id;
  select details->>'business_profile' into v_job from public.jobs where id = j_id;

  update public.jobs set details = coalesce(details,'{}'::jsonb) || '{"business_profile":"SYNCTEST-B"}'::jsonb
   where id = j_id;
  select business_profile_name into v_deal from public.deals where id = d_id;

  raise exception 'VERIFY job_after_deal_edit=% deal_after_job_edit=%', v_job, v_deal;
end $$;
```

Expected NOW (bug): error message shows `job_after_deal_edit=<old job value, NOT SYNCTEST-A>` and `deal_after_job_edit=SYNCTEST-A` (deal keeps its own test value, unaffected by the job edit). The exception rolls back both test writes — nothing persists.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260714170000_business_profile_two_way_sync.sql` with exactly:

```sql
-- Business Profile two-way sync: deal <-> local_seo job (name + url).
-- Before: deal-side edits after job creation were dropped (name: fill-only
-- guard; url: no late sync existed) and job Info-tab edits never reached the
-- deal — accounting and the local team each saw only their own copy.
-- New rule: when a deal has EXACTLY ONE active local_seo job (not archived,
-- status='active'), deal and job mirror each other: a changed NON-EMPTY value
-- overwrites the other side. With 2+ active local_seo jobs (multi-business
-- deals) overwrite is ambiguous: deal->job falls back to fill-empty-only and
-- job->deal is skipped. Clearing a value never propagates.
-- Every synced UPDATE carries an is-distinct guard, so echoes terminate.
-- Plan: docs/superpowers/plans/2026-07-14-business-profile-two-way-sync.md
-- Forward-only. Rollback at bottom.

-- 1) deal -> job: NAME. Replaces the 2026-07-03 fill-only body.
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text; v_active int;
begin
  v_name := nullif(trim(coalesce(new.business_profile_name,'')), '');
  if v_name is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    select count(*) into v_active from public.jobs
     where deal_id = new.id and service_type = 'local_seo'
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', v_name)
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is distinct from v_name
       and (v_active = 1
            or nullif(trim(coalesce(j.details->>'business_profile','')), '') is null);
  end if;
  return new;
end $function$;

drop trigger if exists deals_sync_business_profile_name on public.deals;
create trigger deals_sync_business_profile_name
  after update of business_profile_name on public.deals
  for each row execute function public.deals_sync_business_profile_name();

-- 2) deal -> job: URL. New — no late-sync existed for the url at all.
create or replace function public.deals_sync_business_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text; v_active int;
begin
  v_url := nullif(trim(coalesce(new.business_profile_url,'')), '');
  if v_url is not null
     and new.business_profile_url is distinct from old.business_profile_url then
    select count(*) into v_active from public.jobs
     where deal_id = new.id and service_type = 'local_seo'
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('profile_url', v_url)
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'profile_url','')), '') is distinct from v_url
       and (v_active = 1
            or nullif(trim(coalesce(j.details->>'profile_url','')), '') is null);
  end if;
  return new;
end $function$;

drop trigger if exists deals_sync_business_profile_url on public.deals;
create trigger deals_sync_business_profile_url
  after update of business_profile_url on public.deals
  for each row execute function public.deals_sync_business_profile_url();

-- 3) job -> deal reverse sync (new). Fires on INSERT too: a job inserted with
-- pre-filled values (e.g. recurring spawn copying details) backfills a blank
-- deal. Only when this job is the deal's sole active local_seo job.
create or replace function public.jobs_sync_business_profile_to_deal()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_name text; v_url text; v_old_name text; v_old_url text; v_active int;
begin
  if new.service_type <> 'local_seo' or new.deal_id is null
     or new.archived or new.status <> 'active' then
    return new;
  end if;
  v_name := nullif(trim(coalesce(new.details->>'business_profile','')), '');
  v_url  := nullif(trim(coalesce(new.details->>'profile_url','')), '');
  if tg_op = 'UPDATE' then
    v_old_name := nullif(trim(coalesce(old.details->>'business_profile','')), '');
    v_old_url  := nullif(trim(coalesce(old.details->>'profile_url','')), '');
  end if;
  if (v_name is not null and v_name is distinct from v_old_name)
     or (v_url is not null and v_url is distinct from v_old_url) then
    select count(*) into v_active from public.jobs
     where deal_id = new.deal_id and service_type = 'local_seo'
       and not archived and status = 'active';
    if v_active = 1 then
      update public.deals d
         set business_profile_name = case
               when v_name is not null and v_name is distinct from v_old_name
               then v_name else d.business_profile_name end,
             business_profile_url = case
               when v_url is not null and v_url is distinct from v_old_url
               then v_url else d.business_profile_url end
       where d.id = new.deal_id
         and (   (v_name is not null and v_name is distinct from v_old_name
                  and nullif(trim(coalesce(d.business_profile_name,'')),'') is distinct from v_name)
              or (v_url is not null and v_url is distinct from v_old_url
                  and nullif(trim(coalesce(d.business_profile_url,'')),'') is distinct from v_url));
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists jobs_sync_business_profile_to_deal on public.jobs;
create trigger jobs_sync_business_profile_to_deal
  after insert or update of details on public.jobs
  for each row execute function public.jobs_sync_business_profile_to_deal();

-- ROLLBACK (manual):
--   drop trigger if exists jobs_sync_business_profile_to_deal on public.jobs;
--   drop function if exists public.jobs_sync_business_profile_to_deal();
--   drop trigger if exists deals_sync_business_profile_url on public.deals;
--   drop function if exists public.deals_sync_business_profile_url();
--   -- then restore the fill-only name-sync body + trigger from
--   -- supabase/migrations/20260703120000_business_profile_name.sql:115-134.
```

- [ ] **Step 3: Apply to prod**

Use MCP `apply_migration` (project `xujlrclyzxrvxszepquy`, name `business_profile_two_way_sync`) with the file's SQL. Then confirm wiring:

```sql
select t.tgname, c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and t.tgname in
 ('deals_sync_business_profile_name','deals_sync_business_profile_url','jobs_sync_business_profile_to_deal')
order by 1;
```

Expected: 3 rows (`deals`, `deals`, `jobs`).

- [ ] **Step 4: Green — re-run the Step 1 DO block unchanged**

Expected error message now: `VERIFY job_after_deal_edit=SYNCTEST-A deal_after_job_edit=SYNCTEST-B`. (Still rolls back — no data persists.)

- [ ] **Step 5: Verify the multi-business guard (no clobber)**

```sql
do $$
declare v1 text; v2 text;
begin
  update public.deals set business_profile_name = 'SYNCTEST-MULTI'
   where id = '72ec7bb3-7636-40d7-91e2-dd8420d715ad';
  select string_agg(coalesce(details->>'business_profile','∅'), ' | ' order by id) into v1
    from public.jobs
   where deal_id = '72ec7bb3-7636-40d7-91e2-dd8420d715ad'
     and service_type='local_seo' and not archived;
  update public.jobs set details = coalesce(details,'{}'::jsonb) || '{"business_profile":"SYNCTEST-REV"}'::jsonb
   where id = '29513d12-1b16-443a-836f-095fbda76e6c';
  select business_profile_name into v2 from public.deals
   where id = '72ec7bb3-7636-40d7-91e2-dd8420d715ad';
  raise exception 'VERIFY jobs_unchanged=[%] deal_after_job_edit=%', v1, v2;
end $$;
```

Expected: `jobs_unchanged=` still shows the two ORIGINAL job names (`Βωλίτης | Mini Market Πάπιγκο Ιωαννίνων Βωλίτης` — both non-empty, so the fill-only fallback touches neither) and `deal_after_job_edit=SYNCTEST-MULTI` (reverse sync skipped: 2 active jobs). Rolls back.

- [ ] **Step 6: Commit and push**

```bash
git add supabase/migrations/20260714170000_business_profile_two_way_sync.sql docs/superpowers/plans/2026-07-14-business-profile-two-way-sync.md
git commit -m "fix(business-profile): two-way deal<->local_seo job sync for name+url

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --rebase && git push
```

---

### Task 2: Backfill — reconcile existing drift (job wins)

**Files:**
- Create: `docs/data-fixes/2026-07-14-business-profile-reconcile.sql` (record of what was run; follow the existing data-fix doc pattern from commit `ce8f56b` — check `docs/` for where the payment-line resync landed and match it)

**Interfaces:**
- Consumes: Task 1 triggers must be LIVE before running (backfill UPDATEs then self-guard and cascade correctly).
- Produces: backup table `public.business_profile_backfill_backup_20260714` (KEEP — do not drop).

- [ ] **Step 1: Backup (prod, via `execute_sql`)**

```sql
create table public.business_profile_backfill_backup_20260714 as
select j.id as job_id, j.deal_id, j.status,
       j.details->>'business_profile' as job_name_before,
       j.details->>'profile_url'      as job_url_before,
       d.business_profile_name        as deal_name_before,
       d.business_profile_url         as deal_url_before
from public.jobs j join public.deals d on d.id = j.deal_id
where j.service_type = 'local_seo' and not j.archived;
```

Verify: `select count(*) from public.business_profile_backfill_backup_20260714;` → expected 275 (±owner's same-day changes).

- [ ] **Step 2: Job → deal, job wins (skips fields where 2+ active jobs disagree)**

```sql
with cand as (
  select j.deal_id,
         nullif(trim(coalesce(j.details->>'business_profile','')),'') as jname,
         nullif(trim(coalesce(j.details->>'profile_url','')),'')      as jurl,
         row_number() over (partition by j.deal_id
           order by (j.status = 'active') desc, j.updated_at desc) as rn
  from public.jobs j
  where j.service_type='local_seo' and not j.archived and j.deal_id is not null
),
amb as (
  select deal_id,
         count(distinct nullif(trim(coalesce(details->>'business_profile','')),''))
           filter (where nullif(trim(coalesce(details->>'business_profile','')),'') is not null) > 1 as name_amb,
         count(distinct nullif(trim(coalesce(details->>'profile_url','')),''))
           filter (where nullif(trim(coalesce(details->>'profile_url','')),'') is not null) > 1 as url_amb
  from public.jobs
  where service_type='local_seo' and not archived and status='active'
  group by deal_id
),
w as (
  select c.deal_id, c.jname, c.jurl,
         coalesce(a.name_amb,false) as name_amb, coalesce(a.url_amb,false) as url_amb
  from cand c left join amb a using (deal_id)
  where c.rn = 1
)
update public.deals d
   set business_profile_name = case when w.jname is not null and not w.name_amb
                                    then w.jname else d.business_profile_name end,
       business_profile_url  = case when w.jurl is not null and not w.url_amb
                                    then w.jurl else d.business_profile_url end
  from w
 where d.id = w.deal_id
   and (   (w.jname is not null and not w.name_amb
            and nullif(trim(coalesce(d.business_profile_name,'')),'') is distinct from w.jname)
        or (w.jurl is not null and not w.url_amb
            and nullif(trim(coalesce(d.business_profile_url,'')),'') is distinct from w.jurl));
```

Expected: roughly 150–160 deals updated (130 name fills + 13 name conflicts + 9/10 URL fills/conflicts on single-job deals, plus unambiguous multi-job deals; some overlap on the same deal). The fired deal-triggers cascade the values back onto active jobs where they were blank — that's intended.

- [ ] **Step 3: Deal → job blank fills (active jobs only)**

```sql
update public.jobs j
   set details = coalesce(j.details,'{}'::jsonb)
       || case when nullif(trim(coalesce(d.business_profile_name,'')),'') is not null
                and nullif(trim(coalesce(j.details->>'business_profile','')),'') is null
               then jsonb_build_object('business_profile', trim(d.business_profile_name))
               else '{}'::jsonb end
       || case when nullif(trim(coalesce(d.business_profile_url,'')),'') is not null
                and nullif(trim(coalesce(j.details->>'profile_url','')),'') is null
               then jsonb_build_object('profile_url', trim(d.business_profile_url))
               else '{}'::jsonb end
  from public.deals d
 where d.id = j.deal_id
   and j.service_type='local_seo' and not j.archived and j.status='active'
   and (   (nullif(trim(coalesce(d.business_profile_name,'')),'') is not null
            and nullif(trim(coalesce(j.details->>'business_profile','')),'') is null)
        or (nullif(trim(coalesce(d.business_profile_url,'')),'') is not null
            and nullif(trim(coalesce(j.details->>'profile_url','')),'') is null));
```

Expected: ~a few dozen rows at most (many of the original 29 URL blanks are already filled by Step 2's cascade).

- [ ] **Step 4: Verify convergence**

```sql
with pairs as (
  select j.status,
         nullif(trim(coalesce(j.details->>'business_profile','')),'') as job_name,
         nullif(trim(coalesce(j.details->>'profile_url','')),'')      as job_url,
         nullif(trim(coalesce(d.business_profile_name,'')),'')        as deal_name,
         nullif(trim(coalesce(d.business_profile_url,'')),'')         as deal_url,
         count(*) filter (where j.status='active') over (partition by j.deal_id) as active_sibs
  from public.jobs j join public.deals d on d.id = j.deal_id
  where j.service_type='local_seo' and not j.archived
)
select count(*) filter (where status='active' and active_sibs=1 and job_name is distinct from deal_name
                          and job_name is not null and deal_name is not null) as name_conflicts_left,
       count(*) filter (where status='active' and active_sibs=1 and job_url is distinct from deal_url
                          and job_url is not null and deal_url is not null)   as url_conflicts_left,
       count(*) filter (where status='active' and deal_name is not null and job_name is null) as name_blank_jobs,
       count(*) filter (where status='active' and deal_url  is not null and job_url  is null) as url_blank_jobs
from pairs;
```

Expected: **all four counts = 0.** Then list the intentionally-left divergences (multi-active ambiguous deals) for the final report:

```sql
select d.id as deal_id, d.title, d.business_profile_name,
       string_agg(coalesce(j.details->>'business_profile','∅'), ' | ') as job_names
from public.deals d join public.jobs j on j.deal_id = d.id
where j.service_type='local_seo' and not j.archived and j.status='active'
group by d.id, d.title, d.business_profile_name
having count(*) > 1
   and count(distinct nullif(trim(coalesce(j.details->>'business_profile','')),''))
         filter (where nullif(trim(coalesce(j.details->>'business_profile','')),'') is not null) > 1;
```

Expected: 1–2 deals (incl. `72ec7bb3` Papigo — two real businesses; correct to leave).

- [ ] **Step 5: Write the data-fix doc and commit**

`docs/data-fixes/2026-07-14-business-profile-reconcile.sql` (or the repo's actual data-fix location — match commit `ce8f56b`'s pattern) containing: the four SQL blocks above, observed row counts, and the Revert section below.

```bash
git add docs/data-fixes/2026-07-14-business-profile-reconcile.sql
git commit -m "docs(data-fix): reconcile business profile name/url drift, job side wins (backup kept)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --rebase && git push
```

---

## Changes / Revert

**Changes:** (1) migration `20260714170000_business_profile_two_way_sync.sql` — replaces `deals_sync_business_profile_name` (overwrite when 1 active job), adds `deals_sync_business_profile_url` + `jobs_sync_business_profile_to_deal`; (2) one-off backfill of `deals.business_profile_name/url` and `jobs.details.business_profile/profile_url`, backup in `public.business_profile_backfill_backup_20260714` (KEEP).

**Revert (in this order — drop triggers FIRST or restoring one side re-syncs onto the other):**

```sql
-- 1) triggers/functions
drop trigger if exists jobs_sync_business_profile_to_deal on public.jobs;
drop function if exists public.jobs_sync_business_profile_to_deal();
drop trigger if exists deals_sync_business_profile_url on public.deals;
drop function if exists public.deals_sync_business_profile_url();
-- restore fill-only name sync from 20260703120000_business_profile_name.sql:115-134

-- 2) data (from backup)
update public.deals d
   set business_profile_name = b.deal_name_before, business_profile_url = b.deal_url_before
  from (select distinct on (deal_id) deal_id, deal_name_before, deal_url_before
          from public.business_profile_backfill_backup_20260714) b
 where d.id = b.deal_id;
update public.jobs j
   set details = (coalesce(j.details,'{}'::jsonb) - 'business_profile' - 'profile_url')
       || case when b.job_name_before is not null
               then jsonb_build_object('business_profile', b.job_name_before) else '{}'::jsonb end
       || case when b.job_url_before is not null
               then jsonb_build_object('profile_url', b.job_url_before) else '{}'::jsonb end
  from public.business_profile_backfill_backup_20260714 b
 where j.id = b.job_id;
```

## End-to-end verification (after both tasks)

1. Re-run the Task 2 Step 4 convergence query → four zeros.
2. Raise-exception DO block (Task 1 Step 1) → `SYNCTEST-A` / `SYNCTEST-B` both propagate.
3. Real-flow spot check in the UI (optional, admin `info@itdev.gr`): edit Business Profile Name on a single-job deal's page → open the local SEO job Info tab and kanban card → new name visible; edit the URL in the job Info tab → deal page shows it after reload. Both UIs write through the exact columns the triggers watch, so the SQL checks already cover the mechanism.
