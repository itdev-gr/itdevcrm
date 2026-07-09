-- 2026-07-09: Client email capture — storage + department-siloed RLS.
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,            -- RFC822 Message-ID (dedup key)
  gmail_id text, thread_id text,
  direction text not null check (direction in ('inbound','outbound')),
  from_email text not null, from_name text,
  to_email text not null,
  subject text, body_text text, body_html text, snippet text,
  sent_at timestamptz,
  client_id uuid references public.clients(id),
  deal_id uuid references public.deals(id),
  job_id uuid references public.jobs(id),
  department text,  -- a group code: web_dev/web_seo/local_seo/ai_seo/ads/social_media/hosting/sales/accounting
  staff_user_id uuid references public.profiles(user_id),
  captured_from_user_id uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index if not exists email_messages_deal_idx on public.email_messages(deal_id);
create index if not exists email_messages_job_idx on public.email_messages(job_id) where job_id is not null;
create index if not exists email_messages_client_idx on public.email_messages(client_id);
create index if not exists email_messages_thread_idx on public.email_messages(thread_id);

-- Supersede the original 3-value CHECK: department is a group code (service-based
-- silo). Idempotent for already-applied installs.
alter table public.email_messages drop constraint if exists email_messages_department_check;

alter table public.email_messages enable row level security;

-- Department-siloed reads, following the CRM's board-rights model (same gate as
-- deals): you always see your own (you were sender/receiver); otherwise you must
-- have `view` rights on the email's department board. current_user_can already
-- grants admins everything and honours per-user permission overrides/revocations.
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or public.current_user_can(department, 'view')
);
-- No INSERT/UPDATE/DELETE policies: only the service-role edge function writes.

create table if not exists public.user_google_sync (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  last_synced_at timestamptz,
  backfilled_at timestamptz
);
alter table public.user_google_sync enable row level security;
-- No client policies: service-role only.

-- ROLLBACK:
--   drop table if exists public.user_google_sync;
--   drop table if exists public.email_messages;
