-- CORRECTIVE for 20260622170200: the phone dedup grouped on phone_normalized without
-- excluding placeholder/short values, so 257 DISTINCT leads sharing the country-code-only
-- phone "+30" (phone_normalized "30") were wrongly archived as one duplicate group.
-- Fix: (a) restore those 257, (b) strip the garbage merged-notes from the false primary,
-- (c) re-run a VALID email-only dedup so genuine email duplicates among them stay deduped.
-- Genuine real-phone duplicates (phone_normalized >= 10 digits) remain correctly archived.

-- (a) Restore the falsely-archived (short phone_normalized) leads from backup.
update public.leads l
   set archived = false, archived_at = null, archived_by = null, archived_reason = null,
       notes = b.notes, updated_at = now()
  from public.leads_dedup_backup_20260622 b
 where l.id = b.id
   and l.archived_reason = 'duplicate_cleanup_20260622'
   and length(coalesce(l.phone_normalized,'')) < 10;

-- (b) Strip the garbage merged-notes block from the false primary (short phone, still active).
update public.leads
   set notes = nullif(btrim(split_part(notes, E'\n--- duplicate notes (merged) ---\n', 1)), ''),
       updated_at = now()
 where archived = false
   and length(coalesce(phone_normalized,'')) < 10
   and notes like '%--- duplicate notes (merged) ---%';

-- (c) Re-run EMAIL dedup on active leads (valid grouping) to archive genuine email dups.
create temp table _de2 as
select l.id, row_number() over w as rn, first_value(l.id) over w as primary_id
from public.leads l left join public.pipeline_stages ps on ps.id = l.stage_id
where l.archived = false and l.converted_at is null and coalesce(btrim(l.email),'') <> ''
  and lower(btrim(l.email)) in (
    select lower(btrim(email)) from public.leads
     where archived = false and converted_at is null and coalesce(btrim(email),'') <> ''
     group by lower(btrim(email)) having count(*) > 1)
window w as (partition by lower(btrim(l.email)) order by
  (case ps.code when 'hot' then 6 when 'offer_sent' then 5 when 'working_on_it' then 4
                when 'scheduled' then 4 when 'no_answer' then 2 when 'constant_na' then 2
                when 'new_lead' then 1 when 'unique_lead' then 1 else 0 end) desc,
  (l.owner_user_id is not null) desc, l.created_at asc, l.id);

with extra as (
  select d.primary_id, string_agg(nullif(btrim(l.notes),''), E'\n--\n') as txt
  from _de2 d join public.leads l on l.id = d.id
  where d.rn > 1 and coalesce(btrim(l.notes),'') <> '' group by d.primary_id)
update public.leads p
   set notes = btrim(coalesce(p.notes,'') || E'\n--- duplicate notes (merged) ---\n' || e.txt, E'\n'), updated_at = now()
  from extra e where p.id = e.primary_id;

insert into public.leads_dedup_backup_20260622
  (id, archived, archived_at, archived_by, archived_reason, notes, updated_at, dedup_dim, kept_into)
select l.id, l.archived, l.archived_at, l.archived_by, l.archived_reason, l.notes, l.updated_at, 'email_fix', d.primary_id
from _de2 d join public.leads l on l.id = d.id where d.rn > 1;

update public.leads
   set archived = true, archived_at = now(), archived_reason = 'duplicate_cleanup_20260622'
 where id in (select id from _de2 where rn > 1) and archived = false;

drop table _de2;
