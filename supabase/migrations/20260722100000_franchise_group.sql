-- 20260722100000_franchise_group.sql
-- Spec: docs/superpowers/specs/2026-07-21-franchise-lead-source-design.md (next steps)
--
-- Owner request 2026-07-22: create a Franchise group mirroring the Web Dev
-- group's shape (7 board actions + clients view) and add mkifokeris@itdev.gr
-- as a member (NOT team lead — owner said "member"; flip is_team_lead later if
-- franchise jobs should auto-own to him). The franchise BOARD (stages, routes,
-- service_type wiring) ships separately with the full franchise-service plan —
-- these rows alone change nothing user-visible yet.
--
-- ROLLBACK:
--   delete from public.user_groups where group_id = (select id from public.groups where code = 'franchise');
--   delete from public.group_permissions where group_id = (select id from public.groups where code = 'franchise');
--   delete from public.groups where code = 'franchise';

insert into public.groups (code, display_names, parent_label, position)
select 'franchise', '{"en":"Franchise","el":"Franchise"}'::jsonb, 'Technical',
       coalesce((select max(position) from public.groups), 0) + 1
 where not exists (select 1 from public.groups where code = 'franchise');

insert into public.group_permissions (group_id, board, action, scope)
select g.id, v.board, v.action, 'group'
  from public.groups g,
       (values ('franchise','view'), ('franchise','edit'), ('franchise','move_stage'),
               ('franchise','complete_job'), ('franchise','comment'),
               ('franchise','attach_file'), ('franchise','assign_owner'),
               ('clients','view')) as v(board, action)
 where g.code = 'franchise'
   and not exists (select 1 from public.group_permissions gp
                    where gp.group_id = g.id and gp.board = v.board and gp.action = v.action);

insert into public.user_groups (user_id, group_id, is_team_lead)
select u.id, g.id, false
  from auth.users u, public.groups g
 where u.email = 'mkifokeris@itdev.gr' and g.code = 'franchise'
   and not exists (select 1 from public.user_groups ug
                    where ug.user_id = u.id and ug.group_id = g.id);
