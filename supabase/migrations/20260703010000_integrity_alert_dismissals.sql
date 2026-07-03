-- 2026-07-03: "Ignore" persistence for the Accounting Alerts page.
create table if not exists public.integrity_alert_dismissals (
  id uuid primary key default gen_random_uuid(),
  check_key   text not null,
  subject_id  uuid not null,
  signature   text not null default '',
  note        text,
  dismissed_by uuid references public.profiles(user_id),
  dismissed_at timestamptz not null default now(),
  unique (check_key, subject_id, signature)
);
alter table public.integrity_alert_dismissals enable row level security;
revoke all on table public.integrity_alert_dismissals from anon, authenticated;

create policy iad_read on public.integrity_alert_dismissals for select to authenticated
  using (public.current_user_is_admin() or public.current_user_in_group('accounting'));

create or replace function public.dismiss_integrity_alert(
  p_check_key text, p_subject_id uuid, p_signature text default '', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    raise exception 'not_authorized';
  end if;
  insert into public.integrity_alert_dismissals (check_key, subject_id, signature, note, dismissed_by)
    values (p_check_key, p_subject_id, coalesce(p_signature,''), p_note, auth.uid())
    on conflict (check_key, subject_id, signature)
      do update set note = excluded.note, dismissed_by = excluded.dismissed_by, dismissed_at = now()
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.dismiss_integrity_alert(text,uuid,text,text) from public, anon;
grant execute on function public.dismiss_integrity_alert(text,uuid,text,text) to authenticated;

create or replace function public.undismiss_integrity_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    raise exception 'not_authorized';
  end if;
  delete from public.integrity_alert_dismissals where id = p_id;
end $$;
revoke all on function public.undismiss_integrity_alert(uuid) from public, anon;
grant execute on function public.undismiss_integrity_alert(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists public.dismiss_integrity_alert(text,uuid,text,text);
--   drop function if exists public.undismiss_integrity_alert(uuid);
--   drop table if exists public.integrity_alert_dismissals;
