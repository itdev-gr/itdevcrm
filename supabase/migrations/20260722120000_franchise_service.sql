-- 20260722120000_franchise_service.sql
-- =============================================================================
-- New sellable service type: 'franchise'
-- -----------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-07-22-franchise-service-design.md
--
-- 'franchise' becomes a full service type: three fixed one-time packages, its own
-- kanban board (board='franchise', 8 stages), released as an accounting job on win
-- (owner = franchise team lead), with Web-Dev-style installment plans on the
-- one-time job. The 'franchise' group + permissions + team lead already exist
-- (migration 20260722100000) and are CONSUMED here, not re-created.
--
-- FORWARD (this file):
--   1. Extend 3 service_type CHECK constraints (jobs, service_packages,
--      service_monthly_task_templates) to allow 'franchise'.
--   2. Seed 8 pipeline_stages for board='franchise' (Neo first; terminal 'closed'
--      with outcome 'completed' last, required by end_job). No 'renewal' lane.
--   3. Seed 3 service_packages rows (franchise_branch 50000 / franchise_powered
--      20000 / franchise_wholesale 5000; monthly 0, setup 0; Greek descriptions).
--   4. CREATE OR REPLACE 7 RPCs, each re-emitted from its LIVE pg_get_functiondef
--      pre-image (saved under .superpowers/sdd/pre-franchise-svc-*.sql) with ONLY
--      the franchise addition:
--        - release_billing_jobs_for_deal / release_jobs_for_deal: allow-list + franchise
--        - reconcile_offboard_jobs: off-board allow-list + franchise
--        - accounting_integrity_alerts: off_board_job (#20) service list + franchise
--        - create_custom_job: installment plan gate web_dev -> (web_dev,franchise)
--          (the web_dev_job_exists guardrail stays web_dev-only, unchanged)
--        - generate_payments_for_deal: web_dev fixed-plan + custom-schedule loops
--          and the grouped-block exclusion web_dev -> (web_dev,franchise)
--        - update_job_billing: both web_dev one_time plan gates -> (web_dev,franchise)
--   No monthly-task template row (franchise has no monthly tasks).
--
-- Deliberately NOT changed:
--   - release_deal_jobs: franchise (one_time) falls to the default unblock branch
--     (branch 3), exactly like web_dev; the on-Fully-Paid renewal move is SEO/ads
--     only, so franchise needs no change here.
--   - job_service_abbr: already yields '-FRANCHISE' codes (fallback), no change.
--   - No email automations of any kind (the franchise-source lead gate stays closed).
--
-- Captured LIVE md5 per function full-def (audit; orig pre-image -> modified):
--   release_billing_jobs_for_deal    177c3bf38f38b867abfc0e2848321f1c -> c54c41429a5654d964aab1cb4c1cf490
--   release_jobs_for_deal            f514473aa1a811de710f22834197eb23 -> e67f2420676036b4f862a807c65c9e4a
--   reconcile_offboard_jobs          fc69fc0ed6c633afa9740846eda6e38e -> 48fb2be981b15ba65835b3efb671125d
--   accounting_integrity_alerts      2a8e48ace3cc9301698a8ad088ce55ce -> 5906b8fc9a7ff7c587ae0616fcf8ce84
--   create_custom_job                227ffb3aff1b089aad4b0b957c5eb213 -> c3af19f38b9b9d3f12380d9d7174c24f
--   generate_payments_for_deal       a78231d5a4fd32463be1169ff3418814 -> fcefee886ed76015255898dd7b049025
--   update_job_billing               79ede8b10eb4a54870b19c7304c42b5b -> f1b9280ec67c339cede98b7b03d0e2ac
-- =============================================================================
-- ROLLBACK  (execute the statements inside the block comment below to revert).
-- The CREATE OR REPLACE FUNCTION bodies inside are the CAPTURED PRE-CHANGE
-- ORIGINALS (each matches its 'orig' md5 above).
/*
delete from public.pipeline_stages where board = 'franchise';
delete from public.service_packages where service_type = 'franchise';
-- (leave any 'franchise' jobs / deal_payments as-is; delete per-deal only if ever needed)

alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','other','maintenance']));
alter table public.service_packages drop constraint if exists service_packages_service_type_check;
alter table public.service_packages add constraint service_packages_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance']));
alter table public.service_monthly_task_templates drop constraint if exists service_monthly_task_templates_service_type_check;
alter table public.service_monthly_task_templates add constraint service_monthly_task_templates_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance']));

-- restore the 7 original function bodies (captured live, pre-'franchise'):
CREATE OR REPLACE FUNCTION public.release_billing_jobs_for_deal(target_deal_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_group uuid; v_local_group uuid;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);

    -- AI SEO: off-board billing record + off-board web & local work cards (placed at Fully Paid).
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', null, v_web_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', null, v_local_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      inserted := inserted + 1;
      continue;
    end if;

    select id into v_group from public.groups where code = st;
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        one_time_amount, monthly_amount, setup_fee, title, stage_id, assigned_group_id, owner_user_id,
        status, billing_active, is_custom, started_at, code)
      values (d.id, d.client_id, st, bt, v_amount, v_vat,
        nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
        nullif(service->>'setup_fee','')::numeric, initcap(replace(st, '_', ' ')),
        null, v_group, null,                       -- OFF-BOARD: stage_id null, no owner yet
        'active', true, false, now(), d.code);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$
;

CREATE OR REPLACE FUNCTION public.release_jobs_for_deal(target_deal_id uuid, partial_payment_mode boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; service jsonb; service_type_val text; stage_board text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0; should_block boolean;
  existing_job_id uuid; existing_stage uuid;
  v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid; v_amt numeric;
  v_vat numeric; v_country text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance') then continue; end if;
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- Partial Payment releases ONLY web_dev + hosting; the rest wait for Fully Paid.
    if partial_payment_mode and service_type_val not in ('web_dev','hosting') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val not in ('web_dev','hosting');  -- => false (web_dev/hosting released unblocked)

    -- AI SEO: billing record + two work cards
    if service_type_val = 'ai_seo' then
      select id into existing_job_id from public.jobs
        where deal_id = d.id and service_type = 'ai_seo' and not archived order by created_at limit 1;
      if existing_job_id is not null then continue; end if;
      v_amt := coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0);
      insert into public.jobs (deal_id, client_id, service_type, billing_type, one_time_amount, monthly_amount,
          setup_fee, amount_net, vat_rate, title, is_custom, billing_only, billing_active, status, stage_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', billing_type_val, one_time_amt, monthly_amt, setup_fee_val, v_amt, v_vat,
          'AI SEO', false, true, true, 'active', null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', billing_type_val, 0, v_vat, 'AI SEO — Web', true, false, false, 'active',
          v_web_stage, v_web_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', billing_type_val, 0, v_vat, 'AI SEO — Local', true, false, false, 'active',
          v_local_stage, v_local_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      inserted := inserted + 1;
      continue;
    end if;

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);
    stage_board := service_type_val;
    select id into job_stage_id from public.pipeline_stages
      where board = stage_board and archived = false order by position limit 1;

    select id, stage_id into existing_job_id, existing_stage
      from public.jobs where deal_id = d.id and service_type = service_type_val and billing_type = billing_type_val and not archived
      order by created_at limit 1;

    if existing_job_id is not null then
      if existing_stage is null then
        update public.jobs set
          stage_id = job_stage_id,
          owner_user_id = coalesce(owner_user_id, owner_id_val),
          assigned_group_id = coalesce(assigned_group_id, group_id_val),
          is_blocked = should_block,
          blocked_reason = case when should_block then 'partial_payment_pending' else blocked_reason end,
          blocked_at = case when should_block then now() else blocked_at end
        where id = existing_job_id;
        inserted := inserted + 1;
      end if;
      continue;
    end if;

    insert into public.jobs (deal_id, client_id, service_type, billing_type,
        one_time_amount, monthly_amount, setup_fee, amount_net, vat_rate, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0), v_vat,
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code,
        should_block, case when should_block then 'partial_payment_pending' else null end,
        case when should_block then now() else null end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_offboard_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_stage uuid; n int := 0;
begin
  for r in
    select j.id, j.service_type
      from public.jobs j
      join public.deals d on d.id = j.deal_id
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived
       and j.status = 'active'
       and coalesce(j.billing_only, false) = false
       and j.stage_id is null
       and ps.code = 'paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance')
  loop
    -- Place on the job's own board, in its first (entry) stage.
    select id into v_stage from public.pipeline_stages
      where board = r.service_type and not archived order by position limit 1;
    if v_stage is not null then
      update public.jobs set stage_id = v_stage where id = r.id and stage_id is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.accounting_integrity_alerts()
 RETURNS TABLE(check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts (check_key, severity, category, subject_type,
               subject_id, subject_code, title, detail,
               deal_id, job_id, signature) as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing (Cyprus + UAE are legit 0%-VAT countries)
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not a 0%-VAT country (Cyprus/UAE) and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
       and coalesce(c.country,'') not ilike 'united arab emirates'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap: recurring billing has STALLED — no period covers today.
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring billing has stalled',
           'No billing period covers today (schedule lapsed)', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled'
                        and p.start_date <= current_date and p.end_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, coalesce(c.code, left(c.id::text,8)), 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
    union all
    -- 15 cash_deal_with_vat: deal chose cash + no-VAT, yet a job still charges VAT
    select 'cash_deal_with_vat','amber','possible_mistakes','job', j.id, j.code,
           'Cash deal but VAT charged',
           'Deal is cash + no-VAT, but this job has VAT '||j.vat_rate::text||'%',
           j.deal_id, j.id, j.vat_rate::text
      from jobs j join deals d on d.id=j.deal_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0
       and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)
    union all
    -- 16 duplicate_vat_number: two+ active clients share a VAT number
    select 'duplicate_vat_number','amber','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Duplicate VAT number', 'VAT '||c.vat_number||' is shared by another client',
           null::uuid, null::uuid, c.vat_number
      from clients c
     where not c.archived and nullif(trim(coalesce(c.vat_number,'')),'') is not null
       and exists (select 1 from clients c2 where c2.id<>c.id and not c2.archived
                    and trim(coalesce(c2.vat_number,''))=trim(c.vat_number))
    union all
    -- 17 deal_value_mismatch: deal's monthly value != sum of its recurring job amounts
    select 'deal_value_mismatch','grey','possible_mistakes','deal', d.id, d.code,
           'Deal value differs from its jobs',
           'Monthly value E'||coalesce(d.recurring_monthly_value,0)::text||' vs jobs E'||js.jobsum::text,
           d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
      join lateral (select coalesce(sum(j.amount_net),0) as jobsum from jobs j
                     where j.deal_id=d.id and not j.archived and j.billing_active
                       and j.billing_type in ('recurring_monthly','recurring_yearly')) js on true
     where not d.archived and ps.code not in ('closed','done')
       and js.jobsum>0 and coalesce(d.recurring_monthly_value,0)>0
       and abs(coalesce(d.recurring_monthly_value,0)-js.jobsum)>=1
    union all
    -- 18 large_recurring_amount: an unusually large recurring amount (possible typo)
    select 'large_recurring_amount','grey','possible_mistakes','job', j.id, j.code,
           'Unusually large recurring amount', 'Recurring E'||j.amount_net::text||' / period',
           j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)>3000
    union all
    -- 19 test_client_name: client name looks like a test/placeholder
    select 'test_client_name','grey','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Test-looking client name', 'Client name: '||c.name, null::uuid, null::uuid, ''
      from clients c
     where not c.archived and coalesce(c.status,'')<>'done'
       and (c.name ilike '%test%' or c.name ilike '%δοκιμ%' or c.name ilike '%asdf%'
            or c.name ilike '%xxx%' or c.name ilike '%qwerty%')
    union all
    -- 20 off_board_job: active service job on a Paid-In-Full deal with no board stage
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance')
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_custom_job(p_deal_id uuid, p_title text, p_description text, p_department text, p_billing_type text, p_amount_net numeric, p_vat_rate numeric, p_setup_fee numeric DEFAULT 0, p_billing_only boolean DEFAULT false, p_installment_plan text DEFAULT 'none'::text, p_installment_schedule jsonb DEFAULT NULL::jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.generate_payments_for_deal(target_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.update_job_billing(p_job_id uuid, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_amount_net numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT NULL::numeric, p_billing_type text DEFAULT NULL::text, p_billing_group_id uuid DEFAULT NULL::uuid, p_clear_group boolean DEFAULT false, p_installment_plan text DEFAULT NULL::text, p_installment_schedule jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
*/
-- =============================================================================
-- FORWARD MIGRATION
-- =============================================================================

-- 1. service_type CHECK constraints -------------------------------------------
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','other','maintenance','franchise']));

alter table public.service_packages drop constraint if exists service_packages_service_type_check;
alter table public.service_packages add constraint service_packages_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise']));

alter table public.service_monthly_task_templates drop constraint if exists service_monthly_task_templates_service_type_check;
alter table public.service_monthly_task_templates add constraint service_monthly_task_templates_service_type_check check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise']));

-- 2. pipeline_stages for board='franchise' (8 rows; terminal 'closed'/completed) --
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome)
select 'franchise', v.code, v.display_names::jsonb, v.position, v.is_terminal, v.terminal_outcome
from (values
  ('neo',       '{"en":"New","el":"Νέο"}',                10, false, null::text),
  ('training',  '{"en":"Training","el":"Εκπαίδευση"}',    20, false, null),
  ('setup',     '{"en":"Setup","el":"Setup"}',            30, false, null),
  ('active',    '{"en":"Active","el":"Ενεργό"}',          40, false, null),
  ('completed', '{"en":"Completed","el":"Ολοκληρωμένο"}', 50, false, null),
  ('on_hold',   '{"en":"On Hold","el":"Σε Αναμονή"}',     60, false, null),
  ('cancelled', '{"en":"Cancelled","el":"Ακυρωμένο"}',    70, true,  null),
  ('closed',    '{"en":"Closed","el":"Κλειστό"}',         80, true,  'completed')
) as v(code, display_names, position, is_terminal, terminal_outcome)
where not exists (select 1 from public.pipeline_stages where board = 'franchise');

