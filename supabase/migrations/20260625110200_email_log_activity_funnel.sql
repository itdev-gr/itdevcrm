-- 20260625110200_email_log_activity_funnel.sql
-- Write client-linked email lifecycle events into activity_log so they appear
-- in the unified feed. INSERT(status=sent) => "sent"; UPDATE to a delivery
-- outcome => that outcome. Service-role webhook updates have no auth.uid()
-- (actor shows as System), which is correct for automated delivery events.
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
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
      values ('email_log', new.id, auth.uid(), 'update',
              jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb),
              new.client_id);
    end if;
  end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists email_log_activity on public.email_log;
create trigger email_log_activity
  after insert or update on public.email_log
  for each row execute function public.log_email_activity();

-- ROLLBACK:
--   drop trigger if exists email_log_activity on public.email_log;
--   drop function if exists public.log_email_activity();
