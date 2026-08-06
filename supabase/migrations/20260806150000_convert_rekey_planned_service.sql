-- =============================================================================
-- convert_job_service_type: make the services_planned re-key actually work
-- (2026-08-06)
--
-- WHY. Both convert paths try to move the deal's planned-service entry onto the
-- new service_type by matching the element's amount:
--
--   case when (e->>'service_type') = j.service_type
--         and coalesce((e->>'amount_net')::numeric, -1) = coalesce(j.amount_net, -1)
--        then jsonb_set(e, '{service_type}', to_jsonb(p_target)) else e end
--
-- `amount_net` is not a key that services_planned entries have. The UI writes
-- service_type, billing_type, one_time_amount, monthly_amount, setup_fee,
-- package_id, payment_terms, subpackage_codes and nothing else
-- (src/features/deals/ServicesPlannedField.tsx:16-27), and
-- release_billing_jobs_for_deal reads the money back out of
-- one_time_amount/monthly_amount, never amount_net
-- (20260728120000_domains_service.sql:103-105). So `(e->>'amount_net')` is
-- always NULL, coalesces to -1, never equals the job's amount, and the whole
-- CASE falls through to `else e` — the re-key has never once fired.
--
-- Observed 2026-08-06: deals 006122, 000230 and 000060 had all been converted to
-- ai_seo and all three still advertised the pre-conversion service_type in
-- services_planned. Repaired by hand in
-- docs/data-fixes/2026-08-06-ai-seo-convert-archived-stage.md; this is the
-- upstream fix so the next convert does not need repairing.
--
-- WHY IT MATTERS. services_planned is the sole input to
-- release_billing_jobs_for_deal / release_jobs_for_deal — there is no
-- deal_services table. A deal whose planned services disagree with its jobs
-- reports the wrong service everywhere it is read, and the dedup guard that
-- keeps it from spawning a duplicate card is only holding because the old
-- service's job still happens to exist and be non-archived. Archive that job and
-- the next accounting stage change re-creates a card for a service the deal no
-- longer sells.
--
-- FIX. New helper public.rekey_planned_service(deal, from, to, billing_type,
-- amount) re-keys EXACTLY ONE entry — the best match — and returns how many it
-- changed (0 or 1):
--   * candidates are entries with service_type = p_from AND the same
--     billing_type (missing billing_type is read as 'one_time', matching how
--     release_billing_jobs_for_deal coalesces it);
--   * among those, prefer the one whose effective amount equals the job's,
--     computed from the keys that actually exist — one_time_amount for one_time
--     entries, monthly_amount otherwise — with amount_net kept only as a legacy
--     fallback for any hand-written row;
--   * ties break on array position, so the choice is deterministic;
--   * if nothing matches p_from at all it changes nothing, exactly as before.
--
-- Rewriting one entry rather than mapping the whole array also removes the old
-- shape's second hazard: a deal carrying the same service twice (different
-- cadences) would have had BOTH entries re-keyed by a single convert.
--
-- The AI-SEO teardown branch keeps its unconditional `= 'ai_seo'` map: the
-- upgrade branch refuses to run when the deal already has an ai_seo job
-- ('convert: deal already has an AI SEO service'), so at most one ai_seo entry
-- can exist and there is nothing to disambiguate.
--
-- Pre-change live body md5(pg_get_functiondef) = 76955f9baabc989b10bb4b7bdcfd26f2
-- (read from prod 2026-08-06; the emission of 20260806110000, no drift).
--
-- ROLLBACK:
--   re-apply supabase/migrations/20260806110000_convert_ai_seo_sibling_stage_and_flags.sql
--   (restores the pre-change body, md5 76955f9baabc989b10bb4b7bdcfd26f2), then
--   drop function if exists public.rekey_planned_service(uuid, text, text, text, numeric);
--
-- APPLIED to prod 2026-08-06. Post-change md5(pg_get_functiondef) =
--   019fd2363e38bec41e99a1def7fedafd
--
-- Verified after apply, inside a rolled-back transaction against live rows:
--   deal 006122  ai_seo -> local_seo, cadence + amount match      -> rc 1, re-keyed
--   deal 000129  local_seo -> web_seo, cadence match, amount 99999 -> rc 1, re-keyed
--                (the point of the fix: a stale amount no longer silently no-ops)
--   deal 000129  hosting -> domains, service absent                -> rc 0, untouched
--   deal 000060  ai_seo, one_time vs the row's recurring_monthly   -> rc 0, untouched
--   the OLD predicate, run as a plain count over the same row:
--     coalesce((e->>'amount_net')::numeric,-1) = 230               -> 0 rows,
--   i.e. the replaced CASE could never have fired on real data.
-- All three deals confirmed unchanged after ROLLBACK.
-- =============================================================================

