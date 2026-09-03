-- =============================================================================
-- 2026-09-03 (owner: «στους technical θέλω να δουλεύει το email 100%»):
-- captured mail on some technical jobs was invisible to the team.
--
-- `email_messages_select` gates non-own rows on current_user_can(department,
-- 'view'), and `department` for a code-matched email is the job's service_type
-- (resolve_email_filing). Three service types have a real group but no seeded
-- board grant — ai_seo, hosting, ads (20260502000006 seeds only sales /
-- accounting / web_seo / local_seo / web_dev / social_media; later migrations
-- added support, franchise, maintenance, domains). service_type 'other' is not
-- a group at all, so filing nulls the department entirely.
--
-- Result: such an email was readable only by admins, the accounting group, and
-- whoever was personally the sender/recipient — a colleague on the same board
-- opened the job's Emails tab and saw nothing. `job_emails` is SECURITY INVOKER
-- (20260713110000:24), so it does not paper over this.
--
-- Two fixes, both needed:
--   1. the missing view grants (idempotent — if an admin already added them
--      through /admin/groups this is a no-op and prod's scope wins);
--   2. a job-based branch in the policy, so a job-filed email follows the JOB's
--      board rather than a department string that can be null or stale.
--
-- Base policy body: 20260713160000_accounting_sees_all_emails.sql:6-17.
-- Run the drift check in the deploy script before applying.
-- =============================================================================

-- 1. The three missing board view grants --------------------------------------
insert into public.group_permissions (group_id, board, action, scope, allowed)
select g.id, g.code, 'view', 'group', true
  from public.groups g
 where g.code in ('ai_seo', 'hosting', 'ads')
on conflict (group_id, board, action) do nothing;

-- 2. Job-filed mail follows the job's board -----------------------------------
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (select auth.uid()) in (select public.group_member_ids('accounting'))
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
  -- Filed on a job: the job's own board decides, which also covers a null or
  -- mismatched `department` (service_type 'other', or a code the filing rules
  -- could not map). Scoped to job_id so the row count stays small.
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
);

-- ROLLBACK:
--   delete from public.group_permissions gp
--    using public.groups g
--    where g.id = gp.group_id and gp.action = 'view'
--      and gp.board = g.code and g.code in ('ai_seo','hosting','ads');
--   -- (only if the drift check confirmed they did NOT exist beforehand)
--   drop policy if exists email_messages_select on public.email_messages;
--   create policy email_messages_select on public.email_messages for select using (
--     staff_user_id = auth.uid()
--     or (select auth.uid()) in (select public.group_member_ids('accounting'))
--     or (
--       case when lead_id is not null and client_id is null then
--         public.current_user_is_admin()
--         or exists (select 1 from public.leads l
--                     where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
--       else public.current_user_can(department, 'view')
--       end
--     )
--   );
