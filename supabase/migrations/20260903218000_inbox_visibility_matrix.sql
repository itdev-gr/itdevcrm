-- =============================================================================
-- 20260903218000_inbox_visibility_matrix.sql
-- Owner's per-role email visibility matrix (2026-09-03):
--   sales      -> sales@ captures + their own
--   accounting -> own + accounting@ + support@ captures
--   technical  -> own + support@ captures
--   admins     -> everything (incl. info@ / «Άλλο»)
-- Replaces: the blanket `group_member_ids('accounting')` line (accounting no
-- longer sees ALL mail) and the unfiled-only branch from 20260903210000
-- (superseded by the matrix, which covers unfiled AND filed rows by capture
-- source). Card-based branches (own / lead owner / job board / department)
-- are kept byte-identical. Policy co-owned with two parallel sessions —
-- coordinate before applying.
-- =============================================================================

create or replace function public.current_user_in_technical()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where ug.user_id = auth.uid() and g.parent_label = 'Technical'
  );
$$;
revoke execute on function public.current_user_in_technical() from public, anon;
grant execute on function public.current_user_in_technical() to authenticated;

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
  -- 2026-09-03 visibility matrix: capture-source access. Applies to every row
  -- (filed or unfiled) based on which mailbox pulled it in.
  or public.current_user_is_admin()
  or captured_from_user_id = auth.uid()
  or exists (
    select 1 from public.shared_mailboxes sm
     where sm.user_id = email_messages.captured_from_user_id
       and (
         (sm.email = 'sales@itdev.gr'      and public.current_user_in_group('sales'))
         or (sm.email = 'accounting@itdev.gr' and public.current_user_in_group('accounting'))
         or (sm.email = 'support@itdev.gr'
             and (public.current_user_in_group('accounting') or public.current_user_in_technical()))
       )
  )
);

-- ROLLBACK: drop function if exists public.current_user_in_technical();
-- re-run the CREATE POLICY from 20260903210000_email_inbox.sql (restores the
-- blanket accounting line + the unfiled-only branch).