-- 3. service_packages: 3 fixed one-time franchise packages ---------------------
insert into public.service_packages (service_type, code, display_names, default_one_time_amount, default_monthly_amount, setup_fee, description, subtitle, sort_order, is_active)
select 'franchise', v.code, v.display_names::jsonb, v.one_time, 0, 0, v.description, v.subtitle, v.sort_order, true
from (values
  ('franchise_branch',    '{"en":"IT DEV Branch","el":"IT DEV Branch"}',       50000, 'Πλήρες franchise με δικό σου brand, περιοχή και ολόκληρο το σύστημα IT DEV.', null,          1),
  ('franchise_powered',   '{"en":"Powered by IT DEV","el":"Powered by IT DEV"}', 20000, 'Το δικό σου brand με έτοιμες πωλήσεις, εργαλεία και παράδοση από την ομάδα μας.', 'ΔΗΜΟΦΙΛΕΣ', 2),
  ('franchise_wholesale', '{"en":"Wholesale Partner","el":"Wholesale Partner"}',  5000, 'Χονδρική συνεργασία για δίκτυα και συνεργάτες που θέλουν να ξεκινήσουν απλά.', null,          3)
) as v(code, display_names, one_time, description, subtitle, sort_order)
where not exists (select 1 from public.service_packages where service_type = 'franchise');

