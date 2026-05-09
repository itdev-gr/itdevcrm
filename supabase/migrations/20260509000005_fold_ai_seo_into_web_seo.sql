-- =============================================================================
-- Phase 6 follow-up — fold AI SEO into Web SEO.
-- AI SEO is delivered by the Web SEO + Local SEO teams; it doesn't need its
-- own kanban. ai_seo *jobs* still exist (different service_type, different
-- monthly task template), but they now live on the web_seo board's stages
-- and show up on /tech/web-seo and /tech/local-seo via service_type IN (...).
-- =============================================================================

-- 1. Migrate existing ai_seo jobs to web_seo's same-code stage.
update public.jobs j
   set stage_id = ws.id
  from public.pipeline_stages ai
  join public.pipeline_stages ws
    on ws.board = 'web_seo' and ws.code = ai.code and ws.archived = false
 where j.service_type = 'ai_seo'
   and j.stage_id = ai.id
   and ai.board = 'ai_seo';

-- 2. Update release_jobs_for_deal so future ai_seo jobs spawn on web_seo
--    stages (case-mapping ai_seo → web_seo when looking up the initial stage).
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
       ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting') then
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

    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block := partial_payment_mode and service_type_val <> 'web_dev';

    select id into group_id_val from public.groups where code = service_type_val;

    -- ai_seo jobs live on the web_seo board (no separate kanban).
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
      stage_id, assigned_group_id, status, started_at, code,
      is_blocked, blocked_reason, blocked_at
    ) values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now(), d.code,
      should_block,
      case when should_block then 'partial_payment_pending' else null end,
      case when should_block then now() else null end
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end $$;

grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- 3. Archive ai_seo board pipeline stages so they no longer show up in admin
--    UI or get queried by mistake. (Keep the rows for historical FK integrity
--    rather than deleting.)
update public.pipeline_stages
   set archived = true
 where board = 'ai_seo' and archived = false;

-- 4. Rebuild tech_my_clients so ai_seo activity surfaces under BOTH web_seo
--    and local_seo rows. Web Dev / Hosting / Social Media stay scoped to
--    their own service_type.
create or replace view public.tech_my_clients
with (security_invoker = true) as
with sources as (
  select
    case
      when j.service_type = 'ai_seo' then unnest(array['web_seo', 'local_seo'])
      else j.service_type
    end as service_type,
    j.client_id,
    j.updated_at,
    j.status,
    j.is_blocked
  from public.jobs j
  where j.archived = false
    and j.status <> 'cancelled'
    and j.updated_at > now() - interval '90 days'
)
select
  s.service_type,
  c.id as client_id,
  c.name as client_name,
  c.industry,
  c.status as client_status,
  c.email,
  c.contact_first_name,
  c.contact_last_name,
  max(s.updated_at) as last_activity,
  count(*) filter (where s.status = 'active') as active_jobs,
  bool_or(s.is_blocked) as any_blocked
from sources s
join public.clients c on c.id = s.client_id
group by s.service_type, c.id, c.name, c.industry, c.status, c.email,
         c.contact_first_name, c.contact_last_name;

grant select on public.tech_my_clients to authenticated;
