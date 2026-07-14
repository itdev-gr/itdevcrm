# Business Profile Sync for AI SEO Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the 2026-07-14 two-way business-profile sync (deal ⇄ local_seo job) to `ai_seo` parent jobs, so AI SEO cards/Info tabs share the same Business Profile Name + URL as the deal and the local_seo child.

**Architecture:** Same trigger set as migration `20260714170000`, with two changes: (1) sync targets are `service_type in ('local_seo','ai_seo')`; (2) the "exactly one active job" mirror condition becomes "exactly one business GROUP", where a group is `coalesce(parent_job_id, id)` over the deal's active local_seo/ai_seo jobs — an AI SEO parent and its local_seo child share one group (same business) and both mirror. Seed-at-insert triggers also extended to ai_seo. A blank-fill backfill populates the 53 active ai_seo parents from their (already reconciled) deals — live data shows ZERO conflicts, so no winner policy is involved.

**Tech Stack:** Supabase Postgres prod `xujlrclyzxrvxszepquy`, plpgsql triggers, MCP `apply_migration`/`execute_sql`.

## Global Constraints

- Same as the 2026-07-14 two-way-sync plan: prod is live — backup/verify/rollback for every mutation; raise-exception DO-block verification (test writes self-rollback); do NOT run vitest (hits PROD) or `npm run build` (no TS changes); push directly to main after `git pull --rebase`; never `git add` files you didn't create; non-empty values only (clears never propagate); values stored trimmed; job JSONB keys `business_profile` / `profile_url`.
- "Active" = `not archived and status='active'`. "Group count" (the mirror gate) = `count(distinct coalesce(parent_job_id, id))` over the deal's active jobs with `service_type in ('local_seo','ai_seo')`.
- Function names keep their existing `*_local_*` names (repo keeps trigger names stable across body changes; the migration header explains they now also cover ai_seo).
- Live facts (2026-07-14 evening): 53 active ai_seo jobs, 0 name/url conflicts vs deal, 0 job-only values; ≤34 blank names / ≤23 blank urls fillable from deals; 227 deals have active local/ai jobs, 7 are multi-group (incl. Papigo `72ec7bb3`), 0 deals have 2+ ai_seo parents, 2 ai_seo parents have no local_seo child (they form their own single group — they DO mirror).

## Recursion-safety (unchanged argument)

Every UPDATE keeps an `is distinct from` guard. New cascade path: child edit → deal updated → deal trigger updates the parent (child row excluded, value equal) → parent's reverse trigger fires → parent value equals deal → 0 rows → stop.

---

### Task 1: Migration — extend sync to ai_seo

**Files:**
- Create: `supabase/migrations/20260714200000_business_profile_ai_seo_sync.sql`

**Interfaces:**
- Consumes: live functions from migration `20260714170000` (`deals_sync_business_profile_name`, `deals_sync_business_profile_url`, `jobs_sync_business_profile_to_deal`) and seed functions from `20260703120000`/`20260626120000` (`jobs_seed_local_business_profile`, `jobs_seed_local_profile_url`). All five bodies are REPLACED; triggers stay attached (functions replaced in place), except the two seed triggers and reverse trigger which are re-created idempotently.
- Produces: same function/trigger names, ai_seo-aware. Task 2 relies on these being live.

- [ ] **Step 1: Red — prove ai_seo is currently out of the loop (rolls back)**

Run via MCP `execute_sql`:

```sql
do $$
declare d_id uuid; parent_id uuid; child_id uuid; v_parent text; v_child text; v_deal text;
begin
  select p.deal_id, p.id, c.id into d_id, parent_id, child_id
  from public.jobs p
  join public.jobs c on c.parent_job_id = p.id and c.service_type = 'local_seo'
                    and not c.archived and c.status = 'active'
  where p.service_type = 'ai_seo' and not p.archived and p.status = 'active'
    and not exists (   -- deal must be single-group: no OTHER active local/ai job outside this pair
      select 1 from public.jobs o
      where o.deal_id = p.deal_id and o.service_type in ('local_seo','ai_seo')
        and not o.archived and o.status = 'active' and o.id not in (p.id, c.id))
  limit 1;

  update public.deals set business_profile_name = 'AITEST-DEAL' where id = d_id;
  select details->>'business_profile' into v_parent from public.jobs where id = parent_id;
  select details->>'business_profile' into v_child  from public.jobs where id = child_id;

  update public.jobs set details = coalesce(details,'{}'::jsonb) || '{"business_profile":"AITEST-PARENT"}'::jsonb
   where id = parent_id;
  select business_profile_name into v_deal from public.deals where id = d_id;

  raise exception 'VERIFY parent=% child=% deal_after_parent_edit=%', v_parent, v_child, v_deal;
end $$;
```

