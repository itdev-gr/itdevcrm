-- 20260629020000_activity_skip_noop_updates.sql
-- The activity feed was spammed with "Saved the <entity> (no changes)" rows by
-- System: the shared audit trigger log_activity() logged EVERY update, including
-- updates that only touched system/shadow columns (updated_at bumps from crons,
-- triggers, RPCs). Those render as "no changes" because the UI's diffOf ignores
-- HIDDEN_FIELDS (src/features/activity/format.ts:13-40).
--
-- Fix: skip logging an UPDATE when nothing changed outside those hidden fields
-- (same definition the UI uses), and delete the existing no-op rows from the four
-- entities whose detail cards render them (jobs, deals, clients, leads).

-- 1) Guard the shared trigger. Only the UPDATE branch changes.
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  entity_id_value uuid;
  changes_json jsonb;
  rec jsonb;
  client_id_value uuid;
  hidden_keys text[] := array[
    'id','code','created_at','updated_at','created_by','archived_at','archived_by',
    'source_data','phone_normalized','unsubscribe_token','converted_client_id','converted_deal_id',
    'client_id','deal_id','assigned_group_id','billing_group_id',
    'locked_at','accounting_completed_at','started_at','completed_at','blocked_at',
    'converted_at','read_at','monthly_tasks_period'];
begin
  if tg_op = 'DELETE' then
    rec := row_to_json(old)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := rec;
  elsif tg_op = 'INSERT' then
    rec := row_to_json(new)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := rec;
  else
    -- UPDATE: skip no-op edits (nothing changed outside the hidden/system fields).
    if (row_to_json(new)::jsonb - hidden_keys) = (row_to_json(old)::jsonb - hidden_keys) then
      return coalesce(new, old);
    end if;
    rec := row_to_json(new)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := jsonb_build_object('old', row_to_json(old)::jsonb, 'new', rec);
  end if;

  client_id_value := case tg_table_name
    when 'clients'        then entity_id_value
    when 'deals'          then (rec ->> 'client_id')::uuid
    when 'jobs'           then (rec ->> 'client_id')::uuid
    when 'user_tasks'     then (rec ->> 'client_id')::uuid
    when 'assigned_tasks' then (rec ->> 'client_id')::uuid
    when 'deal_payments'  then (select d.client_id from public.deals d
                                where d.id = (rec ->> 'deal_id')::uuid)
    when 'attachments'    then case rec ->> 'parent_type'
        when 'client' then (rec ->> 'parent_id')::uuid
        when 'deal'   then (select d.client_id from public.deals d
                            where d.id = (rec ->> 'parent_id')::uuid)
        when 'job'    then (select j.client_id from public.jobs j
                            where j.id = (rec ->> 'parent_id')::uuid)
        else null
      end
    else null
  end;

  insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
  values (tg_table_name, entity_id_value, auth.uid(), lower(tg_op), changes_json, client_id_value);

  return coalesce(new, old);
end $function$;

-- 2) Backfill: remove existing no-op "(no changes)" rows from the card entities.
create table if not exists public.activity_log_noop_backup_20260629 as
select a.*
from public.activity_log a
where a.action = 'update'
  and a.entity_type in ('jobs','deals','clients','leads')
  and ((a.changes->'new') - array[
        'id','code','created_at','updated_at','created_by','archived_at','archived_by',
        'source_data','phone_normalized','unsubscribe_token','converted_client_id','converted_deal_id',
        'client_id','deal_id','assigned_group_id','billing_group_id',
        'locked_at','accounting_completed_at','started_at','completed_at','blocked_at',
        'converted_at','read_at','monthly_tasks_period']::text[])
      = ((a.changes->'old') - array[
        'id','code','created_at','updated_at','created_by','archived_at','archived_by',
        'source_data','phone_normalized','unsubscribe_token','converted_client_id','converted_deal_id',
        'client_id','deal_id','assigned_group_id','billing_group_id',
        'locked_at','accounting_completed_at','started_at','completed_at','blocked_at',
        'converted_at','read_at','monthly_tasks_period']::text[]);

delete from public.activity_log a
using public.activity_log_noop_backup_20260629 b
where a.id = b.id;

-- ROLLBACK:
--   insert into public.activity_log select * from public.activity_log_noop_backup_20260629;
--   drop table public.activity_log_noop_backup_20260629;
--   -- restore log_activity() body from 20260625100100_log_activity_client_id.sql
