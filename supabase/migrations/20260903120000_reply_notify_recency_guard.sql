-- The sales@ 90-day backfill (started 2026-09-03) runs every inbound through
-- trg_lead_email_reply_notify, spraying stale «Απάντησε!» notifications and
-- timeline comments for months-old mail (79 of each within the first sweeps).
-- Guard: only messages sent within the last 3 days notify/comment — filing
-- itself is untouched. Plus cleanup of what the backfill already produced.

create or replace function public.lead_email_reply_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_author uuid;
  v_key text;
begin
  -- Backfill/re-scan guard: old mail is history, not a live reply.
  if new.sent_at is null or new.sent_at < now() - interval '3 days' then
    return new;
  end if;

  select * into l from public.leads where id = new.lead_id;
  if l.id is null then return new; end if;

  v_key := 'email_reply:' || coalesce(new.message_id, new.id::text);

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
  raise warning 'lead_email_reply_notify(%): %', new.lead_id, sqlerrm;
  return new;
end $$;

-- Cleanup: comments tied to old messages, and notifications whose lead has no
-- genuinely fresh inbound (the feature launched today, so everything else is
-- backfill noise).
delete from public.comments c
 using public.email_messages em
 where c.task_key = 'email_reply:' || em.message_id
   and (em.sent_at is null or em.sent_at < now() - interval '3 days');

delete from public.notifications n
 where n.type = 'lead_email_reply'
   and not exists (
     select 1 from public.email_messages em
      where em.lead_id = (n.payload->>'parent_id')::uuid
        and em.direction = 'inbound'
        and em.sent_at >= now() - interval '3 days');

-- ROLLBACK: re-run the CREATE OR REPLACE from
-- 20260903100000_sales_mailbox_and_reply_notify.sql (removes the guard);
-- deleted rows are noise, not restored.
