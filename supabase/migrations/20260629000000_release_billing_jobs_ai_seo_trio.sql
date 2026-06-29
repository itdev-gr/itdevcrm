-- 20260629000000_release_billing_jobs_ai_seo_trio.sql
-- ROOT-CAUSE FIX: AI SEO deals won through the normal sales pipeline never got
-- their Web/Local SEO work cards.
--
-- release_billing_jobs_for_deal() runs on deal INSERT (deals_seed_payments ->
-- deal_payments_seed_after_insert -> seed_deal_jobs_and_payments) and seeds the
-- off-board billing jobs from services_planned. It was written 2026-06-17, BEFORE
-- the 2026-06-24 AI SEO 3-row split, and still emits a SINGLE ai_seo job. The
-- split-aware release_jobs_for_deal() can't repair that later because its ai_seo
-- branch skips any deal that already has an ai_seo job (dedup guard,
-- 20260624050000:31-33). Net effect: any deal with services_planned populated at
-- INSERT (i.e. every normal won deal) with an ai_seo service gets one un-split
-- ai_seo job and the Web/Local SEO teams never get a work card.
-- Confirmed on deal 001089 (job a8e02f2c-4f03-48a6-aba4-e1759702ee8a),
-- created 2026-06-25T16:14:39 == the deal's INSERT timestamp, billing_only=false.
--
-- This redefines release_billing_jobs_for_deal so that, for ai_seo, it emits the
-- same trio as release_jobs_for_deal: an off-board billing record (billing_only)
-- + a web_seo child (-> pefstathiadis via jobs_web_seo_owner trigger) + a
-- local_seo child (-> dtzouvaras via jobs_local_seo_owner trigger), both on each
-- board's first stage, linked by parent_job_id; child codes -> <deal>-AISEOWEB /
-- <deal>-AISEOLOC via the set_job_code trigger. All other services are unchanged.

create or replace function public.release_billing_jobs_for_deal(target_deal_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
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

    -- AI SEO: off-board billing record + on-board web & local work cards.
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', v_web_stage, v_web_group, v_parent, now(), d.code);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', v_local_stage, v_local_group, v_parent, now(), d.code);

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
end $$;
grant execute on function public.release_billing_jobs_for_deal(uuid) to authenticated;

-- ROLLBACK: restore the function body verbatim from
--   20260617000013_jobs_at_won_cutover.sql (lines 12-46).
