-- 2026-06-30: revoke the sales-manager (view_all) per-user override on
-- tvogiatzi@itdev.gr so the account behaves identically to the other 6
-- sales reps (own-leads-only on /sales/leads and global search).
-- Profile flags + group membership (already 'sales' only, non-admin) need
-- no change. Reverses 20260618000009_leads_view_all_manager.sql's per-user
-- grant; the leads_select RLS policy and current_user_can() infra are kept
-- intact so the capability can be re-granted to anyone in the future.
delete from public.user_permissions up
  using public.profiles p
 where p.email = 'tvogiatzi@itdev.gr'
   and up.user_id = p.user_id
   and up.board   = 'sales'
   and up.action  = 'view_all';

-- ROLLBACK:
-- insert into public.user_permissions (user_id, board, action, scope, allowed)
-- select p.user_id, 'sales', 'view_all', 'all', true
--   from public.profiles p where p.email = 'tvogiatzi@itdev.gr';
