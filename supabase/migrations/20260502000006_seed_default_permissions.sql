-- =============================================================================
-- Phase 2 — Seed default group permissions (idempotent)
-- =============================================================================
-- Each group gets a sensible baseline. Admin overrides happen via the
-- /admin/groups/:id/permissions UI (or per-user via /admin/users/:id/permissions).
-- ON CONFLICT DO NOTHING so re-running this migration is safe.

with seed as (
  -- Every group: view its own board (group scope)
  select id as group_id, code as board, 'view'::text as action, 'group'::text as scope, true as allowed
  from public.groups
  where code in ('sales','accounting','web_seo','local_seo','web_dev','social_media')

  -- Sales actions on sales board
  union all select id, 'sales', 'create', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'edit', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'move_stage', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'comment', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'attach_file', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'lock_deal', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'assign_owner', 'group', true from public.groups where code = 'sales'

  -- Accounting on accounting boards
  union all select id, 'accounting_onboarding', 'view', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'edit', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'move_stage', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'complete_accounting', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'comment', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'attach_file', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'view', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'edit', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'block_client', 'all', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'unblock_client', 'all', true from public.groups where code = 'accounting'

  -- Tech sub-departments on their own board
  union all select id, code, 'edit', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'move_stage', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'complete_job', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'comment', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'attach_file', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'assign_owner', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')

  -- All operational groups: read-only view on the clients board (so they see clients in My Clients pages later)
  union all select id, 'clients', 'view', 'group', true from public.groups
)
insert into public.group_permissions (group_id, board, action, scope, allowed)
select group_id, board, action, scope, allowed from seed
on conflict (group_id, board, action) do nothing;
