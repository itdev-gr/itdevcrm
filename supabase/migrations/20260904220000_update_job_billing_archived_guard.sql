-- =============================================================================
-- 20260904220000_update_job_billing_archived_guard.sql
-- Final-review I4: JobsBillingPanel's "Bill separately" dropdown offers every
-- same-cadence job as a pairing target regardless of `archived`, and
-- update_job_billing had no server-side guard against writing to an archived
-- row — so a stray client bug (or a direct RPC call) could silently attach an
-- archived, read-only-in-the-UI job to a live billing group. The frontend gate
-- is fixed separately (JobsBillingPanel only offers non-archived pairTargets);
-- this closes the same hole at the RPC, matching the pattern
-- convert_job_service_type already uses for its payment re-key arm.
--
-- 20260625120000_webdev_custom_payment_schedule.sql is long-since applied to
-- prod, so this patches the live function with a NEW migration rather than
-- editing that file. Body is verbatim from that file (the current, still-live
-- definition — confirmed no later migration touches update_job_billing) with
-- one line changed: `where id = p_job_id` -> `where id = p_job_id and not archived`.
-- =============================================================================

create or replace function public.update_job_billing(
  p_job_id uuid, p_title text default null, p_description text default null,
  p_amount_net numeric default null, p_vat_rate numeric default null,
  p_billing_type text default null, p_billing_group_id uuid default null,
  p_clear_group boolean default false, p_installment_plan text default null,
  p_installment_schedule jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_new_billing text; v_new_amount numeric; v_new_plan text;
  v_new_sched jsonb; v_sched_sum numeric; v_regen boolean := false;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  if p_billing_type is not null and p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if p_installment_plan is not null and p_installment_plan not in ('none','50_50','50_25_25','custom') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;

  -- Archived is read-only history (owner decision): reject the write outright
  -- instead of silently succeeding on a service that already ended.
  select * into v_job from public.jobs where id = p_job_id and not archived;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  v_new_billing := coalesce(p_billing_type, v_job.billing_type);
  v_new_amount  := coalesce(p_amount_net, v_job.amount_net);
  v_new_plan    := coalesce(p_installment_plan, v_job.installment_plan, 'none');
  if not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    v_new_plan := 'none';
  end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- Resolve the schedule for a custom plan; validate it sums to the new amount.
  if v_new_plan = 'custom' then
    v_new_sched := coalesce(p_installment_schedule, v_job.installment_schedule);
    if v_new_sched is null or jsonb_typeof(v_new_sched) <> 'array' or jsonb_array_length(v_new_sched) = 0 then
      return jsonb_build_object('ok', false, 'errors', array['schedule_required']); end if;
    select coalesce(sum((e->>'amount_net')::numeric), 0) into v_sched_sum
      from jsonb_array_elements(v_new_sched) e;
    if round(v_sched_sum, 2) <> round(coalesce(v_new_amount,0), 2) then
      return jsonb_build_object('ok', false, 'errors', array['schedule_total_mismatch']); end if;
  else
    v_new_sched := null;
  end if;

  v_regen := (coalesce(v_new_plan, 'none') <> 'none' or coalesce(v_job.installment_plan, 'none') <> 'none')
             and (v_new_amount is distinct from v_job.amount_net
                  or coalesce(v_new_plan, 'none') is distinct from coalesce(v_job.installment_plan, 'none')
                  or v_new_billing is distinct from v_job.billing_type
                  or (v_new_plan = 'custom' and p_installment_schedule is not null
                      and p_installment_schedule is distinct from v_job.installment_schedule));

  if v_regen and exists (
    select 1 from public.deal_payments p
      join public.deal_payment_lines l on l.payment_id = p.id
     where l.job_id = p_job_id and (p.status = 'paid' or p.invoice_number is not null)
  ) then
    return jsonb_build_object('ok', false, 'errors', array['cannot_replan_paid_installment']);
  end if;

  update public.jobs set
    title              = coalesce(p_title, title),
    description        = coalesce(p_description, description),
    amount_net         = coalesce(p_amount_net, amount_net),
    vat_rate           = coalesce(p_vat_rate, vat_rate),
    billing_type       = coalesce(p_billing_type, billing_type),
    installment_plan   = v_new_plan,
    installment_schedule = v_new_sched,
    billing_group_id   = case when p_clear_group then null else coalesce(p_billing_group_id, billing_group_id) end,
    updated_at         = now()
   where id = p_job_id;

  if v_regen then
    delete from public.deal_payments p
     where p.deal_id = v_job.deal_id
       and exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id and l.job_id = p_job_id);
    perform public.generate_payments_for_deal(v_job.deal_id);
  end if;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $function$;

-- Signature is unchanged (create or replace only) so the existing grant stays
-- valid; re-asserted here defensively.
grant execute on function public.update_job_billing(
  uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb) to authenticated;

-- ROLLBACK: re-run 20260625120000_webdev_custom_payment_schedule.sql's
-- `create or replace function public.update_job_billing(...)` block verbatim
-- (drops the `and not archived` guard; everything else identical).