-- 4. RPCs — LIVE bodies re-emitted with ONLY 'franchise' added -----------------
CREATE OR REPLACE FUNCTION public.release_billing_jobs_for_deal(target_deal_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_group uuid; v_local_group uuid;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);

    -- AI SEO: off-board billing record + off-board web & local work cards (placed at Fully Paid).
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', null, v_web_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', null, v_local_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      inserted := inserted + 1;
      continue;
    end if;

    select id into v_group from public.groups where code = st;
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        one_time_amount, monthly_amount, setup_fee, title, stage_id, assigned_group_id, owner_user_id,
        status, billing_active, is_custom, started_at, code)
      values (d.id, d.client_id, st, bt, v_amount, v_vat,
        nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
        nullif(service->>'setup_fee','')::numeric, initcap(replace(st, '_', ' ')),
        null, v_group, null,                       -- OFF-BOARD: stage_id null, no owner yet
        'active', true, false, now(), d.code);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$
;

CREATE OR REPLACE FUNCTION public.release_jobs_for_deal(target_deal_id uuid, partial_payment_mode boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; service jsonb; service_type_val text; stage_board text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0; should_block boolean;
  existing_job_id uuid; existing_stage uuid;
  v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid; v_amt numeric;
  v_vat numeric; v_country text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise') then continue; end if;
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- Partial Payment releases ONLY web_dev + hosting; the rest wait for Fully Paid.
    if partial_payment_mode and service_type_val not in ('web_dev','hosting') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val not in ('web_dev','hosting');  -- => false (web_dev/hosting released unblocked)

    -- AI SEO: billing record + two work cards
    if service_type_val = 'ai_seo' then
      select id into existing_job_id from public.jobs
        where deal_id = d.id and service_type = 'ai_seo' and not archived order by created_at limit 1;
      if existing_job_id is not null then continue; end if;
      v_amt := coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0);
      insert into public.jobs (deal_id, client_id, service_type, billing_type, one_time_amount, monthly_amount,
          setup_fee, amount_net, vat_rate, title, is_custom, billing_only, billing_active, status, stage_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', billing_type_val, one_time_amt, monthly_amt, setup_fee_val, v_amt, v_vat,
          'AI SEO', false, true, true, 'active', null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', billing_type_val, 0, v_vat, 'AI SEO — Web', true, false, false, 'active',
          v_web_stage, v_web_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', billing_type_val, 0, v_vat, 'AI SEO — Local', true, false, false, 'active',
          v_local_stage, v_local_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      inserted := inserted + 1;
      continue;
    end if;

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);
    stage_board := service_type_val;
    select id into job_stage_id from public.pipeline_stages
      where board = stage_board and archived = false order by position limit 1;

    select id, stage_id into existing_job_id, existing_stage
      from public.jobs where deal_id = d.id and service_type = service_type_val and billing_type = billing_type_val and not archived
      order by created_at limit 1;

    if existing_job_id is not null then
      if existing_stage is null then
        update public.jobs set
          stage_id = job_stage_id,
          owner_user_id = coalesce(owner_user_id, owner_id_val),
          assigned_group_id = coalesce(assigned_group_id, group_id_val),
          is_blocked = should_block,
          blocked_reason = case when should_block then 'partial_payment_pending' else blocked_reason end,
          blocked_at = case when should_block then now() else blocked_at end
        where id = existing_job_id;
        inserted := inserted + 1;
      end if;
      continue;
    end if;

    insert into public.jobs (deal_id, client_id, service_type, billing_type,
        one_time_amount, monthly_amount, setup_fee, amount_net, vat_rate, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0), v_vat,
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code,
        should_block, case when should_block then 'partial_payment_pending' else null end,
        case when should_block then now() else null end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_offboard_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_stage uuid; n int := 0;
