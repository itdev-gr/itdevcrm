-- =============================================================================
-- release_jobs_for_deal: spawn jobs into the board's FIRST stage by position
-- instead of a hardcoded stage code.
--
-- The hardcoded codes broke when Local SEO's stages were renamed
-- (20260610000002 archived 'onboarding', so new local_seo jobs would spawn
-- with stage_id = null and be invisible on the kanban). Picking the
-- lowest-position non-archived stage is rename-proof and keeps current
-- behavior everywhere else (web_dev's first stage is awaiting_brief, the
-- recurring boards' first stage is onboarding). Everything else is identical
-- to the prior version (20260511000002).
--
-- Rollback: re-run the function definition from
-- supabase/migrations/20260511000002_team_leads.sql (lines 44-132).
-- =============================================================================

create or replace function public.release_jobs_for_deal(
  target_deal_id uuid,
  partial_payment_mode boolean
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  service jsonb;
  service_type_val text;
  stage_board text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  group_id_val uuid;
  owner_id_val uuid;
  job_stage_id uuid;
  inserted int := 0;
  should_block boolean;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';

    if service_type_val not in
       ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly', 'recurring_yearly') then
      continue;
    end if;

    if exists (
      select 1 from public.jobs
       where deal_id = d.id
         and service_type = service_type_val
         and archived = false
    ) then
      continue;
    end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val <> 'web_dev';

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);

    stage_board := case service_type_val when 'ai_seo' then 'web_seo' else service_type_val end;

    -- First stage of the board = entry column. Boards without stages
    -- (hosting) keep spawning with stage_id null, as before.
    select id into job_stage_id
      from public.pipeline_stages
     where board = stage_board
       and archived = false
     order by position
     limit 1;

    insert into public.jobs (
      deal_id, client_id, service_type, billing_type,
      one_time_amount, monthly_amount, setup_fee,
      stage_id, assigned_group_id, owner_user_id,
      status, started_at, code,
      is_blocked, blocked_reason, blocked_at
    ) values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, owner_id_val,
      'active', now(), d.code,
      should_block,
      case when should_block then 'partial_payment_pending' else null end,
      case when should_block then now() else null end
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end $$;

grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;
