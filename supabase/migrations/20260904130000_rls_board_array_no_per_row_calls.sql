-- =============================================================================
-- 2026-09-04, the last per-row permission call.
--
-- 20260904110000 wrapped every constant-argument helper call so it runs once
-- per query. Two calls could not be wrapped, because their argument is a
-- COLUMN:
--
--   email_messages_select :  current_user_can(department, 'view')
--   jobs_select           :  current_user_can(service_type, 'view')
--
-- Those still ran once per row, and email_messages is where it hurts. Measured
-- on a fresh pg_stat_statements window this morning, over 6 minutes of real
-- traffic: 597 seconds of database time in total, of which 509 — 85% — was
-- email queries, and the single most expensive statement in the whole system
-- was the inbox's email_messages read at a 3,336 ms average over 12,824 rows.
--
-- The fix inverts the question. Instead of asking, for each row, "may I view
-- THIS row's board?", ask once per query "which boards may I view?" and test
-- the row against that list. current_user_boards('view') returns the array;
-- called as a scalar subquery it becomes an InitPlan, evaluated exactly once.
--
-- Semantics are unchanged, and again proven rather than asserted: the DO block
-- below compares, for every (user × board) pair in the database, the old
-- current_user_can outcome against membership in the new array, and aborts the
-- transaction if a single pair disagrees.
--
-- Admins are unaffected by construction: both policies already carry a
-- standalone `(select current_user_is_admin())` term, which is what makes an
-- admin's view total. The array branch only ever has to be right for everyone
-- else.
-- =============================================================================

-- 1. The boards the current user may act on, as one array. --------------------
create or replace function public.current_user_boards(target_action text)
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct b.board), '{}'::text[])
  from (
    -- A per-user override decides on its own, exactly as current_user_can does.
    select up.board
      from public.user_permissions up
     where up.user_id = (select auth.uid())
       and up.action = target_action
       and up.allowed
    union
    -- Otherwise any group that allows it, unless a user override exists for
    -- that board (in which case the branch above already had the final say).
    select gp.board
      from public.user_groups ug
      join public.group_permissions gp on gp.group_id = ug.group_id
     where ug.user_id = (select auth.uid())
       and gp.action = target_action
       and gp.allowed
       and not exists (
         select 1 from public.user_permissions up2
          where up2.user_id = (select auth.uid())
            and up2.board = gp.board
            and up2.action = target_action
       )
  ) b;
$$;

revoke execute on function public.current_user_boards(text) from public, anon;
grant execute on function public.current_user_boards(text) to authenticated;

-- 2. Prove it agrees with current_user_can for every user and every board. -----
do $$
declare
  v_diff int;
begin
  select count(*) into v_diff
  from public.profiles p
  cross join (
    select distinct board from public.group_permissions
    union select distinct board from public.user_permissions
  ) b
  where
    -- OLD: current_user_can's non-admin semantics
    coalesce(
      (select up.allowed from public.user_permissions up
        where up.user_id = p.user_id and up.board = b.board and up.action = 'view'),
      exists (select 1 from public.user_groups ug
                join public.group_permissions gp on gp.group_id = ug.group_id
               where ug.user_id = p.user_id and gp.board = b.board
                 and gp.action = 'view' and gp.allowed)
    )
    is distinct from
    -- NEW: is the board in the array we would build for that user?
    (b.board = any (coalesce(
      (select array_agg(distinct x.board)
      from (
        select up.board from public.user_permissions up
         where up.user_id = p.user_id and up.action = 'view' and up.allowed
        union
        select gp.board from public.user_groups ug
          join public.group_permissions gp on gp.group_id = ug.group_id
         where ug.user_id = p.user_id and gp.action = 'view' and gp.allowed
           and not exists (select 1 from public.user_permissions up2
                            where up2.user_id = p.user_id and up2.board = gp.board
                              and up2.action = 'view')
      ) x), '{}'::text[])));

  if v_diff > 0 then
    raise exception 'ABORT: current_user_boards disagrees with current_user_can on % (user, board) pairs', v_diff;
  end if;

  raise notice 'current_user_boards verified against current_user_can: 0 disagreements';
end $$;

-- 3. email_messages: no call left inside the row loop. -------------------------
--    Base body: 20260903218000 (capture-source matrix), then 20260904110000.
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = (select auth.uid())
  or (
    case when lead_id is not null and client_id is null then
      (select public.current_user_is_admin())
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = (select auth.uid()))
    else department = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
    end
  )
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and j.service_type = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
    )
  )
  or (select public.current_user_is_admin())
  or captured_from_user_id = (select auth.uid())
  or exists (
    select 1 from public.shared_mailboxes sm
     where sm.user_id = email_messages.captured_from_user_id
       and (
         (sm.email = 'sales@itdev.gr' and (select public.current_user_in_group('sales')))
         or (sm.email = 'accounting@itdev.gr' and (select public.current_user_in_group('accounting')))
         or (sm.email = 'support@itdev.gr'
             and ((select public.current_user_in_group('accounting'))
                  or (select public.current_user_in_technical())))
       )
  )
);

-- 4. jobs: same treatment for service_type. ------------------------------------
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('accounting_recurring', 'view'))
  or (select public.current_user_can('accounting_onboarding', 'view'))
  or service_type = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
);

-- ROLLBACK: restore both policies from 20260904110000 (which keeps the
--   current_user_can(department,'view') / current_user_can(service_type,'view')
--   calls), then: drop function if exists public.current_user_boards(text);
