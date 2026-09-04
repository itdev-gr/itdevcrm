-- =============================================================================
-- 2026-09-04 (owner: «θέλω το CRM να είναι γρήγορο»): the permission check was
-- costing more than every query it guarded.
--
-- Measured on prod before this migration:
--
--   count(*) over public.leads (6,786 rows) as an ordinary sales user:  39,267 ms
--   the same count as postgres, with RLS bypassed:                       2,322 ms
--
-- ~37 seconds of pure permission checking on a 6,786-row table. The tables in
-- this database are small; the cost is entirely in how often, and how
-- expensively, the check runs.
--
-- WHY: RLS policies call current_user_can(...) once PER ROW (96 of the 135
-- policies do), and current_user_can asks the view user_effective_permissions,
-- which FULL JOINs user_permissions against a GROUP BY over the group
-- permissions of EVERY user and only then filters down to one person. So each
-- row of each query rebuilt the whole company's permission matrix.
--
-- THIS MIGRATION CHANGES NO RULE. Who may see what is bit-for-bit identical;
-- only the cost changes, from "recompute the matrix" to two index lookups:
--   * user_permissions_user_id_board_action_key  (user_id, board, action)
--   * user_groups_pkey (user_id, group_id) + group_permissions_group_id_board_action_key
--
-- The equivalence is not asserted, it is PROVEN below over every
-- (user × board × action) triple that exists in this database, inside the same
-- transaction: if a single outcome would differ, the migration raises and the
-- whole thing rolls back.
--
-- Drift check — md5(pg_get_functiondef(oid)) before this migration:
--   current_user_can  <recorded by the apply script; see scratchpad>
-- =============================================================================

-- 1. Prove old and new agree, for everyone, on everything. ---------------------
do $$
declare
  v_diff int;
begin
  select count(*) into v_diff
  from (
    select
      p.user_id, b.board, a.action,
      -- OLD: exactly what current_user_can does today, minus the admin shortcut
      -- (unchanged below, so it cannot introduce a difference).
      exists (
        select 1 from public.user_effective_permissions uep
         where uep.user_id = p.user_id and uep.board = b.board
           and uep.action = a.action and uep.allowed = true
      ) as old_allowed,
      -- NEW: user-level override wins, else any group that allows it.
      coalesce(
        (select up.allowed from public.user_permissions up
          where up.user_id = p.user_id and up.board = b.board and up.action = a.action),
        exists (
          select 1 from public.user_groups ug
            join public.group_permissions gp on gp.group_id = ug.group_id
           where ug.user_id = p.user_id and gp.board = b.board
             and gp.action = a.action and gp.allowed
        )
      ) as new_allowed
    from public.profiles p
    cross join (
      select distinct board from public.group_permissions
      union select distinct board from public.user_permissions
    ) b
    cross join (
      select distinct action from public.group_permissions
      union select distinct action from public.user_permissions
    ) a
  ) x
  where x.old_allowed is distinct from x.new_allowed;

  if v_diff > 0 then
    raise exception
      'ABORT: the current_user_can rewrite would change % (user, board, action) outcomes', v_diff;
  end if;

  raise notice 'current_user_can rewrite verified: 0 differing outcomes';
end $$;

-- 2. Same answer, index lookups instead of a company-wide matrix. --------------
create or replace function public.current_user_can(target_board text, target_action text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select
    public.current_user_is_admin()
    or coalesce(
         -- A per-user override, when one exists, decides on its own — including
         -- an explicit deny that overrules the user's groups.
         (select up.allowed
            from public.user_permissions up
           where up.user_id = (select auth.uid())
             and up.board = target_board
             and up.action = target_action),
         -- Otherwise: any group the user belongs to that allows it.
         exists (
           select 1
             from public.user_groups ug
             join public.group_permissions gp on gp.group_id = ug.group_id
            where ug.user_id = (select auth.uid())
              and gp.board = target_board
              and gp.action = target_action
              and gp.allowed
         )
       );
$$;

-- The view stays: /admin still reads it to show the resolved matrix, and it is
-- the reference this migration proved the rewrite against.

-- ROLLBACK:
--   create or replace function public.current_user_can(target_board text, target_action text)
--   returns boolean language sql stable security definer set search_path to 'public' as $$
--     select
--       public.current_user_is_admin() or exists (
--         select 1
--         from public.user_effective_permissions
--         where user_id = auth.uid()
--           and board = target_board
--           and action = target_action
--           and allowed = true
--       );
--   $$;
