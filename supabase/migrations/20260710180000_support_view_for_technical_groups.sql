-- 2026-07-10: support@ mail belongs to the whole technical department (owner
-- direction): every group under the Technical umbrella can view department
-- 'support' emails. accounting@ already maps to the accounting group's own
-- board view. Parent-label-driven so future technical groups inherit.
insert into public.group_permissions (group_id, board, action, scope, allowed)
select g.id, 'support', 'view', 'group', true
  from public.groups g
 where g.parent_label = 'Technical' and not g.archived
on conflict (group_id, board, action) do nothing;

-- ROLLBACK:
--   delete from public.group_permissions gp
--    using public.groups g
--   where g.id = gp.group_id and gp.board = 'support' and gp.action = 'view'
--     and g.code <> 'support';
