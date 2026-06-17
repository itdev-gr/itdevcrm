-- OPTION A cutover: when a deal is WON, its sold services become JOBS immediately,
-- created OFF the tech boards (stage_id = null, so they never render on a kanban —
-- see kanbanGrouping.ts line 65) until payment. They show in accounting's Jobs &
-- Billing pipeline from day one and carry billing. Payments are still produced by
-- the proven seed_deal_payments (installments/setup/net-basis unchanged); each
-- payment is then LINKED to its job via deal_payment_lines. At Partial/Paid payment,
-- release_jobs_for_deal REUSES these off-board jobs (puts them on the board + applies
-- the existing block rules) instead of creating duplicates — preserving today's
-- "no work before payment" behavior exactly.

-- 1) Create off-board billing jobs from services_planned. Idempotent per (deal, service_type).
create or replace function public.release_billing_jobs_for_deal(target_deal_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case when trim(coalesce(v_country, '')) ilike 'cyprus' then 0.00 else 24.00 end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);
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
end $$;
grant execute on function public.release_billing_jobs_for_deal(uuid) to authenticated;

-- 2) Orchestrator for deal-won: off-board jobs -> proven payment seeding -> link lines.
create or replace function public.seed_deal_jobs_and_payments(target_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.release_billing_jobs_for_deal(target_deal_id);
  perform public.seed_deal_payments(target_deal_id);   -- unchanged: installments, setup, net-basis
  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
  select p.id,
         (select j.id from public.jobs j
           where j.deal_id = p.deal_id and j.service_type = p.service_type and not j.archived
           order by j.created_at limit 1),
         coalesce(p.label, p.service_type), p.amount_net, p.vat_rate
  from public.deal_payments p
  where p.deal_id = target_deal_id
    and not exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id);
end $$;
grant execute on function public.seed_deal_jobs_and_payments(uuid) to authenticated;

-- 3) Repoint the deal AFTER INSERT seed trigger to the orchestrator.
create or replace function public.deal_payments_seed_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_deal_jobs_and_payments(new.id);
  return new;
end $$;

-- 4) Make release_jobs_for_deal REUSE off-board jobs (place on board + block rules)
--    instead of skipping/duplicating. New-insert path kept as a fallback.
create or replace function public.release_jobs_for_deal(target_deal_id uuid, partial_payment_mode boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  d record; service jsonb; service_type_val text; stage_board text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0; should_block boolean;
  existing_job_id uuid; existing_stage uuid;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads') then continue; end if;
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val <> 'web_dev';
    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);
    stage_board := case service_type_val when 'ai_seo' then 'web_seo' else service_type_val end;
    select id into job_stage_id from public.pipeline_stages
      where board = stage_board and archived = false order by position limit 1;

    select id, stage_id into existing_job_id, existing_stage
      from public.jobs where deal_id = d.id and service_type = service_type_val and not archived
      order by created_at limit 1;

    if existing_job_id is not null then
      if existing_stage is null then          -- off-board billing job: place it on the board now
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
        one_time_amount, monthly_amount, setup_fee, amount_net, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0),
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code,
        should_block, case when should_block then 'partial_payment_pending' else null end,
        case when should_block then now() else null end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $$;
grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- ROLLBACK:
-- 1) repoint trigger fn back: create or replace deal_payments_seed_after_insert to `perform public.seed_deal_payments(new.id);`
-- 2) restore release_jobs_for_deal from 20260610000003_release_jobs_first_stage.sql
-- 3) drop function if exists public.seed_deal_jobs_and_payments(uuid);
-- 4) drop function if exists public.release_billing_jobs_for_deal(uuid);
