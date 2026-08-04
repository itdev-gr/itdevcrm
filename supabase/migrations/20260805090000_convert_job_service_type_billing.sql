-- =============================================================================
-- convert_job_service_type re-keys the deal's billing (2026-08-05)
--
-- NOT a fix for deal 000403 — that deal never went through this RPC. Read
-- live 2026-08-04: activity_log has NO service_type_converted entry for
-- 000403. Both SEO jobs were inserted 38 seconds apart at onboarding on
-- 2026-06-22 (000403-LOCALSEO 10:37:24, 000403-WEBSEO 10:38:02); someone
-- edited deals.services_planned to web_seo by hand, closed the local card
-- (note: "δεν ειναι λοκαλ"), and left the web card in place. See
-- docs/data-fixes/2026-08-04-deal-000403-service-change.md for the full
-- read and the separate prod data repair that re-keyed 000403's own rows.
--
-- THIS MIGRATION is a preventative fix for the SUPPORTED convert path, so the
-- same failure mode can't happen to the next deal that legitimately runs
-- convert_job_service_type: today the function moves jobs.service_type but
-- leaves deal_payments keyed to the old service, which strands the job's
-- billing. The mechanism it guards against:
--   recompute_job_period_dates resolves a job's period from the newest PAID
--   payment that EITHER matches the job on service_type + billing_type OR is
--   line-linked to the job via deal_payment_lines (see
--   20260713150000_jobs_per_type_billing.sql). A convert done through this
--   RPC leaves the payment's deal_payment_lines row pointing at the SAME job,
--   so the line-link arm keeps resolving it and period dates would NOT go
--   NULL even without this fix — 000403's dates went NULL for a different
--   reason (its line pointed at the *other*, closed local_seo job, not the
--   web_seo job it should have followed).
--   The function that genuinely needs the re-key is ensure_recurring_payments():
--   it only extends a period when a non-archived, billing_active job exists
--   with j.service_type = dp.service_type AND matching billing_type — it has
--   NO line-link arm. So a payment left keyed to the job's OLD service simply
--   stops matching once the job's service_type moves, and no successor period
--   is ever generated: a silent, permanent stop of the recurring schedule
--   (the same two-months-unbilled shape 000403 hit, just reached by hand
--   editing instead of by this RPC).
--
-- FIX: after the function sets jobs.service_type = p_target on the standalone
-- (v1) convert path, re-key deal_payments rows on the SAME deal from the old
-- service to the new one, for:
--   (a) every row line-linked to this job via deal_payment_lines — this is
--       unambiguous, the payment lines say exactly which job the money was for;
--   (b) rows still keyed to the old service_type on this deal that are NOT
--       line-linked to any job (unlinked/legacy rows), but ONLY when no OTHER
--       live (non-archived) job of the old service_type remains on the deal to
--       own them. If a sibling job of the old service is still active, its
--       billing must not be stolen by this convert.
-- Then explicitly recompute the job's period dates before returning:
-- deal_payments_recompute_job_dates_trg only reacts to a payment's status
-- changing or its dates moving on an already-paid row: a service_type-only
-- UPDATE fires nothing, so without this the job would sit with NULL period
-- dates until some unrelated write happened to trigger a recompute.
--
-- SCOPE: only the v1 standalone-convert path (grpA/grpB same-cadence group
-- conversions) gets this block. The v2 AI-SEO trio branches (upgrade to
-- ai_seo, teardown from ai_seo) already re-key deal_payments themselves via
-- their own UPDATE ... amount_net match and are untouched here.
--
-- Pre-change live body md5(pg_get_functiondef) = 7b1f8f534b6bc7622a2181cc3984e5fe
-- (read from prod 2026-08-04; matches the 20260803170000_ai_seo_conversion.sql
-- emission, including the AI-SEO trio branch and the grpA/grpB arrays).
--
-- ROLLBACK:
--   re-apply supabase/migrations/20260803170000_ai_seo_conversion.sql
--   (restores the pre-change body, md5 7b1f8f534b6bc7622a2181cc3984e5fe).
--
-- APPLIED to prod 2026-08-04. Post-change md5(pg_get_functiondef) =
--   0518d6770231f736b4947de017f3decf  (this guarded body; the pre-guard body
--   that was live earlier the same day was cbc03ef185e010db50cc56539065b228).
-- Verified against the applied function inside a rolled-back transaction, with
-- the payment header deliberately billing a different amount (199) from the job
-- (250) so the function's PRE-EXISTING amount-matching re-key could not account
-- for the result: job service_type web_seo, payment service_type web_seo,
-- period_start_date NOT NULL, activity_log changes->>'payments_rekeyed' = 1.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.convert_job_service_type(p_job_id uuid, p_target text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j          public.jobs;
  new_stage  uuid;
  new_owner  uuid;
  new_group  uuid;
  v_rekeyed  int;
  grpA text[] := array['web_seo','local_seo','social_media','ads'];
  grpB text[] := array['hosting','domains'];
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    raise exception 'convert: not authorized';
  end if;

  select * into j from public.jobs where id = p_job_id;
  if not found then raise exception 'convert: job % not found', p_job_id; end if;

  -- ===== v2: AI SEO upgrade (web_seo/local_seo standalone -> ai_seo trio) =====
  if p_target = 'ai_seo' then
    if j.service_type not in ('web_seo','local_seo') then
      raise exception 'convert: only web_seo/local_seo can become AI SEO'; end if;
    if j.parent_job_id is not null then
      raise exception 'convert: job is already part of a trio'; end if;
    if exists (select 1 from public.jobs c where c.parent_job_id = j.id) then
      raise exception 'convert: job already has children'; end if;
    if exists (select 1 from public.jobs a where a.deal_id = j.deal_id and a.service_type = 'ai_seo') then
      raise exception 'convert: deal already has an AI SEO service'; end if;
    declare v_parent uuid; v_sibling text; v_sib_stage uuid; v_sib_owner uuid; v_sib_group uuid;
    begin
      insert into public.jobs(deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active, status, started_at)
        values (j.deal_id, j.client_id, 'ai_seo', j.billing_type, j.amount_net, j.vat_rate,
          j.one_time_amount, j.monthly_amount, j.setup_fee, 'AI SEO', true, true, true, 'active', now())
        returning id into v_parent;
      update public.deal_payment_lines set job_id = v_parent where job_id = j.id;
      update public.deal_payments set service_type = 'ai_seo'
        where deal_id = j.deal_id and service_type = j.service_type
          and coalesce(amount_net,-1) = coalesce(j.amount_net,-1);
      update public.deals d set services_planned = coalesce((select jsonb_agg(
          case when (e->>'service_type') = j.service_type
                and coalesce((e->>'amount_net')::numeric,-1) = coalesce(j.amount_net,-1)
               then jsonb_set(e,'{service_type}', to_jsonb('ai_seo'::text)) else e end)
          from jsonb_array_elements(d.services_planned) e), d.services_planned)
        where d.id = j.deal_id and jsonb_typeof(d.services_planned) = 'array';
      update public.jobs set parent_job_id = v_parent, amount_net = 0, billing_active = false,
          billing_only = true, is_custom = true,
          title = case when j.service_type='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          code = public.generate_job_code(j.deal_id, case when j.service_type='web_seo' then 'aiseo_web' else 'aiseo_local' end)
        where id = j.id;
      v_sibling := case when j.service_type='web_seo' then 'local_seo' else 'web_seo' end;
      select id into v_sib_stage from public.pipeline_stages where board = v_sibling order by position limit 1;
      v_sib_owner := case v_sibling when 'local_seo' then 'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid
                                    when 'web_seo'   then '19aa9170-bd62-4319-8118-668c11e93c98'::uuid end;
      select id into v_sib_group from public.groups where code = v_sibling;
      insert into public.jobs(deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, owner_user_id,
          parent_job_id, started_at, monthly_tasks)
        values (j.deal_id, j.client_id, v_sibling, j.billing_type, 0, j.vat_rate,
          case when v_sibling='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          true, false, true, 'active', v_sib_stage, v_sib_group, v_sib_owner, v_parent, now(),
          coalesce((select tasks from public.service_monthly_task_templates where service_type = v_sibling),'[]'::jsonb));
      insert into public.activity_log(entity_type, entity_id, action, changes, user_id, client_id)
        values ('job', j.id, 'update',
                jsonb_build_object('kind','service_type_converted','from', j.service_type, 'to','ai_seo'),
                auth.uid(), j.client_id);
      select * into j from public.jobs where id = v_parent;
      return j;
    end;
  end if;

  -- ===== v2: AI SEO teardown (ai_seo parent -> web_seo/local_seo survivor) =====
  if j.service_type = 'ai_seo' then
    if not coalesce(j.billing_only, false) then
      raise exception 'convert: not an AI SEO parent job'; end if;
    if p_target not in ('web_seo','local_seo') then
      raise exception 'convert: AI SEO can only become web_seo or local_seo'; end if;
    declare v_survivor uuid;
    begin
      select id into v_survivor from public.jobs where parent_job_id = j.id and service_type = p_target limit 1;
      if v_survivor is null then raise exception 'convert: no % child to keep', p_target; end if;
      update public.jobs s set parent_job_id = null, billing_only = false, billing_active = true,
          is_custom = j.is_custom, amount_net = j.amount_net, one_time_amount = j.one_time_amount,
          monthly_amount = j.monthly_amount, setup_fee = j.setup_fee, billing_type = j.billing_type,
          vat_rate = j.vat_rate,
          title = coalesce((select nullif(trim(business_profile_name),'') from public.deals where id = j.deal_id),
                           (select name from public.clients where id = j.client_id)),
          code = public.generate_job_code(j.deal_id, p_target)
        where s.id = v_survivor;
      update public.deal_payment_lines set job_id = v_survivor where job_id = j.id;
      update public.deal_payments set service_type = p_target where deal_id = j.deal_id and service_type = 'ai_seo';
      update public.deals d set services_planned = coalesce((select jsonb_agg(
          case when (e->>'service_type') = 'ai_seo' then jsonb_set(e,'{service_type}', to_jsonb(p_target)) else e end)
          from jsonb_array_elements(d.services_planned) e), d.services_planned)
        where d.id = j.deal_id and jsonb_typeof(d.services_planned) = 'array';
      delete from public.jobs where parent_job_id = j.id and id <> v_survivor;
      insert into public.activity_log(entity_type, entity_id, action, changes, user_id, client_id)
        values ('job', v_survivor, 'update',
                jsonb_build_object('kind','service_type_converted','from','ai_seo','to', p_target),
                auth.uid(), j.client_id);
      delete from public.jobs where id = j.id;  -- remove the parent
      select * into j from public.jobs where id = v_survivor;
      return j;
    end;
  end if;

  -- ===== v1: same billing-cadence group conversions =====
  if j.parent_job_id is not null then
    raise exception 'convert: cannot convert an AI SEO child job'; end if;
  if exists (select 1 from public.jobs c where c.parent_job_id = j.id) then
    raise exception 'convert: cannot convert a parent job'; end if;
  if j.service_type in ('web_dev','franchise','maintenance','other') then
    raise exception 'convert: % conversions are not supported', j.service_type; end if;
  if p_target in ('web_dev','franchise','maintenance','other') then
    raise exception 'convert: target % is not supported', p_target; end if;
  if p_target = j.service_type then
    raise exception 'convert: source and target are the same'; end if;
  if not ((j.service_type = any(grpA) and p_target = any(grpA))
       or (j.service_type = any(grpB) and p_target = any(grpB))) then
    raise exception 'convert: % -> % crosses billing-cadence group', j.service_type, p_target;
  end if;

  update public.deal_payments set service_type = p_target
   where deal_id = j.deal_id and service_type = j.service_type
     and coalesce(amount_net, -1) = coalesce(j.amount_net, -1);
  update public.deals d set services_planned = coalesce((select jsonb_agg(
       case when (e->>'service_type') = j.service_type
             and coalesce((e->>'amount_net')::numeric, -1) = coalesce(j.amount_net, -1)
            then jsonb_set(e, '{service_type}', to_jsonb(p_target)) else e end)
       from jsonb_array_elements(d.services_planned) e), d.services_planned)
   where d.id = j.deal_id and jsonb_typeof(d.services_planned) = 'array';
  select id into new_stage from public.pipeline_stages where board = p_target order by position limit 1;
  update public.jobs set service_type = p_target, stage_id = new_stage where id = p_job_id;
  update public.jobs set code = public.generate_job_code(j.deal_id, p_target) where id = p_job_id;

  -- 2b) Billing follows the service (2026-08-05). ensure_recurring_payments()
  --     only extends a period when a non-archived, billing_active job matches
  --     a payment on service_type AND billing_type (no line-link arm), so a
  --     convert that leaves deal_payments on the OLD service strands the job's
  --     recurring schedule for ever — no successor period, no renewal, no due
  --     chip, no reminder (the two-months-unbilled shape deal 000403 hit by
  --     hand-editing, not through this RPC — see the header). Re-key (a) every
  --     row line-linked to this job and (b) rows still keyed to the old
  --     service on this deal, but only while no OTHER live job of the old
  --     service is left to own them.
  update public.deal_payments p
     set service_type = p_target
   where p.deal_id = j.deal_id
     and p.billing_type = j.billing_type
     and (
       (
         exists (select 1 from public.deal_payment_lines l
                  where l.payment_id = p.id and l.job_id = p_job_id)
         -- Guard against mis-keying a billing GROUP: generate_payments_for_deal
         -- can put several deal_payment_lines (different jobs) under one
         -- payment header, deliberately leaving the header service_type NULL
         -- when the group mixes services. Only re-key branch (a) when this
         -- payment has no OTHER job's line on it, so converting one member of
         -- a group never stamps the whole bundle with p_target.
         and not exists (select 1 from public.deal_payment_lines l2
                          where l2.payment_id = p.id and l2.job_id <> p_job_id)
       )
       or (
         p.service_type = j.service_type
         and not exists (select 1 from public.jobs j2
                          where j2.deal_id = j.deal_id and j2.id <> p_job_id
                            and not j2.archived and j2.service_type = j.service_type)
       )
     );
  get diagnostics v_rekeyed = row_count;

  new_owner := case p_target
                 when 'local_seo' then 'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid
                 when 'web_seo'   then '19aa9170-bd62-4319-8118-668c11e93c98'::uuid
                 else public.team_lead_for_group(p_target) end;
  select id into new_group from public.groups where code = p_target;
  update public.jobs set owner_user_id = new_owner, assigned_group_id = new_group where id = p_job_id;
  update public.jobs
     set monthly_tasks = coalesce(
           (select tasks from public.service_monthly_task_templates where service_type = p_target), '[]'::jsonb),
         monthly_tasks_period = null
   where id = p_job_id;
  insert into public.activity_log(entity_type, entity_id, action, changes, user_id, client_id)
    values ('job', p_job_id, 'update',
            jsonb_build_object('kind','service_type_converted','from', j.service_type, 'to', p_target,
                               'payments_rekeyed', v_rekeyed),
            auth.uid(), j.client_id);

  -- The re-key changed which payment matches this job; nothing else recomputes
  -- on a service_type-only update.
  perform public.recompute_deal_job_period_dates(j.deal_id);

  select * into j from public.jobs where id = p_job_id;
  return j;
end $function$;

revoke all on function public.convert_job_service_type(uuid, text) from public;
grant execute on function public.convert_job_service_type(uuid, text) to authenticated;
