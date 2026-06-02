-- email_outbox: queue for asynchronous sends (triggers + reminder cron).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  identity text not null check (identity in ('sales','accounting','internal')),
  to_email text not null,
  template_key text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending on public.email_outbox (created_at) where status = 'pending';

-- email_log: audit + idempotency for every attempted send.
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  identity text not null,
  to_email text not null,
  template_key text not null,
  resend_id text,
  status text not null check (status in ('sent','failed')),
  dedupe_key text,
  error text,
  created_at timestamptz not null default now()
);
-- A given logical email (dedupe_key) can be 'sent' at most once.
create unique index email_log_dedupe_sent
  on public.email_log (dedupe_key) where dedupe_key is not null and status = 'sent';

alter table public.email_outbox enable row level security;
alter table public.email_log enable row level security;

-- Admins may read both (for an ops view); writes go through security-definer
-- functions / the service-role Edge Function, never directly from clients.
create policy email_outbox_admin_read on public.email_outbox for select
  using (public.current_user_is_admin());
create policy email_log_admin_read on public.email_log for select
  using (public.current_user_is_admin());

-- ROLLBACK:
-- drop table if exists public.email_log;
-- drop table if exists public.email_outbox;
