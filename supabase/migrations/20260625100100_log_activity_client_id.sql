-- 20260625100100_log_activity_client_id.sql
-- Extend the shared activity trigger fn to derive and store client_id.
-- Keeps all existing behaviour; only adds client_id resolution + column write.

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
    rec := row_to_json(new)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := jsonb_build_object('old', row_to_json(old)::jsonb, 'new', rec);
  end if;

  -- Derive the owning client for this event.
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

-- ROLLBACK: re-create log_activity() without the client_id_value block and with the
-- original 5-column insert (entity_type, entity_id, user_id, action, changes).
