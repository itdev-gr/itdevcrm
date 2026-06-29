-- 20260629010000_email_activity_single_line.sql
-- The activity feed showed each email TWICE: the lifecycle trigger
-- (20260625110200) logged the INSERT (status=sent -> "Email sent: X") and then a
-- SECOND activity row on the delivery UPDATE (status=delivered -> "Email delivered:
-- X"). Same email, two lines — looks like a duplicate send (it is NOT; email_log
-- has one row per email with a unique resend_id).
--
-- Fix: keep exactly ONE activity row per email and update it IN PLACE so it flips
-- "Email sent" -> "Email delivered" (or bounced / spam complaint) on the same line.
-- The formatter (src/features/activity/format.ts) renders an 'insert' row as
-- "Email sent" regardless of status, and an 'update' row by its status — so the
-- in-place update must also switch action to 'update'.

-- 1) Trigger: update the existing 'sent' row instead of appending a new one.
create or replace function public.log_email_activity()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.client_id is not null and new.status = 'sent' then
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
      values ('email_log', new.id, auth.uid(), 'insert', row_to_json(new)::jsonb, new.client_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.client_id is not null
       and new.status is distinct from old.status
       and new.status in ('delivered','bounced','complained') then
      -- One line per email: promote the existing 'sent' row to its delivery outcome.
      update public.activity_log
        set action  = 'update',
            changes = jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb),
            user_id = coalesce(user_id, auth.uid())
        where entity_type = 'email_log' and entity_id = new.id;
      if not found then   -- no prior 'sent' row (e.g. inserted with a non-sent status)
        insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
        values ('email_log', new.id, auth.uid(), 'update',
                jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb),
                new.client_id);
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $fn$;
-- (trigger email_log_activity already bound to this function in 20260625110200)

-- 2) Backfill existing duplicates: collapse to one row per email, keeping the
--    EARLIEST row (send-time position) but promoted to the LATEST status.
create table if not exists public.activity_log_email_dedup_backup_20260629 as
select * from public.activity_log where entity_type = 'email_log';

with latest as (
  select distinct on (entity_id) entity_id, action as a, changes as c
  from public.activity_log where entity_type = 'email_log'
  order by entity_id, created_at desc
),
earliest as (
  select distinct on (entity_id) id, entity_id
  from public.activity_log where entity_type = 'email_log'
  order by entity_id, created_at asc
)
update public.activity_log al
set action = latest.a, changes = latest.c
from earliest e
join latest on latest.entity_id = e.entity_id
where al.id = e.id
  and (al.action is distinct from latest.a or al.changes is distinct from latest.c);

delete from public.activity_log al
using (
  select id, row_number() over (partition by entity_id order by created_at asc) as rn
  from public.activity_log where entity_type = 'email_log'
) r
where al.id = r.id and r.rn > 1;

-- ROLLBACK:
--   delete from public.activity_log where entity_type='email_log';
--   insert into public.activity_log select * from public.activity_log_email_dedup_backup_20260629;
--   drop table public.activity_log_email_dedup_backup_20260629;
--   -- restore log_email_activity() body from 20260625110200_email_log_activity_funnel.sql
