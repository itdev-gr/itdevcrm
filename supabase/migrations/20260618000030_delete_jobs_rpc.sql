-- Admin-only PERMANENT delete of jobs. Verifies the caller is an admin, then
-- hard-deletes the jobs. assigned_tasks cascade; monthly_invoice_items.job_id and
-- deal_payment_lines.job_id are nulled by existing ON DELETE SET NULL FKs (the
-- billing lines + their amounts are kept, just unlinked). Polymorphic job comments
-- and attachments have no FK to jobs, so they are removed explicitly here. The jobs
-- after-delete trigger already records each delete in activity_log.
-- Used by src/lib/rpc.ts deleteJobs() / src/features/jobs/hooks/useDeleteJobs.ts.

create or replace function public.delete_jobs(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_admin'));
  end if;

  -- Polymorphic comments/attachments (parent_type='job') have no FK => delete explicitly.
  delete from public.comments where parent_type = 'job' and parent_id = any(p_ids);
  delete from public.attachments where parent_type = 'job' and parent_id = any(p_ids);

  -- assigned_tasks cascade; monthly_invoice_items + deal_payment_lines set null (existing FKs).
  delete from public.jobs where id = any(p_ids);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_count', v_count);
end;
$$;

grant execute on function public.delete_jobs(uuid[]) to authenticated;

-- Count of billing lines (invoice + payment) referencing a job, for the delete
-- confirmation warning. Admin-only; returns 0 for non-admins.
create or replace function public.job_billing_ref_count(p_job_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case when not public.current_user_is_admin() then 0 else (
    (select count(*) from public.monthly_invoice_items where job_id = p_job_id)
    + (select count(*) from public.deal_payment_lines where job_id = p_job_id)
  )::int end;
$$;

grant execute on function public.job_billing_ref_count(uuid) to authenticated;

-- ROLLBACK:
-- drop function if exists public.delete_jobs(uuid[]);
-- drop function if exists public.job_billing_ref_count(uuid);