begin
  for r in
    select j.id, j.service_type
      from public.jobs j
      join public.deals d on d.id = j.deal_id
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived
       and j.status = 'active'
       and coalesce(j.billing_only, false) = false
       and j.stage_id is null
       and ps.code = 'paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance','franchise')
  loop
    -- Place on the job's own board, in its first (entry) stage.
    select id into v_stage from public.pipeline_stages
      where board = r.service_type and not archived order by position limit 1;
    if v_stage is not null then
      update public.jobs set stage_id = v_stage where id = r.id and stage_id is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.accounting_integrity_alerts()
 RETURNS TABLE(check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts (check_key, severity, category, subject_type,
               subject_id, subject_code, title, detail,
               deal_id, job_id, signature) as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing (Cyprus + UAE are legit 0%-VAT countries)
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not a 0%-VAT country (Cyprus/UAE) and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
       and coalesce(c.country,'') not ilike 'united arab emirates'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap: recurring billing has STALLED — no period covers today.
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring billing has stalled',
           'No billing period covers today (schedule lapsed)', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled'
                        and p.start_date <= current_date and p.end_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, coalesce(c.code, left(c.id::text,8)), 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
    union all
    -- 15 cash_deal_with_vat: deal chose cash + no-VAT, yet a job still charges VAT
    select 'cash_deal_with_vat','amber','possible_mistakes','job', j.id, j.code,
           'Cash deal but VAT charged',
           'Deal is cash + no-VAT, but this job has VAT '||j.vat_rate::text||'%',
           j.deal_id, j.id, j.vat_rate::text
      from jobs j join deals d on d.id=j.deal_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0
       and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)
    union all
    -- 16 duplicate_vat_number: two+ active clients share a VAT number
    select 'duplicate_vat_number','amber','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Duplicate VAT number', 'VAT '||c.vat_number||' is shared by another client',
           null::uuid, null::uuid, c.vat_number
      from clients c
     where not c.archived and nullif(trim(coalesce(c.vat_number,'')),'') is not null
       and exists (select 1 from clients c2 where c2.id<>c.id and not c2.archived
                    and trim(coalesce(c2.vat_number,''))=trim(c.vat_number))
    union all
    -- 17 deal_value_mismatch: deal's monthly value != sum of its recurring job amounts
    select 'deal_value_mismatch','grey','possible_mistakes','deal', d.id, d.code,
           'Deal value differs from its jobs',
           'Monthly value E'||coalesce(d.recurring_monthly_value,0)::text||' vs jobs E'||js.jobsum::text,
           d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
      join lateral (select coalesce(sum(j.amount_net),0) as jobsum from jobs j
                     where j.deal_id=d.id and not j.archived and j.billing_active
                       and j.billing_type in ('recurring_monthly','recurring_yearly')) js on true
     where not d.archived and ps.code not in ('closed','done')
       and js.jobsum>0 and coalesce(d.recurring_monthly_value,0)>0
       and abs(coalesce(d.recurring_monthly_value,0)-js.jobsum)>=1
    union all
    -- 18 large_recurring_amount: an unusually large recurring amount (possible typo)
    select 'large_recurring_amount','grey','possible_mistakes','job', j.id, j.code,
           'Unusually large recurring amount', 'Recurring E'||j.amount_net::text||' / period',
           j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)>3000
    union all
    -- 19 test_client_name: client name looks like a test/placeholder
    select 'test_client_name','grey','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Test-looking client name', 'Client name: '||c.name, null::uuid, null::uuid, ''
      from clients c
     where not c.archived and coalesce(c.status,'')<>'done'
       and (c.name ilike '%test%' or c.name ilike '%δοκιμ%' or c.name ilike '%asdf%'
            or c.name ilike '%xxx%' or c.name ilike '%qwerty%')
    union all
    -- 20 off_board_job: active service job on a Paid-In-Full deal with no board stage
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance','franchise')
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_custom_job(p_deal_id uuid, p_title text, p_description text, p_department text, p_billing_type text, p_amount_net numeric, p_vat_rate numeric, p_setup_fee numeric DEFAULT 0, p_billing_only boolean DEFAULT false, p_installment_plan text DEFAULT 'none'::text, p_installment_schedule jsonb DEFAULT NULL::jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and not (p_department in ('web_dev','franchise') and not p_billing_only and p_billing_type = 'one_time') then
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
end $function$
;

CREATE OR REPLACE FUNCTION public.generate_payments_for_deal(target_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and jj.billing_type = 'one_time' and jj.service_type in ('web_dev','franchise')
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
       and jj.billing_type = 'one_time' and jj.service_type in ('web_dev','franchise')
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
       and not (jb.billing_type = 'one_time' and jb.service_type in ('web_dev','franchise')
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
         and not (jj.billing_type = 'one_time' and jj.service_type in ('web_dev','franchise')
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
end $function$
;

CREATE OR REPLACE FUNCTION public.update_job_billing(p_job_id uuid, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_amount_net numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT NULL::numeric, p_billing_type text DEFAULT NULL::text, p_billing_group_id uuid DEFAULT NULL::uuid, p_clear_group boolean DEFAULT false, p_installment_plan text DEFAULT NULL::text, p_installment_schedule jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (v_job.service_type in ('web_dev','franchise') and v_new_billing = 'one_time') then
    v_new_plan := 'none';
  end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (v_job.service_type in ('web_dev','franchise') and v_new_billing = 'one_time') then
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
end $function$
;
