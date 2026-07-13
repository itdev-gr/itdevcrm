-- 2026-07-13: applied to prod via Management API (this session) — kept as the
-- durable record. Originally authored as RUN_ME_IN_SQL_EDITOR.sql by the
-- signature-rollout session. Verification at apply: retagged=202, demo_left=0,
-- schedule='*/2 * * * *'.
-- Items 1-4 in one shot (idempotent). Paste into the Supabase SQL editor and Run.
-- The final SELECT prints the verification summary.

-- 1) Retag mkifokeris's uncoded client emails -> web_dev (backup kept for rollback)
create table if not exists public.email_dept_mkif_retag_backup_20260710 (
  id uuid primary key,
  department text
);
insert into public.email_dept_mkif_retag_backup_20260710 (id, department)
select id, department
  from public.email_messages
 where staff_user_id = '61b53075-398f-43a0-86f6-8bce177b669b'
   and job_id is null and lead_id is null and client_id is not null
   and department is distinct from 'web_dev'
on conflict (id) do nothing;

update public.email_messages
   set department = 'web_dev'
 where staff_user_id = '61b53075-398f-43a0-86f6-8bce177b669b'
   and job_id is null and lead_id is null and client_id is not null
   and department is distinct from 'web_dev';

-- 2) Gmail sweep health RPC (lights up the admin staleness banner)
create or replace function public.gmail_sync_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_accounts int;
  v_stale    int;
  v_newest   timestamptz;
  v_oldest   timestamptz;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select count(*),
         count(*) filter (
           where last_synced_at is null
              or last_synced_at < now() - interval '30 minutes'
         ),
         max(last_synced_at),
         min(last_synced_at)
    into v_accounts, v_stale, v_newest, v_oldest
    from public.user_google_sync;

  return jsonb_build_object(
    'accounts', coalesce(v_accounts, 0),
    'stale_accounts', coalesce(v_stale, 0),
    'newest_synced_at', v_newest,
    'oldest_synced_at', v_oldest
  );
end;
$$;
revoke all on function public.gmail_sync_health() from public;
grant execute on function public.gmail_sync_health() to authenticated;
notify pgrst, 'reload schema';

-- 3) Sweep every 2 minutes (was */5)
select cron.alter_job(
  (select jobid from cron.job where jobname = 'gmail_sync_sweep'),
  schedule => '*/2 * * * *');

-- 4) Wipe the 8 leftover DEMO-QA captured-email rows
delete from public.email_messages where to_email ilike '%demoqa%';

-- Verification summary (this result shows after Run)
select
  (select count(*) from public.email_messages
    where staff_user_id = '61b53075-398f-43a0-86f6-8bce177b669b'
      and job_id is null and lead_id is null and client_id is not null
      and department = 'web_dev')                                   as retagged_webdev_rows,
  (select count(*) from public.email_messages
    where to_email ilike '%demoqa%')                                as demo_rows_left,
  (select schedule from cron.job where jobname = 'gmail_sync_sweep') as sweep_schedule,
  public.gmail_sync_health()                                         as sync_health;
