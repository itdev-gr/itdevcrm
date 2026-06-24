-- 20260624040000_create_custom_job_ai_seo_trio.sql
-- AI SEO via accounting now creates 3 rows: ① ai_seo billing record (off-board,
-- holds price) + ② web_seo child + ③ local_seo child (both €0, billing_active=false).
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false,
  p_installment_plan text default 'none')
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; v_job_id uuid; v_stage uuid; v_owner uuid; v_service text; v_group uuid;
        v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if coalesce(p_installment_plan, 'none') not in ('none','50_50','50_25_25') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (p_department = 'web_dev' and not p_billing_only and p_billing_type = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- AI SEO: billing record + two work cards
  if p_department = 'ai_seo' and not p_billing_only then
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, description, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        owner_user_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'ai_seo', p_billing_type, coalesce(p_amount_net,0), coalesce(p_vat_rate,24),
        coalesce(p_setup_fee,0), trim(p_title), p_description, true, true, true, 'active', null, null,
        null, now(), d.code, 'none')
      returning id into v_job_id;

    select id into v_web_stage from public.pipeline_stages where board='web_seo' and not archived order by position limit 1;
    select id into v_web_group from public.groups where code='web_seo';
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'web_seo', p_billing_type, 0, coalesce(p_vat_rate,24), 0,
        'AI SEO — Web', true, false, false, 'active', v_web_stage, v_web_group,
        v_job_id, now(), d.code, 'none');

    select id into v_local_stage from public.pipeline_stages where board='local_seo' and not archived order by position limit 1;
    select id into v_local_group from public.groups where code='local_seo';
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'local_seo', p_billing_type, 0, coalesce(p_vat_rate,24), 0,
        'AI SEO — Local', true, false, false, 'active', v_local_stage, v_local_group,
        v_job_id, now(), d.code, 'none');

    perform public.generate_payments_for_deal(d.id);
    return jsonb_build_object('ok', true, 'job_id', v_job_id);
  end if;

  -- Generic path (unchanged)
  if p_billing_only then
    v_service := 'other';
  else
    v_service := p_department;
    select id into v_stage from public.pipeline_stages
      where board = case when p_department = 'ai_seo' then 'web_seo' else p_department end
        and not archived order by position limit 1;
    v_owner := public.team_lead_for_group(p_department);
    select id into v_group from public.groups where code = p_department;
  end if;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
      title, description, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
      owner_user_id, started_at, code, installment_plan)
    values (d.id, d.client_id, v_service, p_billing_type, coalesce(p_amount_net, 0), coalesce(p_vat_rate, 24),
      coalesce(p_setup_fee, 0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      v_group, v_owner, now(), d.code, coalesce(p_installment_plan, 'none'))
    returning id into v_job_id;

  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $$;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text) to authenticated;

-- ROLLBACK: re-apply the body from 20260619180000_web_dev_installment_plans.sql.
