-- =========================================================================
-- 20260903100000_sales_mailbox_and_reply_notify.sql
--
-- ChatGPT Ads campaign infrastructure (owner decisions 2026-09-03):
--  §1 Visual reply indication: when an inbound email is filed to a lead,
--     notify the lead's owner (type 'lead_email_reply' — new toast + board
--     badge) and drop an idempotent timeline comment. Separate trigger from
--     trg_ud_email_auto_pause, which keeps its own active-run gate.
--  §2 Register sales@itdev.gr as a shared mailbox (like accounting@/support@/
--     info@) so replies to campaign + UD cadence emails finally enter the
--     CRM. Requires the sales@ CRM profile to exist first (invite flow);
--     the insert is a no-op otherwise and safe to re-run.
-- =========================================================================

-- §1 ---------------------------------------------------------------------

create or replace function public.lead_email_reply_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_author uuid;
  v_key text;
begin
  select * into l from public.leads where id = new.lead_id;
  if l.id is null then return new; end if;

  v_key := 'email_reply:' || coalesce(new.message_id, new.id::text);

  -- Timeline note (idempotent on the message; ownerless+creatorless leads
  -- have no valid comments.author_id, skip silently — same rule as G4).
  v_author := coalesce(l.owner_user_id, l.created_by);
  if v_author is not null and not exists (
       select 1 from public.comments where task_key = v_key) then
    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
    values ('lead', new.lead_id, v_author,
            '📩 Ο πελάτης απάντησε με email.', '{}', v_key);
  end if;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_email_reply',
      jsonb_build_object(
        'parent_type', 'lead', 'parent_id', new.lead_id,
        'lead_title', l.title, 'from_email', new.from_email));
  end if;
  return new;
exception when others then
  -- A lead's reply must NEVER break the sync pipeline recording it.
  raise warning 'lead_email_reply_notify(%): %', new.lead_id, sqlerrm;
  return new;
end $$;

drop trigger if exists trg_lead_email_reply_notify on public.email_messages;
create trigger trg_lead_email_reply_notify
  after insert on public.email_messages
  for each row when (new.direction = 'inbound' and new.lead_id is not null)
  execute function public.lead_email_reply_notify();

-- §2 ---------------------------------------------------------------------
-- Reverses the 2026-07-13 "sales@ delivery only" decision: the ChatGPT Ads
-- campaign (and the UD cadences that already send via Resend reply-to
-- sales@) need replies captured. Department stays 'sales'.

insert into public.shared_mailboxes (user_id, email, department)
select user_id, lower(email), 'sales'
  from public.profiles
 where lower(email) = 'sales@itdev.gr'
on conflict (user_id) do nothing;

-- ROLLBACK:
--   drop trigger if exists trg_lead_email_reply_notify on public.email_messages;
--   drop function if exists public.lead_email_reply_notify();
--   delete from public.shared_mailboxes where email = 'sales@itdev.gr';
