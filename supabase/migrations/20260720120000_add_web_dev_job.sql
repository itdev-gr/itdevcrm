-- 20260720120000_add_web_dev_job.sql
-- Spec: docs/superpowers/specs/2026-07-20-multi-webdev-jobs-design.md
--
-- Sanctioned path for additional websites on a deal (web_dev job = a website):
-- creates a WORK-ONLY web_dev job — no payments now or later. installment_plan
-- 'custom' with a NULL installment_schedule is skipped by every branch of
-- generate_payments_for_deal (custom branch requires schedule not null; the
-- grouped branch excludes web_dev one_time with plan in 50_50/50_25_25/custom),
-- so deal-wide payment regeneration never bills this job until accounting
-- attaches billing via update_job_billing. Code auto-suffixes (-WEBDEV-2, …)
-- via the jobs_set_code trigger; jobs_seed_web_dev_info is fill-empty-only so
-- the explicit website wins and a blank industry inherits the client's.
--
-- ROLLBACK:
--   drop function if exists public.add_web_dev_job(uuid, text, text);

create or replace function public.add_web_dev_job(
  p_deal_id uuid, p_website text, p_industry text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d public.deals; v_job_id uuid; v_code text; v_stage uuid; v_owner uuid;
        v_group uuid; v_site text; v_details jsonb;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  v_site := nullif(trim(coalesce(p_website, '')), '');
  if v_site is null then
    return jsonb_build_object('ok', false, 'errors', array['website_required']); end if;

  v_details := jsonb_build_object('website', v_site);
  if nullif(trim(coalesce(p_industry, '')), '') is not null then
    v_details := v_details || jsonb_build_object('industry', trim(p_industry));
  end if;

  select id into v_stage from public.pipeline_stages
    where board = 'web_dev' and not archived order by position limit 1;
  v_owner := public.team_lead_for_group('web_dev');
  select id into v_group from public.groups where code = 'web_dev';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net,
      vat_rate, setup_fee, title, is_custom, billing_only, billing_active, status,
      stage_id, assigned_group_id, owner_user_id, started_at, code, installment_plan,
      details)
    values (d.id, d.client_id, 'web_dev', 'one_time', 0, 24, 0,
      regexp_replace(regexp_replace(v_site, '^https?://', ''), '/+$', ''),
      true, false, true, 'active', v_stage, v_group, v_owner, now(), d.code,
      'custom', v_details)
    returning id, code into v_job_id, v_code;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'code', v_code);
end $function$;

revoke all on function public.add_web_dev_job(uuid, text, text) from public, anon;
grant execute on function public.add_web_dev_job(uuid, text, text) to authenticated;
