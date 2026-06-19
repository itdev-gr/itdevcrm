-- Web-dev installment plans: split a one-time web_dev price into 50/50 or
-- 50/25/25 payments. Installment #1 (deposit) is dated at the deal start; the
-- remaining installments are date-less, so they never show overdue until
-- accounting dates them when invoicing that milestone. The last installment
-- absorbs the cent remainder so the parts sum exactly to the job's net price.

-- 1) Plan field on the job (only meaningful for one_time web_dev jobs).
alter table public.jobs
  add column if not exists installment_plan text not null default 'none';
alter table public.jobs drop constraint if exists jobs_installment_plan_check;
alter table public.jobs add constraint jobs_installment_plan_check
  check (installment_plan in ('none', '50_50', '50_25_25'));

-- 2) Payment generation: split installment jobs into N payments; everything
--    else unchanged from 20260617000010_generate_payments_for_deal.
create or replace function public.generate_payments_for_deal(target_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_start date;
  v_end date;
  grp record;
  j record;
  v_payment_id uuid;
  -- installment locals (cents-based to mirror the TS splitInstallments helper)
  v_total_cents int;
  v_alloc int;
  v_cents int;
  v_n int;
  v_i int;
  v_vat numeric;
  v_due date;
begin
  select coalesce(actual_close_date, current_date) into v_start from public.deals where id = target_deal_id;
  if v_start is null then v_start := current_date; end if;

  -- 0) Installment plans: one_time web_dev jobs split into N payments.
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
       and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25')
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and coalesce(l.label, '') <> 'Setup fee')
  loop
    v_vat := coalesce(j.vat_rate, 24);
    v_total_cents := round(coalesce(j.amount_net, 0) * 100)::int;
    v_n := case j.installment_plan when '50_25_25' then 3 else 2 end;
    v_alloc := 0;
    for v_i in 1..v_n loop
      if v_i = v_n then
        v_cents := v_total_cents - v_alloc;            -- last absorbs the remainder
      elsif v_i = 1 then
        v_cents := round(v_total_cents * 0.5)::int;    -- deposit = 50%
      else
        v_cents := round(v_total_cents * 0.25)::int;   -- middle = 25%
      end if;
      v_alloc := v_alloc + v_cents;
      v_due := case when v_i = 1 then v_start else null end;  -- deposit dated; rest date-less

      insert into public.deal_payments
        (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
        values (target_deal_id, j.service_type, 'one_time', v_due, v_due, 'pending',
                v_cents / 100.0, v_vat, 'Installment ' || v_i || '/' || v_n)
        returning id into v_payment_id;
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id,
                coalesce(nullif(j.title, ''), j.service_type) || ' (' || v_i || '/' || v_n || ')',
                v_cents / 100.0, v_vat);
    end loop;
  end loop;

  -- 1) Main charges, grouped (together) or solo (separate), per billing_type.
  --    Installment jobs handled above are excluded here.
  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key, jb.billing_type
      from public.jobs jb
     where jb.deal_id = target_deal_id and not jb.archived and jb.billing_active
       and jb.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and not (jb.billing_type = 'one_time' and jb.service_type = 'web_dev'
                and coalesce(jb.installment_plan, 'none') in ('50_50', '50_25_25'))
       and not exists (select 1 from public.deal_payment_lines l where l.job_id = jb.id)
     group by coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text), jb.billing_type
  loop
    v_end := case grp.billing_type
               when 'recurring_monthly' then (v_start + interval '1 month')::date
               when 'recurring_yearly'  then (v_start + interval '1 year')::date
               else v_start end;

    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, null, grp.billing_type, v_start, v_end, 'pending', 0, 24)
      returning id into v_payment_id;

    for j in
      select * from public.jobs jj
       where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
         and jj.billing_type = grp.billing_type
         and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key
         and not (jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
                  and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25'))
         and not exists (select 1 from public.deal_payment_lines l where l.job_id = jj.id)
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;

    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
     where p.id = v_payment_id;
  end loop;

  -- 2) Setup fees: own one-time header per job, so they never recur.
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and coalesce(jj.setup_fee, 0) > 0
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and l.label = 'Setup fee')
  loop
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, j.service_type, 'one_time', v_start, v_start, 'pending', j.setup_fee, coalesce(j.vat_rate, 24))
      returning id into v_payment_id;
    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id, j.id, 'Setup fee', j.setup_fee, coalesce(j.vat_rate, 24));
  end loop;
