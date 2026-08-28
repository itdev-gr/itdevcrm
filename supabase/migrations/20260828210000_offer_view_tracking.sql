-- =============================================================================
-- 2026-08-28: Offer-open tracking (owner request) — when a client opens the
-- public offer link (/o/<token> → api/offer-view.ts), the view is recorded and
-- an automatic system comment lands on the lead's card (or the deal/client if
-- the offer isn't lead-bound). Auto-comment pattern of 20260709170000 /
-- 20260825190000 (security definer, task_key, empty mentions); the existing
-- comments_redirect_converted_lead trigger sends a converted lead's comment to
-- its deal automatically.
--
-- Writes come only from the service-role endpoint; suspected scanner/preview
-- bots are recorded but never commented; a 60-minute throttle keeps repeated
-- opens from spamming the card.
-- =============================================================================

create table if not exists public.offer_views (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references public.offers (id) on delete cascade,
  viewed_at     timestamptz not null default now(),
  ip            text,
  user_agent    text,
  suspected_bot boolean not null default false
);

create index if not exists offer_views_offer_time on public.offer_views (offer_id, viewed_at desc);

alter table public.offer_views enable row level security;
drop policy if exists offer_views_select on public.offer_views;
create policy offer_views_select on public.offer_views
  for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('clients', 'view')
  );
-- Writes: service role only (the public viewer endpoint).

create or replace function public.offer_views_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_offer record;
  v_parent_type text;
  v_parent_id uuid;
  v_author uuid;
  v_count int;
begin
  if new.suspected_bot then
    return null; -- recorded, never surfaced
  end if;

  -- Throttle: at most one comment per offer per hour.
  if exists (
    select 1 from public.offer_views ov
     where ov.offer_id = new.offer_id and not ov.suspected_bot
       and ov.id <> new.id
       and ov.viewed_at > new.viewed_at - interval '60 minutes'
  ) then
    return null;
  end if;

  begin
    select o.offer_number, o.lead_id, o.deal_id, o.client_id, o.created_by
      into v_offer from public.offers o where o.id = new.offer_id;

    if v_offer.lead_id is not null then
      v_parent_type := 'lead'; v_parent_id := v_offer.lead_id;
    elsif v_offer.deal_id is not null then
      v_parent_type := 'deal'; v_parent_id := v_offer.deal_id;
    elsif v_offer.client_id is not null then
      v_parent_type := 'client'; v_parent_id := v_offer.client_id;
    else
      return null; -- orphan offer: log only
    end if;

    v_author := v_offer.created_by;
    if v_author is null and v_offer.lead_id is not null then
      select owner_user_id into v_author from public.leads where id = v_offer.lead_id;
    end if;
    if v_author is null then
      return null; -- comments require an author; keep the view row only
    end if;

    select count(*) into v_count
      from public.offer_views where offer_id = new.offer_id and not suspected_bot;

    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
    values (
      v_parent_type, v_parent_id, v_author,
      '👀 Ο πελάτης άνοιξε την προσφορά ' || coalesce(v_offer.offer_number, '') ||
      ' — ' || to_char(new.viewed_at at time zone 'Europe/Athens', 'DD/MM HH24:MI') ||
      case when v_count > 1 then ' (' || v_count || 'ο άνοιγμα)' else '' end,
      '{}', 'offer_view:' || new.id
    );
  exception when others then
    null; -- the view row must never be lost to a comment failure
  end;

  return null;
end $$;

drop trigger if exists offer_views_notify_trg on public.offer_views;
create trigger offer_views_notify_trg
  after insert on public.offer_views
  for each row execute function public.offer_views_notify();

-- ROLLBACK:
--   drop trigger if exists offer_views_notify_trg on public.offer_views;
--   drop function if exists public.offer_views_notify();
--   drop table if exists public.offer_views;
--   -- optionally: delete from public.comments where task_key like 'offer_view:%';
