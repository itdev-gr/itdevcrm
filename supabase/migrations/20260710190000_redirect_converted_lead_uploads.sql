-- 2026-07-10: attachments/comments added to an ALREADY-CONVERTED lead stay
-- stranded on the lead (convert_lead_to_client reparents only what exists at
-- conversion time; the lead page still accepts uploads afterwards). Root fix:
-- redirect such inserts to the converted deal — same destination the
-- conversion-time reparent uses. Applies to task auto-comments too (their
-- thread reads by task_key, unaffected; the channel copy lands on the deal).
create or replace function public.redirect_converted_lead_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deal uuid;
begin
  if new.parent_type = 'lead' then
    select converted_deal_id into v_deal
      from leads where id = new.parent_id and converted_at is not null;
    if v_deal is not null then
      new.parent_type := 'deal';
      new.parent_id := v_deal;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists attachments_redirect_converted_lead on public.attachments;
create trigger attachments_redirect_converted_lead
  before insert on public.attachments
  for each row execute function public.redirect_converted_lead_parent();

drop trigger if exists comments_redirect_converted_lead on public.comments;
create trigger comments_redirect_converted_lead
  before insert on public.comments
  for each row execute function public.redirect_converted_lead_parent();

-- One-off: move everything already stranded on converted leads.
update public.attachments a set parent_type = 'deal', parent_id = l.converted_deal_id
  from public.leads l
 where a.parent_type = 'lead' and a.parent_id = l.id
   and l.converted_at is not null and l.converted_deal_id is not null;

update public.comments c set parent_type = 'deal', parent_id = l.converted_deal_id
  from public.leads l
 where c.parent_type = 'lead' and c.parent_id = l.id
   and l.converted_at is not null and l.converted_deal_id is not null;

-- ROLLBACK:
--   drop trigger if exists attachments_redirect_converted_lead on public.attachments;
--   drop trigger if exists comments_redirect_converted_lead on public.comments;
--   drop function if exists public.redirect_converted_lead_parent();
--   (backfilled rows are indistinguishable from conversion-time reparents; no undo)
