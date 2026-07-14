# 2026-07-14 — Fill blank ai_seo business-profile name/URL from deals

## Problem

Each `ai_seo` job carries its own copy of the Business Profile name/URL
(`jobs.details.business_profile`, `jobs.details.profile_url`), surfaced on the
AI SEO job card title and Info tab. Unlike `local_seo`, these `ai_seo` fields
were **never auto-populated** — the earlier fill-only seed trigger targeted
`local_seo` only, so AI SEO cards and Info tabs sat blank even when the parent
deal already carried a Business Profile name/URL. Task 1 extended the two-way
sync triggers to `ai_seo` parents (migration
`20260714200000`, LIVE on prod, commit `990f7f8`). This one-off backfill fills
the pre-existing blanks from the already-reconciled deals so both sides agree
before the new triggers take over.

This backfill is **pure blank-filling** — it only writes a job field when that
field is blank and the deal carries a value. Live data had **zero conflicts**
(verified: `name_conflicts=0`, `url_conflicts=0` both before and after), so
**nothing was overwritten**. The fired reverse (deal-side) trigger from Task 1
re-runs on each updated row but is a no-op: the filled value equals the deal's,
and the trigger's is-distinct guards terminate the echo.

## What was run (2026-07-14, prod CRM xujlrclyzxrvxszepquy)

### Step 1 — Backup (64 rows)

```sql
create table public.business_profile_ai_backfill_backup_20260714 as
select j.id as job_id, j.deal_id, j.status,
       j.details->>'business_profile' as job_name_before,
       j.details->>'profile_url'      as job_url_before
from public.jobs j
where j.service_type = 'ai_seo' and not j.archived;

alter table public.business_profile_ai_backfill_backup_20260714 enable row level security;
revoke all on public.business_profile_ai_backfill_backup_20260714 from anon, authenticated;
```

Verified: `select count(*)` → **64** rows (matches the expected snapshot count).

### Step 2 — Deal → job blank fills (34 jobs updated)

Active `ai_seo` jobs only; only writes a field where the job field is blank and
the deal carries a value. No overwrites.

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

Observed: **34 jobs updated** (within the expected ~25–35 band).

### Step 3 — Verify convergence

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

Result: **all four counts = 0** (`name_blank_left=0`, `url_blank_left=0`,
`name_conflicts=0`, `url_conflicts=0`).

## Backup table

`public.business_profile_ai_backfill_backup_20260714` — **KEEP**. This is the
revert path; do not drop it.

## Revert

Restore the two `details` keys per `job_id` from the backup. (Drop the Task 1
sync triggers first if reverting data while keeping them would re-sync onto the
deal side.)

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