Expected NOW (gap): `parent=` shows the parent's OLD value (blank/unchanged — deal edits don't reach ai_seo), `child=AITEST-DEAL` (child already syncs), `deal_after_parent_edit=AITEST-DEAL` (parent edits don't reach the deal). Rolls back.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260714200000_business_profile_ai_seo_sync.sql` with exactly:

```sql
-- Business Profile sync: extend deal <-> job mirror to ai_seo parent jobs.
-- ai_seo cards/Info tabs expose business_profile + profile_url but were never
-- auto-populated (triggers targeted local_seo only). Now sync targets are
-- service_type in ('local_seo','ai_seo'), and the mirror gate changes from
-- "exactly 1 active local_seo job" to "exactly 1 business GROUP", where a
-- group is coalesce(parent_job_id, id): an AI SEO parent + its local_seo
-- child are ONE business and both mirror the deal. 2+ groups (multi-business
-- deals) keep fill-empty-only deal->job and no job->deal, as before.
-- Function names keep their historical *_local_* names.
-- Plan: docs/superpowers/plans/2026-07-14-business-profile-ai-seo-sync.md
-- Forward-only. Rollback at bottom.

-- 1) seed at job INSERT (name) — now also ai_seo
create or replace function public.jobs_seed_local_business_profile()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text;
begin
  if new.service_type in ('local_seo','ai_seo')
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

-- 2) seed at job INSERT (url) — now also ai_seo
create or replace function public.jobs_seed_local_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text;
begin
  if new.service_type in ('local_seo','ai_seo')
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'profile_url','')), '') is null then
    select nullif(trim(coalesce(business_profile_url,'')), '')
      into v_url from public.deals where id = new.deal_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('profile_url', v_url);
    end if;
  end if;
  return new;
end $function$;

-- 3) deal -> job: NAME (group-gated, local_seo + ai_seo)
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text; v_groups int;
begin
  v_name := nullif(trim(coalesce(new.business_profile_name,'')), '');
  if v_name is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', v_name)
     where j.deal_id = new.id
       and j.service_type in ('local_seo','ai_seo')
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is distinct from v_name
       and (v_groups = 1
            or nullif(trim(coalesce(j.details->>'business_profile','')), '') is null);
  end if;
  return new;
end $function$;

-- 4) deal -> job: URL (group-gated, local_seo + ai_seo)
create or replace function public.deals_sync_business_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text; v_groups int;
begin
  v_url := nullif(trim(coalesce(new.business_profile_url,'')), '');
  if v_url is not null
     and new.business_profile_url is distinct from old.business_profile_url then
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('profile_url', v_url)
     where j.deal_id = new.id
       and j.service_type in ('local_seo','ai_seo')
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'profile_url','')), '') is distinct from v_url
       and (v_groups = 1
            or nullif(trim(coalesce(j.details->>'profile_url','')), '') is null);
  end if;
  return new;
end $function$;

-- 5) job -> deal reverse (group-gated, local_seo + ai_seo)
create or replace function public.jobs_sync_business_profile_to_deal()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_name text; v_url text; v_old_name text; v_old_url text; v_groups int;
begin
  if new.service_type not in ('local_seo','ai_seo') or new.deal_id is null
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
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.deal_id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    if v_groups = 1 then
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

-- ROLLBACK (manual): re-apply the five function bodies from
--   supabase/migrations/20260714170000_business_profile_two_way_sync.sql (sync fns)
--   supabase/migrations/20260703120000_business_profile_name.sql (name seed)
--   supabase/migrations/20260626120000_business_profile_url.sql (url seed)
-- Triggers are unchanged by this migration (same names, same events).
```

- [ ] **Step 3: Apply to prod**

MCP `apply_migration` (project `xujlrclyzxrvxszepquy`, name `business_profile_ai_seo_sync`). Then sanity-check the five function bodies mention `ai_seo`:

```sql
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%ai_seo%'
  and proname in ('jobs_seed_local_business_profile','jobs_seed_local_profile_url',
                  'deals_sync_business_profile_name','deals_sync_business_profile_url',
                  'jobs_sync_business_profile_to_deal');
```

Expected: 5 rows.

- [ ] **Step 4: Green — re-run Step 1's DO block unchanged**

Expected: `parent=AITEST-DEAL child=AITEST-DEAL deal_after_parent_edit=AITEST-PARENT`. Rolls back.

- [ ] **Step 5: Regression — Papigo multi-group still protected**

Re-run the multi-guard DO block from the previous plan (deal `72ec7bb3`, update name to `SYNCTEST-MULTI`, job `29513d12` to `SYNCTEST-REV`): expected unchanged job names in the string_agg and `deal_after_job_edit=SYNCTEST-MULTI`. Rolls back.

- [ ] **Step 6: Commit and push**

```bash
git add supabase/migrations/20260714200000_business_profile_ai_seo_sync.sql docs/superpowers/plans/2026-07-14-business-profile-ai-seo-sync.md
git commit -m "feat(business-profile): extend deal<->job sync to ai_seo parents (group-gated)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --rebase && git push
```

---

### Task 2: Backfill — fill blank ai_seo values from deals

**Files:**
- Create: `docs/data-fixes/2026-07-14-business-profile-ai-seo-fill.md` (markdown, mirror `docs/data-fixes/2026-07-14-business-profile-reconcile.md`)

**Interfaces:**
- Consumes: Task 1 live. Produces: backup table `public.business_profile_ai_backfill_backup_20260714` (KEEP).

- [ ] **Step 1: Backup**

```sql
create table public.business_profile_ai_backfill_backup_20260714 as
select j.id as job_id, j.deal_id, j.status,
       j.details->>'business_profile' as job_name_before,
       j.details->>'profile_url'      as job_url_before
from public.jobs j
where j.service_type = 'ai_seo' and not j.archived;
```

Secure it like the previous backup (`alter table ... enable row level security; revoke all on ... from anon, authenticated;`). Verify count ≈ 64.

- [ ] **Step 2: Blank fills from deal (active ai_seo only; NO overwrites — live data has zero conflicts)**

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
   and j.service_type = 'ai_seo' and not j.archived and j.status = 'active'
   and (   (nullif(trim(coalesce(d.business_profile_name,'')),'') is not null
            and nullif(trim(coalesce(j.details->>'business_profile','')),'') is null)
        or (nullif(trim(coalesce(d.business_profile_url,'')),'') is not null
            and nullif(trim(coalesce(j.details->>'profile_url','')),'') is null));
```

Expected: ~25–35 rows (≤34 blank names / ≤23 blank urls on the active subset). Record the actual count (wrap as `select count(*) from (update ... returning 1) t` if needed).

- [ ] **Step 3: Verify convergence for ai_seo**

```sql
select count(*) filter (where nullif(trim(coalesce(d.business_profile_name,'')),'') is not null
                          and nullif(trim(coalesce(j.details->>'business_profile','')),'') is null) as name_blank_left,
       count(*) filter (where nullif(trim(coalesce(d.business_profile_url,'')),'') is not null
                          and nullif(trim(coalesce(j.details->>'profile_url','')),'') is null)      as url_blank_left,
       count(*) filter (where nullif(trim(coalesce(j.details->>'business_profile','')),'') is not null
                          and nullif(trim(coalesce(d.business_profile_name,'')),'') is not null
                          and trim(j.details->>'business_profile') <> trim(d.business_profile_name)) as name_conflicts,
       count(*) filter (where nullif(trim(coalesce(j.details->>'profile_url','')),'') is not null
                          and nullif(trim(coalesce(d.business_profile_url,'')),'') is not null
                          and trim(j.details->>'profile_url') <> trim(d.business_profile_url))       as url_conflicts
from public.jobs j join public.deals d on d.id = j.deal_id
where j.service_type='ai_seo' and not j.archived and j.status='active';
```

Expected: **all four counts = 0.**

- [ ] **Step 4: Data-fix doc, commit, push**

Write `docs/data-fixes/2026-07-14-business-profile-ai-seo-fill.md` (what/why one paragraph, SQL run, observed counts, backup table KEEP, revert = restore the two keys per job_id from the backup, mirroring the previous doc's Revert but scoped to ai_seo). Then:

```bash
git add docs/data-fixes/2026-07-14-business-profile-ai-seo-fill.md
git commit -m "docs(data-fix): fill ai_seo business profile name/url from deals (backup kept)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --rebase && git push
```

---

## Changes / Revert

**Changes:** migration `20260714200000` (five function bodies replaced, ai_seo-aware group gating); blank-fill of active ai_seo jobs' `details.business_profile`/`profile_url`, backup `business_profile_ai_backfill_backup_20260714` (KEEP).

**Revert:** re-apply the five prior function bodies (files listed in the migration's rollback comment); restore job keys from the backup:

```sql
update public.jobs j
   set details = (coalesce(j.details,'{}'::jsonb) - 'business_profile' - 'profile_url')
       || case when b.job_name_before is not null
               then jsonb_build_object('business_profile', b.job_name_before) else '{}'::jsonb end
       || case when b.job_url_before is not null
               then jsonb_build_object('profile_url', b.job_url_before) else '{}'::jsonb end
  from public.business_profile_ai_backfill_backup_20260714 b
 where j.id = b.job_id;
```
(Drop the sync triggers first if reverting data while keeping them would re-sync.)

## End-to-end verification (after both tasks)

1. Task 2 Step 3 query → four zeros.
2. Task 1 Step 1 DO block → parent + child + deal all mirror.
3. Optional UI spot check: an AI SEO deal's page ⇄ its AI SEO job card title / Info tab.
