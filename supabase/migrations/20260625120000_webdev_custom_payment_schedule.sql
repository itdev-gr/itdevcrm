-- Web Dev: one job per website. Adds a custom payment schedule (arbitrary
-- amounts/dates on ONE job) + a confirm-required guardrail against a second
-- web_dev job on the same deal.
--
-- ROLLBACK (manual):
--   alter table public.jobs drop column if exists installment_schedule;
--   then restore the prior bodies of create_custom_job / update_job_billing /
--   generate_payments_for_deal from migration history (the 'custom' branch and
--   p_force / p_installment_schedule params must be dropped to match callers).

alter table public.jobs add column if not exists installment_schedule jsonb;

-- 1) create_custom_job: + p_installment_schedule, + p_force, + 'custom' plan, + guardrail
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false,
  p_installment_plan text default 'none',
  p_installment_schedule jsonb default null,
  p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d public.deals; v_job_id uuid; v_stage uuid; v_owner uuid; v_service text; v_group uuid;
        v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
        v_sched jsonb; v_sched_sum numeric;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if coalesce(p_installment_plan, 'none') not in ('none','50_50','50_25_25','custom') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (p_department = 'web_dev' and not p_billing_only and p_billing_type = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- Guardrail: one Web Dev job per website. A genuinely separate website/add-on
  -- needs p_force = true (driven by a frontend confirm).
  if p_department = 'web_dev' and not p_billing_only and not coalesce(p_force, false)
     and exists (select 1 from public.jobs
                  where deal_id = d.id and service_type = 'web_dev' and not archived) then
    return jsonb_build_object('ok', false, 'errors', array['web_dev_job_exists']);
  end if;

  -- Custom schedule: must be a non-empty array whose parts sum to the total.
  v_sched := null;
  if coalesce(p_installment_plan,'none') = 'custom' then
    if p_installment_schedule is null or jsonb_typeof(p_installment_schedule) <> 'array'
       or jsonb_array_length(p_installment_schedule) = 0 then
      return jsonb_build_object('ok', false, 'errors', array['schedule_required']); end if;
    select coalesce(sum((e->>'amount_net')::numeric), 0) into v_sched_sum
      from jsonb_array_elements(p_installment_schedule) e;
    if round(v_sched_sum, 2) <> round(coalesce(p_amount_net,0), 2) then
      return jsonb_build_object('ok', false, 'errors', array['schedule_total_mismatch']); end if;
    v_sched := p_installment_schedule;
  end if;

  -- AI SEO: billing record + two work cards (VERBATIM from prior definition)
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

  -- Generic path
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
      owner_user_id, started_at, code, installment_plan, installment_schedule)
    values (d.id, d.client_id, v_service, p_billing_type, coalesce(p_amount_net, 0), coalesce(p_vat_rate, 24),
      coalesce(p_setup_fee, 0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      v_group, v_owner, now(), d.code, coalesce(p_installment_plan, 'none'), v_sched)
    returning id into v_job_id;

  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $function$;

-- 2) generate_payments_for_deal: + 'custom' branch, exclude 'custom' from grouped block
create or replace function public.generate_payments_for_deal(target_deal_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date; v_end date; grp record; j record; v_payment_id uuid;
  v_total_cents int; v_alloc int; v_cents int; v_n int; v_i int; v_vat numeric; v_due date;
  elem jsonb;
begin
  select coalesce(actual_close_date, current_date) into v_start from public.deals where id = target_deal_id;
  if v_start is null then v_start := current_date; end if;

  -- Web Dev fixed installments (50_50 / 50_25_25)
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
      if v_i = v_n then v_cents := v_total_cents - v_alloc;
      elsif v_i = 1 then v_cents := round(v_total_cents * 0.5)::int;
      else v_cents := round(v_total_cents * 0.25)::int; end if;
      v_alloc := v_alloc + v_cents;
      v_due := case when v_i = 1 then v_start else null end;
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

  -- Web Dev CUSTOM schedule: one payment per schedule row, using its own due date
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
       and coalesce(jj.installment_plan, 'none') = 'custom'
       and jj.installment_schedule is not null
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and coalesce(l.label, '') <> 'Setup fee')
  loop
    v_vat := coalesce(j.vat_rate, 24);
    v_n := jsonb_array_length(j.installment_schedule);
    v_i := 0;
    for elem in select * from jsonb_array_elements(j.installment_schedule) loop
      v_i := v_i + 1;
      v_due := nullif(elem->>'due_date', '')::date;
      insert into public.deal_payments
        (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
        values (target_deal_id, j.service_type, 'one_time', v_due, v_due, 'pending',
                (elem->>'amount_net')::numeric, v_vat, 'Installment ' || v_i || '/' || v_n)
        returning id into v_payment_id;
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id,
                coalesce(nullif(j.title, ''), j.service_type) || ' (' || v_i || '/' || v_n || ')',
                (elem->>'amount_net')::numeric, v_vat);
    end loop;
  end loop;

  -- Grouped billing (everything else). EXCLUDES web_dev one-time with a plan, incl. 'custom'.
  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key, jb.billing_type
      from public.jobs jb
     where jb.deal_id = target_deal_id and not jb.archived and jb.billing_active
       and jb.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and not (jb.billing_type = 'one_time' and jb.service_type = 'web_dev'
                and coalesce(jb.installment_plan, 'none') in ('50_50', '50_25_25', 'custom'))
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
                  and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25', 'custom'))
         and not exists (select 1 from public.deal_payment_lines l where l.job_id = jj.id)
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;
    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24),
      service_type = (select case when count(distinct j2.service_type) filter (where j2.service_type is not null) = 1
                                  then max(j2.service_type) else null end
                      from public.deal_payment_lines l join public.jobs j2 on j2.id = l.job_id
                      where l.payment_id = p.id)
     where p.id = v_payment_id;
  end loop;

  -- Setup fees (unchanged)
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
end $function$;

-- 3) update_job_billing: + p_installment_schedule, + 'custom' plan, regen on schedule change
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

  select * into v_job from public.jobs where id = p_job_id;
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
