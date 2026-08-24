-- =============================================================================
-- 2026-08-24: auto-record every won lead as a sale in the sales app
-- (sales.itdevcrm.com, project cthjxcftxwxbjpqmfiko) — replaces the manual
-- entry salespeople did on /tracking there.
--
-- Trigger point: the convert_lead_to_client transaction (leads.converted_at
-- flips null → set, converted_deal_id present). Outbox + pg_net pulse + cron
-- backstop, copied from the task_summary_outbox / email_instant_pulse pattern
-- so a push failure can never roll back the win. The push-won-sale edge
-- function maps the deal (packages from services_planned, amounts NET of VAT
-- — Greece 24% / Cyprus 0%, same rule as seed_deal_payments) onto the sales
-- app's `sales` table, matching the salesperson by email.
--
-- DEPLOY-TIME PREREQUISITES (manual, like webdev_report_secret):
--   1. select vault.create_secret('<random>', 'won_push_secret');
--   2. Edge function secrets: WON_PUSH_SECRET=<same random>
--      (SALES_SUPABASE_URL / SALES_SERVICE_ROLE_KEY already set for
--      push-break-stats).
--   3. Deploy function: push-won-sale (verify_jwt=false).
--   4. Sales-app migration 20260824130000_crm_won_sales.sql (crm_deal_id
--      unique index — the idempotency key of the whole pipeline).
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

create table if not exists public.won_push_outbox (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null,
  deal_id    uuid not null unique,
  status     text not null default 'queued' check (status in ('queued', 'sent', 'error')),
  attempts   int  not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

-- Service-role only: RLS on with no policies, and belt-and-braces revokes.
alter table public.won_push_outbox enable row level security;
revoke all on public.won_push_outbox from anon, authenticated;

-- Row-level enqueue: fires inside the conversion transaction. INSERTs (old-CRM
-- backfills arrive with converted_at already set) never fire this.
create or replace function public.leads_enqueue_won_push()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.won_push_outbox (lead_id, deal_id)
  values (new.id, new.converted_deal_id)
  on conflict (deal_id) do nothing;
  return new;
end $$;

drop trigger if exists leads_won_push_enqueue on public.leads;
create trigger leads_won_push_enqueue
  after update on public.leads
  for each row
  when (old.converted_at is null
        and new.converted_at is not null
        and new.converted_deal_id is not null)
  execute function public.leads_enqueue_won_push();

-- Statement-level pulse: best-effort webhook, never allowed to fail the win.
create or replace function public.won_push_pulse()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-won-sale',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'won_push_secret')
      ),
      body := jsonb_build_object('drain', true)
    );
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists won_push_outbox_pulse on public.won_push_outbox;
create trigger won_push_outbox_pulse
  after insert on public.won_push_outbox
  for each statement
  execute function public.won_push_pulse();

-- Cron backstop: re-drains anything the pulse missed (function cold, transient
-- sales-app failure). The drain is idempotent (upsert on crm_deal_id).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'won_push_drain') then
    perform cron.unschedule('won_push_drain');
  end if;
  perform cron.schedule(
    'won_push_drain',
    '*/10 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-won-sale',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'won_push_secret')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'won_push_drain') then
--       perform cron.unschedule('won_push_drain');
--     end if;
--   end $$;
--   drop trigger if exists won_push_outbox_pulse on public.won_push_outbox;
--   drop function if exists public.won_push_pulse();
--   drop trigger if exists leads_won_push_enqueue on public.leads;
--   drop function if exists public.leads_enqueue_won_push();
--   drop table if exists public.won_push_outbox;