end $$;
grant execute on function public.generate_payments_for_deal(uuid) to authenticated;

-- 3) create_custom_job: accept + validate + store the plan (web_dev one_time only).
drop function if exists public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean);
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false,
  p_installment_plan text default 'none')
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
  if coalesce(p_installment_plan, 'none') not in ('none','50_50','50_25_25') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (p_department = 'web_dev' and not p_billing_only and p_billing_type = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

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

-- 4) update_job_billing: accept the plan; regenerate the job's PENDING payments
--    when price/plan/cadence change. Reject if any installment is already
--    paid or invoiced (never rewrite billed history).
drop function if exists public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean);
create or replace function public.update_job_billing(
  p_job_id uuid, p_title text default null, p_description text default null,
  p_amount_net numeric default null, p_vat_rate numeric default null,
  p_billing_type text default null, p_billing_group_id uuid default null,
  p_clear_group boolean default false, p_installment_plan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.jobs;
  v_new_billing text;
  v_new_amount numeric;
  v_new_plan text;
  v_regen boolean := false;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  if p_billing_type is not null and p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if p_installment_plan is not null and p_installment_plan not in ('none','50_50','50_25_25') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  -- Effective values after this update.
  v_new_billing := coalesce(p_billing_type, v_job.billing_type);
  v_new_amount  := coalesce(p_amount_net, v_job.amount_net);
  v_new_plan    := coalesce(p_installment_plan, v_job.installment_plan, 'none');
  -- A plan only applies to one_time web_dev jobs; force it off otherwise.
  if not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    v_new_plan := 'none';
  end if;
  -- Reject an explicit plan request on a non-eligible job.
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- Regenerate when an installment plan is involved (now or before) and the
  -- price, plan, or cadence actually changed.
  v_regen := (coalesce(v_new_plan, 'none') <> 'none' or coalesce(v_job.installment_plan, 'none') <> 'none')
             and (v_new_amount is distinct from v_job.amount_net
                  or coalesce(v_new_plan, 'none') is distinct from coalesce(v_job.installment_plan, 'none')
                  or v_new_billing is distinct from v_job.billing_type);

  if v_regen and exists (
    select 1 from public.deal_payments p
      join public.deal_payment_lines l on l.payment_id = p.id
     where l.job_id = p_job_id and (p.status = 'paid' or p.invoice_number is not null)
  ) then
    return jsonb_build_object('ok', false, 'errors', array['cannot_replan_paid_installment']);
  end if;

  update public.jobs set
    title            = coalesce(p_title, title),
    description      = coalesce(p_description, description),
    amount_net       = coalesce(p_amount_net, amount_net),
    vat_rate         = coalesce(p_vat_rate, vat_rate),
    billing_type     = coalesce(p_billing_type, billing_type),
    installment_plan = v_new_plan,
    billing_group_id = case when p_clear_group then null else coalesce(p_billing_group_id, billing_group_id) end,
    updated_at       = now()
   where id = p_job_id;

  if v_regen then
    -- Drop the job's existing (unpaid) payments — solo headers, lines cascade —
    -- then regenerate from the new price + plan.
    delete from public.deal_payments p
     where p.deal_id = v_job.deal_id
       and exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id and l.job_id = p_job_id);
    perform public.generate_payments_for_deal(v_job.deal_id);
  end if;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
grant execute on function public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text) to authenticated;

-- ROLLBACK:
-- (restore prior signatures from 20260617000011 + 20260617000010, then:)
-- drop function if exists public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text);
-- drop function if exists public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text);
-- alter table public.jobs drop constraint if exists jobs_installment_plan_check;
-- alter table public.jobs drop column if exists installment_plan;
