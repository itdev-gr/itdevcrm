-- =============================================================================
-- Phase 6 — Tech "My Clients" view per service_type.
-- Returns one row per (service_type, client) where the group has a
-- non-cancelled job updated within the last 90 days. RLS on the underlying
-- jobs table already restricts who can see what, so the view inherits that.
-- =============================================================================

create or replace view public.tech_my_clients
with (security_invoker = true) as
select
  j.service_type,
  c.id as client_id,
  c.name as client_name,
  c.industry,
  c.status as client_status,
  c.email,
  c.contact_first_name,
  c.contact_last_name,
  max(j.updated_at) as last_activity,
  count(*) filter (where j.status = 'active') as active_jobs,
  bool_or(j.is_blocked) as any_blocked
from public.jobs j
join public.clients c on c.id = j.client_id
where j.archived = false
  and j.status <> 'cancelled'
  and j.updated_at > now() - interval '90 days'
group by j.service_type, c.id, c.name, c.industry, c.status, c.email,
         c.contact_first_name, c.contact_last_name;

grant select on public.tech_my_clients to authenticated;
