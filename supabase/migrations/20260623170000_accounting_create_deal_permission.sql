-- =============================================================================
-- accounting_onboarding.create capability — lets accounting members create deals
-- from the board (admins are always allowed via current_user_is_admin()).
-- =============================================================================
insert into public.group_permissions (group_id, board, action, scope, allowed)
select id, 'accounting_onboarding', 'create', 'all', true
from public.groups
where code = 'accounting'
on conflict (group_id, board, action) do nothing;

-- Rollback:
-- delete from public.group_permissions
--  where board = 'accounting_onboarding' and action = 'create'
--    and group_id in (select id from public.groups where code = 'accounting');
