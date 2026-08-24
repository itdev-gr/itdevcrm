-- =============================================================================
-- 2026-08-24: employee break tracking for the top-bar Break button.
--
-- Each user toggles a break session from the topbar (30 min/day soft
-- allowance — the UI turns red on overage, nothing is enforced here).
-- Writes go only through the SECURITY DEFINER RPCs below; a partial unique
-- index guarantees at most one open session per user. A nightly pg_cron job
-- closes sessions people forgot to stop. Daily totals are pushed to the
-- sales app's DB by the push-break-stats edge function (separate migration).
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

create table if not exists public.break_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

-- At most one open (ended_at is null) session per user.
create unique index if not exists break_sessions_one_open
  on public.break_sessions (user_id) where ended_at is null;

create index if not exists break_sessions_user_started
  on public.break_sessions (user_id, started_at);

alter table public.break_sessions enable row level security;

-- Read: own sessions or admin. No INSERT/UPDATE/DELETE policies: writes come
-- only through the RPCs below (and the service role / cron).
drop policy if exists break_sessions_select on public.break_sessions;
create policy break_sessions_select on public.break_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

-- Start a break: no-op returning the existing row if one is already open.
drop function if exists public.start_my_break();
create function public.start_my_break()
returns setof public.break_sessions
language plpgsql security definer set search_path = public as $$
declare
  s public.break_sessions;
begin
  select * into s from public.break_sessions
    where user_id = auth.uid() and ended_at is null;
  if found then
    return next s;
    return;
  end if;
  insert into public.break_sessions (user_id) values (auth.uid()) returning * into s;
  return next s;
exception when unique_violation then
  -- Raced with another tab: return the session that won.
  select * into s from public.break_sessions
    where user_id = auth.uid() and ended_at is null;
  if found then return next s; end if;
end $$;

-- End the open break: no-op (empty set) if none is open.
drop function if exists public.end_my_break();
create function public.end_my_break()
returns setof public.break_sessions
language sql security definer set search_path = public as $$
  update public.break_sessions
     set ended_at = now()
   where user_id = auth.uid() and ended_at is null
  returning *;
$$;

-- Today's break state for the caller (Athens day, same convention as
-- get_my_call_stats_today): total seconds of CLOSED sessions started today
-- plus the start time of the open session, if any (the client computes the
-- live elapsed part itself). Always returns exactly one row.
drop function if exists public.get_my_break_today();
create function public.get_my_break_today()
returns table (active_started_at timestamptz, total_seconds int)
language sql stable security definer set search_path = public as $$
  select
    (select s.started_at from public.break_sessions s
      where s.user_id = auth.uid() and s.ended_at is null),
    coalesce((
      select sum(extract(epoch from (s.ended_at - s.started_at)))::int
      from public.break_sessions s
      where s.user_id = auth.uid()
        and s.ended_at is not null
        and (s.started_at at time zone 'Europe/Athens')::date
            = (now() at time zone 'Europe/Athens')::date
    ), 0);
$$;

-- Per-user totals for one Athens day, used by the push-break-stats edge
-- function (service role only — exposes every user's email + totals).
drop function if exists public.admin_break_totals_for_day(date);
create function public.admin_break_totals_for_day(p_date date)
returns table (email text, break_seconds int, break_count int)
language sql stable security definer set search_path = public as $$
  select p.email,
         sum(extract(epoch from (s.ended_at - s.started_at)))::int,
         count(*)::int
  from public.break_sessions s
  join public.profiles p on p.user_id = s.user_id
  where s.ended_at is not null
    and (s.started_at at time zone 'Europe/Athens')::date = p_date
  group by p.email;
$$;

revoke all on function public.admin_break_totals_for_day(date) from public;
grant execute on function public.admin_break_totals_for_day(date) to service_role;

revoke all on function public.start_my_break() from public;
revoke all on function public.end_my_break() from public;
revoke all on function public.get_my_break_today() from public;
grant execute on function public.start_my_break() to authenticated;
grant execute on function public.end_my_break() to authenticated;
grant execute on function public.get_my_break_today() to authenticated;

-- Close sessions people forgot to stop, before the nightly push. 20:45 UTC
-- = 23:45 Athens in summer / 22:45 in winter — after working hours either way.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'close_dangling_breaks') then
    perform cron.unschedule('close_dangling_breaks');
  end if;
  perform cron.schedule(
    'close_dangling_breaks',
    '45 20 * * *',
    $cron$ update public.break_sessions set ended_at = now() where ended_at is null; $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'close_dangling_breaks') then
--       perform cron.unschedule('close_dangling_breaks');
--     end if;
--   end $$;
--   drop function if exists public.admin_break_totals_for_day(date);
--   drop function if exists public.get_my_break_today();
--   drop function if exists public.end_my_break();
--   drop function if exists public.start_my_break();
--   drop table if exists public.break_sessions;
