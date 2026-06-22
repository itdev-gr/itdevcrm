-- One-time cleanup: remove pipeline leads that are already an existing (non-archived)
-- client, matched by email OR normalized phone (last-10-digit key). Protects leads in
-- the `won` stage or with converted_at set (those are the conversion records).
-- Applied to prod 2026-06-22 via the Management API: 77 leads + 120 lead-comments deleted,
-- 4 won/converted matches kept. Full row backup taken first.

create table if not exists public.leads_client_dup_backup_20260622 as
select l.*, now() as backed_up_at
from public.leads l
left join public.pipeline_stages ps on ps.id = l.stage_id
where (ps.code is distinct from 'won') and l.converted_at is null
  and exists (
    select 1 from public.clients c
    where c.archived = false
      and (
        (nullif(btrim(l.phone_normalized), '') is not null and c.phone_normalized = nullif(btrim(l.phone_normalized), ''))
        or (nullif(lower(btrim(l.email)), '') is not null and lower(btrim(c.email)) = lower(btrim(l.email)))
      )
  );

-- Polymorphic lead comments have no FK → delete explicitly (NOT restorable on rollback).
delete from public.comments
where parent_type = 'lead'
  and parent_id in (select id from public.leads_client_dup_backup_20260622);

delete from public.leads
where id in (select id from public.leads_client_dup_backup_20260622);

-- ROLLBACK (restores the lead rows; their deleted comments are not recoverable):
--   insert into public.leads
--   select (b).* from (
--     select b - 'backed_up_at' as b from ... -- or list columns explicitly
--   );
-- Practical rollback: re-insert from backup using an explicit column list matching
-- public.leads, e.g.
--   insert into public.leads (id, source, source_data, title, contact_first_name, ...)
--   select id, source, source_data, title, contact_first_name, ...
--   from public.leads_client_dup_backup_20260622;
-- then: drop table public.leads_client_dup_backup_20260622;
