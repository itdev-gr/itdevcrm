-- 20260625110300_backfill_email_activity.sql
-- One-time: surface historical client-linked sent emails in the feed (175 rows
-- at write time). Idempotent: skips emails that already have an activity_log row.
insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id, created_at)
select 'email_log', e.id, null, 'insert', row_to_json(e)::jsonb, e.client_id, e.created_at
from public.email_log e
where e.status = 'sent' and e.client_id is not null
  and not exists (
    select 1 from public.activity_log a
    where a.entity_type='email_log' and a.entity_id=e.id and a.action='insert'
  );

-- ROLLBACK:
--   delete from public.activity_log where entity_type='email_log' and action='insert' and user_id is null;