create or replace function public.rekey_planned_service(
  p_deal_id uuid, p_from text, p_to text, p_billing_type text, p_amount numeric)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_planned jsonb;
  v_idx     int;
begin
  select services_planned into v_planned from public.deals where id = p_deal_id;
  if v_planned is null or jsonb_typeof(v_planned) <> 'array' then return 0; end if;

  select e.ord into v_idx
    from jsonb_array_elements(v_planned) with ordinality as e(elem, ord)
   where e.elem->>'service_type' = p_from
     and coalesce(e.elem->>'billing_type', 'one_time') = coalesce(p_billing_type, 'one_time')
   order by
     -- Prefer the entry whose money matches the job. Read it from the keys the
     -- UI actually writes; amount_net is a legacy fallback only.
     (coalesce(
        case when coalesce(e.elem->>'billing_type', 'one_time') = 'one_time'
             then nullif(e.elem->>'one_time_amount', '')::numeric
             else nullif(e.elem->>'monthly_amount', '')::numeric end,
        nullif(e.elem->>'amount_net', '')::numeric,
        0) = coalesce(p_amount, 0)) desc,
     e.ord
   limit 1;

  if v_idx is null then return 0; end if;

  -- with ordinality is 1-based; jsonb_set paths are 0-based.
  update public.deals
     set services_planned = jsonb_set(v_planned, array[(v_idx - 1)::text, 'service_type'], to_jsonb(p_to))
   where id = p_deal_id;

  return 1;
end $function$;

revoke all on function public.rekey_planned_service(uuid, text, text, text, numeric) from public;

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
      -- Re-key exactly one planned-service entry. The old inline CASE matched on
      -- (e->>'amount_net'), a key services_planned entries never carry, so it
      -- could never fire.
      perform public.rekey_planned_service(j.deal_id, j.service_type, 'ai_seo', j.billing_type, j.amount_net);
      -- The money now lives on the parent. Clear EVERY amount column on the
      -- converted card, not just amount_net: integrity alert #5
      -- `aiseo_child_amount` also reads monthly_amount / one_time_amount.
      -- billing_only stays FALSE — matches the canonical trio spawn in
      -- release_billing_jobs_for_deal and keeps the card force-renewable.
      update public.jobs set parent_job_id = v_parent, amount_net = 0, billing_active = false,
          billing_only = false, is_custom = true,
          one_time_amount = null, monthly_amount = null, setup_fee = null,
          title = case when j.service_type='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          code = public.generate_job_code(j.deal_id, case when j.service_type='web_seo' then 'aiseo_web' else 'aiseo_local' end)
        where id = j.id;
      v_sibling := case when j.service_type='web_seo' then 'local_seo' else 'web_seo' end;
      -- Live stages only, deterministic pick. Both SEO boards have a live
      -- new_project AND an archived onboarding at position 10; an archived
      -- stage renders no column, so a card parked on one is invisible.
      select id into v_sib_stage from public.pipeline_stages
        where board = v_sibling and not archived
        order by (code = 'new_project') desc, position, code
        limit 1;
      v_sib_owner := case v_sibling when 'local_seo' then 'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid
                                    when 'web_seo'   then '19aa9170-bd62-4319-8118-668c11e93c98'::uuid end;
      select id into v_sib_group from public.groups where code = v_sibling;
      insert into public.jobs(deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, owner_user_id,
          parent_job_id, started_at, monthly_tasks)
        values (j.deal_id, j.client_id, v_sibling, j.billing_type, 0, j.vat_rate,
          case when v_sibling='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          true, false, false, 'active', v_sib_stage, v_sib_group, v_sib_owner, v_parent, now(),
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
      -- Unconditional map is safe here: the upgrade branch refuses to run when
      -- the deal already has an ai_seo job, so at most one ai_seo entry exists.
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
  -- Re-key exactly one planned-service entry (see the helper, and the header for
  -- why the old (e->>'amount_net') match could never fire).
  perform public.rekey_planned_service(j.deal_id, j.service_type, p_target, j.billing_type, j.amount_net);
  -- Live stages only, deterministic pick — same reason as the sibling pick above.
  select id into new_stage from public.pipeline_stages
    where board = p_target and not archived
    order by (code = 'new_project') desc, position, code
    limit 1;
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
