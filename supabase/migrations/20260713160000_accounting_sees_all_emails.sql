-- 2026-07-13 (owner): accounting-group members see ALL captured emails
-- (oversight role, same pattern as accounting reading all assigned_tasks).
-- Covers both branches (dept-siloed AND pre-conversion lead mail).
-- Base policy: 20260710150000_lead_email_capture.sql. ROLLBACK: re-apply it.
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
);
