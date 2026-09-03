-- =============================================================================
-- 20260903210000_email_inbox.sql
-- CRM Inbox (owner spec 2026-09-03):
--  §1 per-user read state for email_messages
--  §2 unfiled rows (no card ids) become visible to admins + the capturing
--     shared-mailbox department + the capturing user
--  §3 SECURITY DEFINER filing RPC: unfiled message (+ thread) -> lead/client
--  §4 email_messages joins supabase_realtime so the topbar badge is live
-- Coordination: the select-policy base body is 20260903140000 (the parallel
-- session's emission) — verify live md5 before applying; changes are additive.
-- =============================================================================

-- §1 read state ---------------------------------------------------------------
create table if not exists public.email_message_reads (
  message_pk uuid not null references public.email_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_pk, user_id)
);
alter table public.email_message_reads enable row level security;
drop policy if exists email_message_reads_own on public.email_message_reads;
create policy email_message_reads_own on public.email_message_reads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- §2 unfiled visibility -------------------------------------------------------
-- Base body: 20260903140000_email_visibility_technical_boards.sql, verbatim,
-- plus ONE new top-level OR branch for unfiled rows.
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
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
  -- 2026-09-03 Inbox: unfiled captures (no card at all) are workable items —
  -- admins, the capturing user, and the capturing shared-mailbox's department.
  or (
    client_id is null and lead_id is null and job_id is null and deal_id is null
    and (
      public.current_user_is_admin()
      or captured_from_user_id = auth.uid()
      or exists (
        select 1 from public.shared_mailboxes sm
         where sm.user_id = email_messages.captured_from_user_id
           and public.current_user_can(sm.department, 'view')
      )
    )
  )
);

-- §3 filing RPC ---------------------------------------------------------------
create or replace function public.file_email_message(
  p_message_pk uuid, p_target_type text, p_target_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.email_messages;
  v_dept text;
  v_moved int := 0;
begin
  if p_target_type not in ('lead', 'client') then
    raise exception 'bad_target_type';
  end if;
  select * into m from public.email_messages where id = p_message_pk;
  if m.id is null then raise exception 'message_not_found'; end if;
  if m.client_id is not null or m.lead_id is not null
     or m.job_id is not null or m.deal_id is not null then
    raise exception 'already_filed';
  end if;

  -- department: the capturing shared mailbox's, else 'sales'
  select sm.department into v_dept from public.shared_mailboxes sm
   where sm.user_id = m.captured_from_user_id;
  v_dept := coalesce(v_dept, 'sales');

  if p_target_type = 'lead' then
    if not exists (select 1 from public.leads where id = p_target_id) then
      raise exception 'lead_not_found';
    end if;
    update public.email_messages em
       set lead_id = p_target_id, department = 'sales'
     where em.client_id is null and em.lead_id is null
       and em.job_id is null and em.deal_id is null
       and (em.id = p_message_pk
            or (m.thread_id is not null and em.thread_id = m.thread_id)
            or lower(em.from_email) = lower(m.from_email));
  else
    if not exists (select 1 from public.clients where id = p_target_id) then
      raise exception 'client_not_found';
    end if;
    update public.email_messages em
       set client_id = p_target_id, department = v_dept
     where em.client_id is null and em.lead_id is null
       and em.job_id is null and em.deal_id is null
       and (em.id = p_message_pk
            or (m.thread_id is not null and em.thread_id = m.thread_id)
            or lower(em.from_email) = lower(m.from_email));
  end if;
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;
revoke execute on function public.file_email_message(uuid, text, uuid) from public, anon;
grant execute on function public.file_email_message(uuid, text, uuid) to authenticated;

-- §4 realtime -----------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.email_messages;
exception when duplicate_object then null;
end $$;

-- ROLLBACK:
--   drop function if exists public.file_email_message(uuid, text, uuid);
--   drop table if exists public.email_message_reads;
--   alter publication supabase_realtime drop table public.email_messages;
--   re-run the CREATE POLICY from 20260903140000 (removes the unfiled branch).
