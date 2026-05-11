-- =============================================================================
-- Ads end-to-end support.
-- The deal form lets sales add service_type='ads', but the backend silently
-- dropped them. This migration plugs the four gaps:
--   1. jobs_service_type_check excludes 'ads' -> INSERT 23514
--   2. release_jobs_for_deal allow-list excludes 'ads' -> silent skip
--   3. No pipeline_stages on board='ads' -> NULL stage_id, invisible cards
--   4. No monthly_task_template for 'ads' -> empty checklist on recurring jobs
-- =============================================================================

-- 1. Allow 'ads' in jobs.service_type CHECK.
alter table public.jobs
  drop constraint if exists jobs_service_type_check;
alter table public.jobs
  add constraint jobs_service_type_check
  check (service_type in
    ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads'));

-- 2. Seed pipeline_stages for board='ads'. Mirror the web_seo shape — the
--    same flow works for ads delivery (onboarding -> strategy -> active ...).
insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal)
values
  ('ads', 'onboarding',     '{"en":"Onboarding","el":"Onboarding"}'::jsonb,                       10, false),
  ('ads', 'audit_strategy', '{"en":"Audit / Strategy","el":"Audit / Στρατηγική"}'::jsonb,         20, false),
  ('ads', 'active',         '{"en":"Active","el":"Ενεργό"}'::jsonb,                                30, false),
  ('ads', 'on_hold',        '{"en":"On Hold","el":"Σε Αναμονή"}'::jsonb,                           40, false),
  ('ads', 'cancelled',      '{"en":"Cancelled","el":"Ακυρωμένο"}'::jsonb,                          50, true)
on conflict (board, code) do update
  set display_names = excluded.display_names,
      position      = excluded.position,
      is_terminal   = excluded.is_terminal,
      archived      = false;

-- 3. release_jobs_for_deal: add 'ads' to the allow-list. Keep the ai_seo
--    -> web_seo board map from 20260509000005.
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

-- 4. Monthly task template for ads.
insert into public.service_monthly_task_templates (service_type, tasks)
values ('ads', '[
  {"code":"budget_check",        "label_en":"Confirm monthly budget",    "label_el":"Επιβεβαίωση μηνιαίου budget"},
  {"code":"creative_refresh",    "label_en":"Refresh creatives",         "label_el":"Ανανέωση creatives"},
  {"code":"performance_report",  "label_en":"Send performance report",   "label_el":"Αποστολή report απόδοσης"},
  {"code":"optimization_pass",   "label_en":"Run optimization pass",     "label_el":"Optimization pass"}
]'::jsonb)
on conflict (service_type) do nothing;

-- 5. tech_my_clients: keep ai_seo's existing double-mapping; ads passes
--    through 1:1 like web_dev / hosting / social_media.
create or replace view public.tech_my_clients
with (security_invoker = true) as
with base as (
  select j.service_type, j.client_id, j.updated_at, j.status, j.is_blocked
    from public.jobs j
   where j.archived = false
     and j.status <> 'cancelled'
     and j.updated_at > now() - interval '90 days'
),
sources as (
  select service_type, client_id, updated_at, status, is_blocked
    from base where service_type <> 'ai_seo'
  union all
  select 'web_seo'::text,  client_id, updated_at, status, is_blocked from base where service_type = 'ai_seo'
  union all
  select 'local_seo'::text, client_id, updated_at, status, is_blocked from base where service_type = 'ai_seo'
)
select s.service_type, c.id as client_id, c.name as client_name, c.industry,
       c.status as client_status, c.email, c.contact_first_name, c.contact_last_name,
       max(s.updated_at) as last_activity,
       count(*) filter (where s.status = 'active') as active_jobs,
       bool_or(s.is_blocked) as any_blocked
from sources s
join public.clients c on c.id = s.client_id
group by s.service_type, c.id, c.name, c.industry, c.status, c.email,
         c.contact_first_name, c.contact_last_name;

grant select on public.tech_my_clients to authenticated;
