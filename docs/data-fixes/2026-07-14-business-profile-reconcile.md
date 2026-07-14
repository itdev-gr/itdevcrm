# 2026-07-14 — Reconcile business-profile name/URL drift (job side wins)

## Problem

Each deal carries a Business Profile name/URL (`deals.business_profile_name`,
`deals.business_profile_url`) and each `local_seo` job carries its own copy
(`jobs.details.business_profile`, `jobs.details.profile_url`). The original
sync was **one-way and fill-only** (deal → job, only when the job field was
blank), so the two copies drifted whenever either side was edited after
creation: deals kept stale values, jobs held the newer edits, and blank fields
never back-filled. Task 1 replaced that with two-way, overwrite-on-single-job
sync triggers (migration `20260714170000_business_profile_two_way_sync.sql`,
LIVE on prod). This one-off backfill reconciles the pre-existing drift so both
sides already agree before the new triggers take over.

Per the owner's decision, **the job side wins** on conflict (jobs hold the
values the SEO team actually maintains). Deals with two or more active
`local_seo` jobs that disagree are ambiguous and were **left divergent** (see
below). After running, the fired deal-side triggers cascade the reconciled
values back onto any active jobs whose fields were blank — intended, and all
echoes terminate via the triggers' is-distinct guards.

## What was run (2026-07-14, prod CRM xujlrclyzxrvxszepquy)

### Step 1 — Backup (275 rows)

```sql
create table public.business_profile_backfill_backup_20260714 as
select j.id as job_id, j.deal_id, j.status,
       j.details->>'business_profile' as job_name_before,
       j.details->>'profile_url'      as job_url_before,
       d.business_profile_name        as deal_name_before,
       d.business_profile_url         as deal_url_before
from public.jobs j join public.deals d on d.id = j.deal_id
where j.service_type = 'local_seo' and not j.archived;

alter table public.business_profile_backfill_backup_20260714 enable row level security;
revoke all on public.business_profile_backfill_backup_20260714 from anon, authenticated;
```

Verified: `select count(*)` → **275** rows (matches the expected snapshot count).

### Step 2 — Job → deal, job wins (149 deals updated)

Skips any field where 2+ active jobs on the same deal disagree (ambiguous).

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

Observed: **149 deals updated** (within the expected ~150–160 band). The
fired deal-side triggers then cascaded these values onto active jobs whose
fields were blank.

### Step 3 — Deal → job blank fills (27 jobs updated)

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

Observed: **27 jobs updated** (most of the original blanks were already filled
by Step 2's trigger cascade).

### Step 4 — Verify convergence

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

Result: **all four counts = 0** (`name_conflicts_left=0`,
`url_conflicts_left=0`, `name_blank_jobs=0`, `url_blank_jobs=0`).

## Intentionally left divergent (multi-active ambiguous deals)

One deal has two active `local_seo` jobs that hold two genuinely different
business profiles, so it is correct to leave them divergent:

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

| deal_id | title | job_names |
|---|---|---|
| `72ec7bb3-7636-40d7-91e2-dd8420d715ad` | ΟΙΚΟΓΕΝΕΙΑ ΜΠΕΚΑ ΜΟΝΟΠΡΟΣΩΠΗ ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ | `Βωλίτης` \| `Mini Market Πάπιγκο Ιωαννίνων Βωλίτης` |

Deal 72ec7bb3 ("Papigo") is two real businesses (a mini market and a
café/restaurant) under one deal — left as-is by design.

## Backup table

`public.business_profile_backfill_backup_20260714` — **KEEP**. This is the
revert path; do not drop it.

## Revert

Drop the Task 1 triggers **first** (otherwise restoring one side re-syncs onto
the other), then restore the data from the backup:

```sql
-- 1) triggers/functions (from migration 20260714170000)
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
