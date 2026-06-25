-- 20260625100300_backfill_activity_client_id.sql
-- One-time backfill of activity_log.client_id for rows written before the
-- log_activity() change. Backup first.
--
-- Guarded against orphans: activity rows for since-deleted clients (or deals/
-- jobs/attachments whose owning client no longer exists) are left null rather
-- than violating activity_log_client_id_fkey.

create table if not exists public.activity_log_clientid_backfill_backup_20260625 as
select id, client_id from public.activity_log where client_id is null;

-- clients: entity_id IS the client id (only if the client still exists)
update public.activity_log a
  set client_id = a.entity_id
  where a.entity_type = 'clients' and a.client_id is null
    and exists (select 1 from public.clients c where c.id = a.entity_id);

-- deals
update public.activity_log a
  set client_id = d.client_id
  from public.deals d
  where a.entity_type = 'deals' and a.entity_id = d.id and a.client_id is null
    and d.client_id is not null
    and exists (select 1 from public.clients c where c.id = d.client_id);

-- jobs
update public.activity_log a
  set client_id = j.client_id
  from public.jobs j
  where a.entity_type = 'jobs' and a.entity_id = j.id and a.client_id is null
    and j.client_id is not null
    and exists (select 1 from public.clients c where c.id = j.client_id);

-- attachments: parent info lives in the changes snapshot (flat for insert/delete,
-- under ->'new' for update). The outer select resolves to a real client id or null.
update public.activity_log a
  set client_id = (
    select c.id from public.clients c
    where c.id = case coalesce(a.changes->>'parent_type', a.changes->'new'->>'parent_type')
      when 'client' then coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid
      when 'deal'   then (select d.client_id from public.deals d
                          where d.id = coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid)
      when 'job'    then (select j.client_id from public.jobs j
                          where j.id = coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid)
      else null
    end
  )
  where a.entity_type = 'attachments' and a.client_id is null;

-- ROLLBACK:
--   update public.activity_log a set client_id = b.client_id
--     from public.activity_log_clientid_backfill_backup_20260625 b where a.id = b.id;
--   drop table if exists public.activity_log_clientid_backfill_backup_20260625;
