-- =============================================================================
-- Email pipeline health: a per-drain heartbeat + a status RPC for the in-app alert.
-- =============================================================================

-- Singleton heartbeat row, written by the send-email function on each drain run.
create table public.email_drain_heartbeat (
  id          boolean primary key default true check (id),
  last_run_at timestamptz,
  last_ok_at  timestamptz,
  processed   int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  updated_at  timestamptz not null default now()
);
insert into public.email_drain_heartbeat (id) values (true) on conflict do nothing;

alter table public.email_drain_heartbeat enable row level security;
-- Admins can read it; the function writes via the service role (bypasses RLS).
create policy email_drain_heartbeat_admin_read on public.email_drain_heartbeat
  for select to authenticated using (public.current_user_is_admin());

-- Returns { status, reason, last_run_age_seconds, stuck_count, failed_count,
-- oldest_pending_age_seconds }. Non-admins get a bare {status:'ok'} (no leakage).
create or replace function public.email_pipeline_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  last_run_age   int;
  stuck          int;
  maxed          int;
  failed_recent  int;
  oldest_pending int;
  v_status       text;
  v_reason       text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select extract(epoch from now() - last_run_at)::int into last_run_age
    from public.email_drain_heartbeat where id;
  select count(*) into stuck from public.email_outbox
    where status = 'pending' and created_at < now() - interval '15 minutes';
  select count(*) into maxed from public.email_outbox
    where status = 'pending' and attempts >= 5;
  select count(*) into failed_recent from public.email_log
    where status = 'failed' and created_at > now() - interval '1 hour';
  select extract(epoch from now() - min(created_at))::int into oldest_pending
    from public.email_outbox where status = 'pending';

  if last_run_age is null or last_run_age > 600 then
    v_status := 'down';
  elsif coalesce(stuck, 0) > 0 or coalesce(maxed, 0) > 0 or coalesce(failed_recent, 0) > 0 then
    v_status := 'degraded';
  else
    v_status := 'ok';
  end if;

  v_reason := case
    when last_run_age is null            then 'drain has never run'
    when last_run_age > 600              then 'drain last ran ' || last_run_age || 's ago'
    when coalesce(stuck, 0) > 0          then stuck || ' email(s) stuck pending'
    when coalesce(maxed, 0) > 0          then maxed || ' email(s) hit max retries'
    when coalesce(failed_recent, 0) > 0  then failed_recent || ' send failure(s) in the last hour'
    else 'ok' end;

  return jsonb_build_object(
    'status', v_status, 'reason', v_reason,
    'last_run_age_seconds', last_run_age,
    'stuck_count', coalesce(stuck, 0),
    'failed_count', coalesce(failed_recent, 0),
    'oldest_pending_age_seconds', oldest_pending
  );
end;
$$;

revoke all on function public.email_pipeline_health() from public;
grant execute on function public.email_pipeline_health() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop function if exists public.email_pipeline_health();
--   drop table if exists public.email_drain_heartbeat;
-- ---------------------------------------------------------------------------
