-- Accounting may hard-delete jobs to fix mistakes, but ONLY while the deal has
-- never once been Paid In Full (owner request 2026-08-31). "Ever paid" was not
-- durably recorded: accounting_completed_at is stamped only by the manual
-- complete_accounting RPC, while apply_payment_status (20260828100000) moves
-- deals into/out of paid_in_full with no permanent trace. So:
--   1) deals.first_paid_in_full_at — write-once stamp, trigger on stage change,
--      backfilled from accounting_completed_at and the current stage;
--   2) delete_jobs: admin unchanged; accounting allowed iff EVERY target job's
--      deal has first_paid_in_full_at IS NULL (all-or-nothing, else
--      'deal_was_paid_in_full'); other callers get 'not_allowed';
--   3) job_billing_ref_count: accounting also sees the billing-lines count.

alter table public.deals add column if not exists first_paid_in_full_at timestamptz;

comment on column public.deals.first_paid_in_full_at is
  'First time the deal ever reached accounting stage paid_in_full. Write-once, never cleared; gates accounting''s job hard-delete (delete_jobs).';

create or replace function public.deals_stamp_first_paid_in_full()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.first_paid_in_full_at is null
     and new.accounting_stage_id is distinct from old.accounting_stage_id
     and exists (
       select 1 from public.pipeline_stages ps
        where ps.id = new.accounting_stage_id
          and ps.board = 'accounting_onboarding' and ps.code = 'paid_in_full'
     ) then
    new.first_paid_in_full_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_stamp_first_paid_in_full on public.deals;
create trigger deals_stamp_first_paid_in_full
  before update of accounting_stage_id on public.deals
  for each row execute function public.deals_stamp_first_paid_in_full();

-- Backfill: manual completes have the exact first-paid moment; deals sitting in
-- paid_in_full today without the stamp get now() (best available evidence).
update public.deals d
   set first_paid_in_full_at = coalesce(d.accounting_completed_at, now())
 where d.first_paid_in_full_at is null
   and (d.accounting_completed_at is not null
        or d.accounting_stage_id in (
          select id from public.pipeline_stages
           where board = 'accounting_onboarding' and code = 'paid_in_full'));

-- Replaces the admin-only version from 20260618000030_delete_jobs_rpc.sql.
create or replace function public.delete_jobs(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_is_admin boolean;
  v_blocked int;
begin
  v_is_admin := public.current_user_is_admin();
  if not v_is_admin and not public.current_user_can('accounting_onboarding', 'edit') then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_allowed'));
  end if;

  if not v_is_admin then
    -- Accounting: every target job's deal must never have been Paid In Full.
    select count(*) into v_blocked
      from public.jobs j
      join public.deals d on d.id = j.deal_id
     where j.id = any(p_ids)
       and d.first_paid_in_full_at is not null;
    if v_blocked > 0 then
      return jsonb_build_object('ok', false, 'errors', jsonb_build_array('deal_was_paid_in_full'));
    end if;
  end if;

  -- Polymorphic comments/attachments (parent_type='job') have no FK => delete explicitly.
  delete from public.comments where parent_type = 'job' and parent_id = any(p_ids);
  delete from public.attachments where parent_type = 'job' and parent_id = any(p_ids);

  -- assigned_tasks cascade; deal_payment_lines.job_id set null (existing FKs).
  delete from public.jobs where id = any(p_ids);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_count', v_count);
end;
$$;

-- Billing-lines count for the delete-confirmation warning: admin OR accounting.
create or replace function public.job_billing_ref_count(p_job_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when not (public.current_user_is_admin()
              or public.current_user_can('accounting_onboarding', 'edit')) then 0
    else (select count(*) from public.deal_payment_lines where job_id = p_job_id)::int
  end;
$$;

-- ROLLBACK:
-- (restore the 20260618000030 bodies of delete_jobs/job_billing_ref_count, then)
-- drop trigger if exists deals_stamp_first_paid_in_full on public.deals;
-- drop function if exists public.deals_stamp_first_paid_in_full();
-- alter table public.deals drop column if exists first_paid_in_full_at;
