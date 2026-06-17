-- Fix: accounting users couldn't save edits to client fields (e.g. the company
-- Name on a deal). The clients_update RLS allows admin / clients:edit / sales:edit,
-- but the accounting group only had clients:view — so their edits were silently
-- rejected by RLS (0 rows, no error). Accounting manages billing/client records,
-- so grant them clients:edit.
insert into public.group_permissions (group_id, board, action, scope, allowed)
select g.id, 'clients', 'edit', 'all', true
  from public.groups g
 where g.code = 'accounting'
   and not exists (
     select 1 from public.group_permissions gp
      where gp.group_id = g.id and gp.board = 'clients' and gp.action = 'edit'
   );

-- ROLLBACK:
-- delete from public.group_permissions gp using public.groups g
--  where gp.group_id=g.id and g.code='accounting' and gp.board='clients' and gp.action='edit';
