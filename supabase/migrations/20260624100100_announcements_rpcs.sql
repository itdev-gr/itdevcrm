-- =============================================================================
-- Announcement RPCs. Admin-gated create/manage; user-facing read + dismiss.
-- =============================================================================

-- create_announcement: admin composes + publishes.
create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_severity text default 'info',
  p_target_all boolean default false,
  p_group_ids uuid[] default '{}',
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  errors text[] := '{}';
  v_title text;
  v_body text;
  v_id uuid;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  v_body  := nullif(trim(coalesce(p_body, '')), '');
  if v_title is null then errors := array_append(errors, 'missing_title'); end if;
  if v_body  is null then errors := array_append(errors, 'missing_body'); end if;
  if coalesce(p_severity, 'info') not in ('info','warning') then
    errors := array_append(errors, 'invalid_severity');
  end if;
  if not coalesce(p_target_all, false) and coalesce(array_length(p_group_ids, 1), 0) = 0 then
    errors := array_append(errors, 'missing_target');
  end if;
  if coalesce(array_length(errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  insert into public.announcements (title, body, severity, target_all, expires_at, created_by)
  values (v_title, v_body, coalesce(p_severity, 'info'), coalesce(p_target_all, false),
          p_expires_at, auth.uid())
  returning id into v_id;

  if not coalesce(p_target_all, false) then
    insert into public.announcement_targets (announcement_id, group_id)
    select v_id, g from unnest(p_group_ids) as g
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'announcement_id', v_id);
end $$;

-- get_my_announcements: active, non-expired, targets the caller, not dismissed.
create or replace function public.get_my_announcements()
returns table (id uuid, title text, body text, severity text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  return query
  select a.id, a.title, a.body, a.severity, a.created_at
  from public.announcements a
  where a.is_active
    and (a.expires_at is null or a.expires_at > now())
    and (
      a.target_all
      or exists (
        select 1
        from public.announcement_targets t
        join public.user_groups ug on ug.group_id = t.group_id
        where t.announcement_id = a.id and ug.user_id = uid
      )
    )
    and not exists (
      select 1 from public.announcement_dismissals d
      where d.announcement_id = a.id and d.user_id = uid
    )
  order by a.created_at desc;
end $$;

-- dismiss_announcement: record the caller's dismissal (idempotent).
create or replace function public.dismiss_announcement(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'errors', array['not_authenticated']);
  end if;
  insert into public.announcement_dismissals (announcement_id, user_id)
  values (p_id, auth.uid())
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- set_announcement_active: admin toggle.
create or replace function public.set_announcement_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;
  update public.announcements set is_active = coalesce(p_active, true) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- delete_announcement: admin delete (cascades targets + dismissals).
create or replace function public.delete_announcement(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;
  delete from public.announcements where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.create_announcement(text, text, text, boolean, uuid[], timestamptz) to authenticated;
grant execute on function public.get_my_announcements() to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.set_announcement_active(uuid, boolean) to authenticated;
grant execute on function public.delete_announcement(uuid) to authenticated;

-- Rollback:
-- drop function if exists public.create_announcement(text, text, text, boolean, uuid[], timestamptz);
-- drop function if exists public.get_my_announcements();
-- drop function if exists public.dismiss_announcement(uuid);
-- drop function if exists public.set_announcement_active(uuid, boolean);
-- drop function if exists public.delete_announcement(uuid);
