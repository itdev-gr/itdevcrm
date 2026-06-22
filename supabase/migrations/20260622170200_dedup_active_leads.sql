-- One-time dedup of ACTIVE leads (archived=false, not converted) by phone, then email.
-- Per duplicate group: keep one "primary" (most-advanced live stage > rejected, then has
-- owner, then oldest), append the other copies' notes onto the primary so nothing is lost,
-- and ARCHIVE the rest (reversible) with archived_reason='duplicate_cleanup_20260622'.
-- Every archived row is backed up first. Covers today's 52 release-dups + the legacy ones.
--
-- ROLLBACK:
--   update public.leads l set archived=b.archived, archived_at=b.archived_at,
--          archived_by=b.archived_by, archived_reason=b.archived_reason, notes=b.notes
--     from public.leads_dedup_backup_20260622 b where l.id=b.id;
--   (then drop table public.leads_dedup_backup_20260622;)

create table if not exists public.leads_dedup_backup_20260622 (
  id uuid, archived boolean, archived_at timestamptz, archived_by uuid, archived_reason text,
  notes text, updated_at timestamptz, dedup_dim text, kept_into uuid, backed_up_at timestamptz default now()
);

-- ============================ PHONE ============================
create temp table _dp as
select l.id, l.phone_normalized,
  row_number() over w as rn,
  first_value(l.id) over w as primary_id
from public.leads l
left join public.pipeline_stages ps on ps.id = l.stage_id
where l.archived = false and l.converted_at is null and coalesce(l.phone_normalized,'') <> ''
  and l.phone_normalized in (
    select phone_normalized from public.leads
     where archived = false and converted_at is null and coalesce(phone_normalized,'') <> ''
     group by phone_normalized having count(*) > 1)
window w as (
  partition by l.phone_normalized order by
    (case ps.code when 'hot' then 6 when 'offer_sent' then 5 when 'working_on_it' then 4
                  when 'scheduled' then 4 when 'no_answer' then 2 when 'constant_na' then 2
                  when 'new_lead' then 1 when 'unique_lead' then 1 else 0 end) desc,
    (l.owner_user_id is not null) desc, l.created_at asc, l.id);

with extra as (
  select d.primary_id, string_agg(nullif(btrim(l.notes),''), E'\n--\n') as txt
  from _dp d join public.leads l on l.id = d.id
  where d.rn > 1 and coalesce(btrim(l.notes),'') <> ''
  group by d.primary_id
)
update public.leads p
   set notes = btrim(coalesce(p.notes,'') || E'\n--- duplicate notes (merged) ---\n' || e.txt, E'\n'),
       updated_at = now()
  from extra e where p.id = e.primary_id;

insert into public.leads_dedup_backup_20260622
  (id, archived, archived_at, archived_by, archived_reason, notes, updated_at, dedup_dim, kept_into)
select l.id, l.archived, l.archived_at, l.archived_by, l.archived_reason, l.notes, l.updated_at, 'phone', d.primary_id
from _dp d join public.leads l on l.id = d.id where d.rn > 1;

update public.leads
   set archived = true, archived_at = now(), archived_reason = 'duplicate_cleanup_20260622'
 where id in (select id from _dp where rn > 1) and archived = false;

-- ============================ EMAIL (still-active) ============================
create temp table _de as
select l.id, lower(btrim(l.email)) as ek,
  row_number() over w as rn,
  first_value(l.id) over w as primary_id
from public.leads l
left join public.pipeline_stages ps on ps.id = l.stage_id
where l.archived = false and l.converted_at is null and coalesce(btrim(l.email),'') <> ''
  and lower(btrim(l.email)) in (
    select lower(btrim(email)) from public.leads
     where archived = false and converted_at is null and coalesce(btrim(email),'') <> ''
     group by lower(btrim(email)) having count(*) > 1)
window w as (
  partition by lower(btrim(l.email)) order by
    (case ps.code when 'hot' then 6 when 'offer_sent' then 5 when 'working_on_it' then 4
                  when 'scheduled' then 4 when 'no_answer' then 2 when 'constant_na' then 2
                  when 'new_lead' then 1 when 'unique_lead' then 1 else 0 end) desc,
    (l.owner_user_id is not null) desc, l.created_at asc, l.id);

with extra as (
  select d.primary_id, string_agg(nullif(btrim(l.notes),''), E'\n--\n') as txt
  from _de d join public.leads l on l.id = d.id
  where d.rn > 1 and coalesce(btrim(l.notes),'') <> ''
  group by d.primary_id
)
update public.leads p
   set notes = btrim(coalesce(p.notes,'') || E'\n--- duplicate notes (merged) ---\n' || e.txt, E'\n'),
       updated_at = now()
  from extra e where p.id = e.primary_id;

insert into public.leads_dedup_backup_20260622
  (id, archived, archived_at, archived_by, archived_reason, notes, updated_at, dedup_dim, kept_into)
select l.id, l.archived, l.archived_at, l.archived_by, l.archived_reason, l.notes, l.updated_at, 'email', d.primary_id
from _de d join public.leads l on l.id = d.id where d.rn > 1;

update public.leads
   set archived = true, archived_at = now(), archived_reason = 'duplicate_cleanup_20260622'
 where id in (select id from _de where rn > 1) and archived = false;

drop table _dp;
drop table _de;
