-- =============================================================================
-- 2026-09-04 (owner, looking at Stavroula's account): «αυτό ήρθε στο προσωπικό
-- του mkifokeris@ — γιατί μπορεί να το δει η Σταυρούλα;»
--
-- Because of one default. file_email_message takes a filed message's department
-- from the shared mailbox that captured it, and a personal mailbox has no row
-- in shared_mailboxes, so it fell through to:
--
--     v_dept := coalesce(v_dept, 'sales');
--
-- Every personal email anyone filed onto a client card was therefore stamped as
-- SALES mail, and email_messages_select hands department-stamped mail to
-- everyone holding that board. Measured before this migration:
--
--     vdimitrov@       710 personal messages readable by the whole sales board
--     marios@          663   (the owner's own)
--     cpostantzian@    429
--     akotzampasakis@  339
--     mkifokeris@      207
--     ...              3,150 in total
--
-- And not only sales: the same mechanism left 410 personal messages stamped
-- accounting, 334 local_seo, 329 web_seo, 234 web_dev, 128 social_media, 50 ads.
-- The owner asked for this fixed generally, not per department.
--
-- Two halves:
--   1. the cause — no more default, so newly filed personal mail carries no
--      department at all;
--   2. the policy — the department branch stops granting access to mail that
--      came from a personal mailbox, which closes the 3,150 existing messages
--      immediately, with no data backfill.
--
-- NOT in scope, by the owner's decision: Stavroula seeing sales@ mail. She is in
-- the sales group on purpose (387 leads) and that access is correct.
--
-- Note on the lead branch below: it still writes department = 'sales', and that
-- is deliberate. A lead-filed message has client_id null, so the policy takes
-- its lead branch (admin or the lead's owner) and never consults department —
-- there is nothing to leak there, and changing it would alter filing behaviour
-- for no benefit.
--
-- Drift check: md5(pg_get_functiondef) of file_email_message before this
-- migration = f03040b1ea2139d8cc1b157b51eb671c
-- =============================================================================

CREATE OR REPLACE FUNCTION public.file_email_message(p_message_pk uuid, p_target_type text, p_target_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- department: the capturing shared mailbox's — and NOTHING when the mail came
  -- from someone's personal mailbox. It used to default to 'sales', which is
  -- how 3,150 personal messages ended up readable by the whole sales board.
  -- A null department means "belongs to the card and to its person, not to a
  -- team"; email_messages_select treats it that way.
  select sm.department into v_dept from public.shared_mailboxes sm
   where sm.user_id = m.captured_from_user_id;

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
end $function$;


-- -----------------------------------------------------------------------------
-- The policy. Base body: 20260904130000 (board-array form, InitPlan preserved).
-- The only change is the `else` branch of the CASE: department may still grant
-- access, but only for mail that arrived in a SHARED mailbox. Mail captured
-- from a person's own mailbox is theirs — plus admins, plus the existing job
-- and lead branches, which are untouched.
-- -----------------------------------------------------------------------------
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = (select auth.uid())
  or (
    case when lead_id is not null and client_id is null then
      (select public.current_user_is_admin())
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = (select auth.uid()))
    else
      department = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
      and (
        -- CRM-sent mirrors have no capturer: they stay team mail.
        captured_from_user_id is null
        -- Otherwise the department only counts if a shared mailbox caught it.
        or exists (select 1 from public.shared_mailboxes sm
                    where sm.user_id = email_messages.captured_from_user_id)
      )
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

-- ROLLBACK:
--   restore file_email_message with `v_dept := coalesce(v_dept, 'sales');`
--   (definition 20260903210000_email_inbox.sql:66-117), and restore
--   email_messages_select from 20260904130000.
