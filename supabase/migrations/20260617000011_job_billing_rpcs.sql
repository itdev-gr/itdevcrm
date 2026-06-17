-- Allow a billing-only "other" department (no board) alongside the 7 service boards.
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check
  check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','other']));

-- Accounting self-serve job management (SECURITY DEFINER, mirrors block_job's gating)
-- so accounting needs no direct jobs-table mutate rights.

-- Create a custom job: title/price/cadence/department; one-time or recurring; optional
-- billing-only (no board). Generates its payment(s) immediately.
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; v_job_id uuid; v_stage uuid; v_owner uuid; v_service text; v_group uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;

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
      owner_user_id, started_at, code)
    values (d.id, d.client_id, v_service, p_billing_type, coalesce(p_amount_net, 0), coalesce(p_vat_rate, 24),
      coalesce(p_setup_fee, 0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      v_group, v_owner, now(), d.code)
    returning id into v_job_id;

  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $$;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean) to authenticated;

-- Update a job's billing (title/desc/price/vat/cadence/group). Does NOT rewrite already
-- issued/paid payments; future generation/renewal uses the new values.
create or replace function public.update_job_billing(
  p_job_id uuid, p_title text default null, p_description text default null,
  p_amount_net numeric default null, p_vat_rate numeric default null,
  p_billing_type text default null, p_billing_group_id uuid default null,
  p_clear_group boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  if p_billing_type is not null and p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  update public.jobs set
    title            = coalesce(p_title, title),
    description      = coalesce(p_description, description),
    amount_net       = coalesce(p_amount_net, amount_net),
    vat_rate         = coalesce(p_vat_rate, vat_rate),
    billing_type     = coalesce(p_billing_type, billing_type),
    billing_group_id = case when p_clear_group then null else coalesce(p_billing_group_id, billing_group_id) end,
    updated_at       = now()
   where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;
  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
grant execute on function public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean) to authenticated;

-- End a job: stops recurring generation (billing_active=false) and marks it completed.
create or replace function public.end_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
   where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;
  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
grant execute on function public.end_job(uuid) to authenticated;

-- ROLLBACK:
-- drop function if exists public.end_job(uuid);
-- drop function if exists public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean);
-- drop function if exists public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean);
-- alter table public.jobs drop constraint if exists jobs_service_type_check;
-- alter table public.jobs add constraint jobs_service_type_check
--   check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads']));
