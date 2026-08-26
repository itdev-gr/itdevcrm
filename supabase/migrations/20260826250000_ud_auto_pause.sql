-- =============================================================================
-- 2026-08-26: AUTO-PAUSE — when an Under Development lead shows a sign of life
-- (replies by email, or calls in through the PBX), their live automation chain
-- pauses ITSELF and the owner gets notified to take over by hand. No automated
-- email should ever chase someone who just reached out.
--
-- Signals already flowing through the system:
--   * email_messages INSERT with direction='inbound' and lead_id (gmail-sync)
--   * call_log UPDATE where the router matched an Inbound call to a lead
--     (call_log_route_comment sets matched_type/matched_id via UPDATE)
--
-- Behavior: only an ACTIVE run pauses (already-paused/stopped chains ignore
-- further signals); a ⏸ system line lands on the lead timeline; the owner gets
-- a 'cadence_auto_paused' notification deep-linking to the lead. The whole
-- feature sits behind ud_cadence_settings.auto_pause_enabled (default ON,
-- admin-editable on the Sales Automations page).
--
-- ROLLBACK: see block at the end.
-- =============================================================================

alter table public.ud_cadence_settings
  add column if not exists auto_pause_enabled boolean not null default true;

create or replace function public.ud_auto_pause_lead(p_lead_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ud_cadence_runs;
  l public.leads;
begin
  if not coalesce((select auto_pause_enabled from public.ud_cadence_settings limit 1), true) then
    return;
  end if;

  select * into r from public.ud_cadence_runs
   where lead_id = p_lead_id and status = 'active'
   for update;
  if r.id is null then return; end if;

  update public.ud_cadence_runs set status = 'paused' where id = r.id;

  select * into l from public.leads where id = p_lead_id;

  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values ('lead', p_lead_id, coalesce(l.owner_user_id, l.created_by),
          '⏸ Αυτόματη παύση αλυσίδας — '
            || case p_reason when 'email' then 'ο lead απάντησε με email.'
                             else 'ο lead μάς κάλεσε.' end,
          '{}', 'cadence:auto_pause:' || r.id);

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'cadence_auto_paused',
      jsonb_build_object(
        'parent_type', 'lead', 'parent_id', p_lead_id,
        'lead_title', l.title, 'reason', p_reason));
  end if;
end $$;

revoke execute on function public.ud_auto_pause_lead(uuid, text) from public, anon, authenticated;

-- Inbound email from the lead.
create or replace function public.ud_email_auto_pause()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ud_auto_pause_lead(new.lead_id, 'email');
  return new;
end $$;

create trigger trg_ud_email_auto_pause
  after insert on public.email_messages
  for each row when (new.direction = 'inbound' and new.lead_id is not null)
  execute function public.ud_email_auto_pause();

-- Inbound PBX call matched to a lead (the router stamps matched_* via UPDATE).
create or replace function public.ud_call_auto_pause()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ud_auto_pause_lead(new.matched_id, 'call');
  return new;
end $$;

create trigger trg_ud_call_auto_pause
  after update on public.call_log
  for each row when (
    new.call_type = 'Inbound' and new.matched_type = 'lead'
    and new.matched_id is not null
    and old.matched_id is distinct from new.matched_id
  )
  execute function public.ud_call_auto_pause();

revoke execute on function public.ud_email_auto_pause() from public, anon, authenticated;
revoke execute on function public.ud_call_auto_pause() from public, anon, authenticated;

-- ROLLBACK:
-- drop trigger if exists trg_ud_call_auto_pause on public.call_log;
-- drop function if exists public.ud_call_auto_pause();
-- drop trigger if exists trg_ud_email_auto_pause on public.email_messages;
-- drop function if exists public.ud_email_auto_pause();
-- drop function if exists public.ud_auto_pause_lead(uuid, text);
-- alter table public.ud_cadence_settings drop column if exists auto_pause_enabled;
