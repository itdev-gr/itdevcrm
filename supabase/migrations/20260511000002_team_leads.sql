-- =============================================================================
-- Team leads + auto-assign new jobs.
-- - user_groups.is_team_lead flags a user as the lead of a group. Multiple
--   leads per group are allowed; auto-assignment picks the earliest-assigned
--   lead deterministically.
-- - release_jobs_for_deal now sets owner_user_id from team_lead_for_group()
--   so new tech jobs land on the lead's plate by default.
-- - Existing unassigned jobs get backfilled so the "Only mine" filter on
--   tech kanbans starts showing real work.
-- =============================================================================

alter table public.user_groups
  add column if not exists is_team_lead boolean not null default false;

create index if not exists user_groups_team_leads
  on public.user_groups (group_id) where is_team_lead = true;

-- Resolve the team lead's user_id for a service_type group. Stable so it
-- can be used inline in updates; security_definer so RLS on user_groups
-- doesn't filter out leads when called from a non-admin context (the
-- function is intentionally idempotent + read-only).
create or replace function public.team_lead_for_group(p_group_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ug.user_id
    from public.user_groups ug
    join public.groups g on g.id = ug.group_id
   where g.code = p_group_code
     and ug.is_team_lead = true
   order by ug.created_at asc, ug.user_id asc
   limit 1;
$$;

grant execute on function public.team_lead_for_group(text) to authenticated;

-- ---------------------------------------------------------------------------
-- release_jobs_for_deal now populates owner_user_id from the team lead.
-- Everything else identical to the prior version (20260511000001).
-- ---------------------------------------------------------------------------
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

    select id into job_stage_id
      from public.pipeline_stages
     where board = stage_board
       and code = case service_type_val
         when 'web_dev' then 'awaiting_brief'
         when 'hosting' then 'setup'
         else 'onboarding'
       end
       and archived = false
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

-- ---------------------------------------------------------------------------
-- Backfill: any active unassigned job inherits its group's current lead.
-- No-op for groups without a lead (yet).
-- ---------------------------------------------------------------------------
update public.jobs j
   set owner_user_id = public.team_lead_for_group(j.service_type)
 where j.archived = false
   and j.owner_user_id is null
   and public.team_lead_for_group(j.service_type) is not null;
