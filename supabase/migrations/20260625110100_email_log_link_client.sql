-- 20260625110100_email_log_link_client.sql
-- Resolve client_id from to_email at insert time (most recent match wins).
-- send-email stays untouched.
create or replace function public.email_log_set_client_id()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.client_id is null and new.to_email is not null then
    select c.id into new.client_id
    from public.clients c
    where lower(c.email) = lower(new.to_email)
    order by c.created_at desc
    limit 1;
  end if;
  return new;
end $fn$;

drop trigger if exists email_log_set_client_id on public.email_log;
create trigger email_log_set_client_id
  before insert on public.email_log
  for each row execute function public.email_log_set_client_id();

-- Backfill existing rows (with backup).
create table if not exists public.email_log_clientid_backup_20260625 as
select id, client_id from public.email_log;

update public.email_log e
  set client_id = c.id
  from public.clients c
  where e.client_id is null and e.to_email is not null
    and lower(c.email) = lower(e.to_email)
    and c.id = (select c2.id from public.clients c2 where lower(c2.email)=lower(e.to_email) order by c2.created_at desc limit 1);

-- ROLLBACK:
--   update public.email_log e set client_id=b.client_id from public.email_log_clientid_backup_20260625 b where e.id=b.id;
--   drop table if exists public.email_log_clientid_backup_20260625;
--   drop trigger if exists email_log_set_client_id on public.email_log;
--   drop function if exists public.email_log_set_client_id();
