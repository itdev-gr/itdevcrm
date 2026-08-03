-- =============================================================================
-- Live per-extension call stats (Voiceland/Yeastar) for the CRM top-bar widget.
-- Spec: docs/superpowers/specs/2026-08-03-voiceland-call-stats-topbar-widget-design.md
-- The box (72.62.58.175) upserts one row per extension per day via the service
-- role (bypasses RLS). Users read only their own row (profiles.phone_extension).
-- =============================================================================

create table if not exists public.call_stats_daily (
  extension      text not null,
  stat_date      date not null,
  total          int  not null default 0,
  inbound        int  not null default 0,
  outbound       int  not null default 0,
  internal       int  not null default 0,
  answered       int  not null default 0,
  missed         int  not null default 0,
  missed_inbound int  not null default 0,
  talk_seconds   int  not null default 0,
  ring_seconds   int  not null default 0,
  unique_numbers int  not null default 0,
  recent         jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (extension, stat_date)
);

alter table public.call_stats_daily enable row level security;

-- Read: own extension (via profiles.phone_extension) or admin.
drop policy if exists call_stats_daily_select on public.call_stats_daily;
create policy call_stats_daily_select on public.call_stats_daily
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.phone_extension = call_stats_daily.extension
    )
  );
-- No INSERT/UPDATE/DELETE policy: writes come only from the service role.

-- Caller-scoped read RPC (single row for today, Athens tz).
create or replace function public.get_my_call_stats_today()
returns public.call_stats_daily
language sql stable security definer set search_path = public as $$
  select s.*
  from public.call_stats_daily s
  join public.profiles p
    on p.phone_extension = s.extension and p.user_id = auth.uid()
  where s.stat_date = (now() at time zone 'Europe/Athens')::date
  limit 1;
$$;

revoke all on function public.get_my_call_stats_today() from public;
grant execute on function public.get_my_call_stats_today() to authenticated;

-- ROLLBACK:
-- drop function if exists public.get_my_call_stats_today();
-- drop table if exists public.call_stats_daily;
