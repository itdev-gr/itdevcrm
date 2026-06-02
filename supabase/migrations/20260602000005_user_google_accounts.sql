create table public.user_google_accounts (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  google_email text not null,
  refresh_token_enc text not null,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.user_google_accounts enable row level security;
-- No client policies → only the service-role Edge Function can read/write the
-- encrypted refresh token. Clients read connection status via the function below.

create view public.user_google_status
with (security_invoker = true) as
select user_id,
       google_email,
       (revoked_at is null) as connected
from public.user_google_accounts;

-- Clients read their own connection status here (security definer, auth.uid()-scoped).
create or replace function public.my_google_status()
returns table (google_email text, connected boolean)
language sql security definer set search_path = public stable as $$
  select google_email, (revoked_at is null)
  from public.user_google_accounts
  where user_id = auth.uid();
$$;
grant execute on function public.my_google_status() to authenticated;

-- ROLLBACK:
-- drop function if exists public.my_google_status();
-- drop view if exists public.user_google_status;
-- drop table if exists public.user_google_accounts;
