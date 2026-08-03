-- =============================================================================
-- convert_job_service_type: admin/accounting convert a standalone job between
-- same-cadence services (v1). Money is preserved; board/stage, code, owner,
-- group and monthly_tasks are reset to the target service. AI SEO / web_dev /
-- franchise / maintenance / other and parent/child jobs are refused.
-- Spec: docs/superpowers/specs/2026-08-03-job-service-type-conversion-design.md
-- =============================================================================

create or replace function public.convert_job_service_type(p_job_id uuid, p_target text)
returns public.jobs
language plpgsql security definer set search_path = public as $$
declare
  j          public.jobs;
  new_stage  uuid;
  new_owner  uuid;
  new_group  uuid;
  grpA text[] := array['web_seo','local_seo','social_media','ads'];
  grpB text[] := array['hosting','domains'];
begin
  -- AuthZ: admin or accounting only (RLS keys on service_type, so we cannot
  -- rely on the caller having edit rights on both the old and new boards).
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    raise exception 'convert: not authorized';
  end if;

  select * into j from public.jobs where id = p_job_id;
  if not found then raise exception 'convert: job % not found', p_job_id; end if;

  -- Scope guards (v1)
  if j.parent_job_id is not null then
    raise exception 'convert: cannot convert an AI SEO child job'; end if;
  if exists (select 1 from public.jobs c where c.parent_job_id = j.id) then
    raise exception 'convert: cannot convert an AI SEO parent job'; end if;
  if j.service_type in ('ai_seo','web_dev','franchise','maintenance','other') then
    raise exception 'convert: % conversions are not supported yet', j.service_type; end if;
  if p_target in ('ai_seo','web_dev','franchise','maintenance','other') then
    raise exception 'convert: target % is not supported yet', p_target; end if;
  if p_target = j.service_type then
    raise exception 'convert: source and target are the same'; end if;
  if not ((j.service_type = any(grpA) and p_target = any(grpA))
       or (j.service_type = any(grpB) and p_target = any(grpB))) then
    raise exception 'convert: % -> % crosses billing-cadence group', j.service_type, p_target;
  end if;

  -- 1) Billing realignment — amounts untouched. Payment lines link by job_id
  --    (no service_type column there), so only deal_payments + services_planned move.
  update public.deal_payments
     set service_type = p_target
   where deal_id = j.deal_id
     and service_type = j.service_type
     and coalesce(amount_net, -1) = coalesce(j.amount_net, -1);

  update public.deals d
     set services_planned = coalesce((
       select jsonb_agg(
         case when (e->>'service_type') = j.service_type
               and coalesce((e->>'amount_net')::numeric, -1) = coalesce(j.amount_net, -1)
              then jsonb_set(e, '{service_type}', to_jsonb(p_target))
              else e end)
       from jsonb_array_elements(d.services_planned) e), d.services_planned)
   where d.id = j.deal_id and jsonb_typeof(d.services_planned) = 'array';

  -- 2) service_type + 3) stage remap to the target board's first stage
  select id into new_stage from public.pipeline_stages where board = p_target order by position limit 1;
  update public.jobs set service_type = p_target, stage_id = new_stage where id = p_job_id;

  -- 4) code — reuse the existing generator (unique per new service)
  update public.jobs set code = public.generate_job_code(j.deal_id, p_target) where id = p_job_id;

  -- 5) owner + group — replicate the INSERT-trigger rules for the target
  new_owner := case p_target
                 when 'local_seo' then 'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid  -- dtzouvaras
                 when 'web_seo'   then '19aa9170-bd62-4319-8118-668c11e93c98'::uuid  -- pefstathiadis
                 else public.team_lead_for_group(p_target) end;
  select id into new_group from public.groups where code = p_target;
  update public.jobs set owner_user_id = new_owner, assigned_group_id = new_group where id = p_job_id;

  -- 6) monthly tasks — reset to the target template
  update public.jobs
     set monthly_tasks = coalesce(
           (select tasks from public.service_monthly_task_templates where service_type = p_target),
           '[]'::jsonb),
         monthly_tasks_period = null
   where id = p_job_id;

  -- NOTE (v1): details JSONB is left as-is. The Info tab renders only the target
  -- service's keys, so stale keys are hidden; keeping them makes convert reversible.

  -- 7) audit (action is CHECK-limited to insert/update/delete; kind goes in changes)
  insert into public.activity_log(entity_type, entity_id, action, changes, user_id, client_id)
    values ('job', p_job_id, 'update',
            jsonb_build_object('kind','service_type_converted','from', j.service_type, 'to', p_target),
            auth.uid(), j.client_id);

  select * into j from public.jobs where id = p_job_id;
  return j;
end $$;

revoke all on function public.convert_job_service_type(uuid, text) from public;
grant execute on function public.convert_job_service_type(uuid, text) to authenticated;

-- ROLLBACK:
-- drop function if exists public.convert_job_service_type(uuid, text);
