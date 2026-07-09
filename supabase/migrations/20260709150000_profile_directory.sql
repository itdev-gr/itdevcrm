-- 2026-07-09: profile_directory() -- staff name+email readable by all staff.
-- Problem: profiles RLS (profiles_select_self_or_admin) lets a non-admin read
-- only their OWN row, so the embedded author join in the comment queries returns
-- null for every other user and the UI shows a raw author_id UUID (or a dash).
-- Fix: a security-definer directory that exposes ONLY identity columns
-- (user_id, full_name, email) for ALL profiles -- mirrors mentionable_users but
-- includes archived users (so historical comment authors still resolve) and
-- excludes sensitive columns (phone, job_title, must_change_password, etc.).

create or replace function public.profile_directory()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.full_name, p.email
  from public.profiles p;
$$;

grant execute on function public.profile_directory() to authenticated;

-- ROLLBACK: drop function if exists public.profile_directory();
