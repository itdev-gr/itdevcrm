-- 20260625110000_email_log_client_delivery.sql
-- Client link + delivery lifecycle on email_log. status stays free-text;
-- new values delivered/bounced/complained come from the Resend webhook.
alter table public.email_log
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz;

-- webhook looks rows up by the Resend message id
create index if not exists email_log_resend_id_idx on public.email_log (resend_id) where resend_id is not null;
create index if not exists email_log_client_idx on public.email_log (client_id) where client_id is not null;

-- ROLLBACK:
--   drop index if exists public.email_log_client_idx;
--   drop index if exists public.email_log_resend_id_idx;
--   alter table public.email_log drop column if exists bounced_at, drop column if exists delivered_at, drop column if exists client_id;
