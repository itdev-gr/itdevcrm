-- Grant the dedicated test account full CRM visibility and admin-backed RLS access.
-- The frontend uses this same account for the account switcher/view-as control.

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (
    user_id,
    email,
    full_name,
    is_admin,
    must_change_password
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    lower(new.email) = 'test@itdev.gr',
    case
      when lower(new.email) = 'test@itdev.gr' then false
      else coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true)
    end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.current_user_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select is_admin or lower(email) = 'test@itdev.gr'
      from public.profiles
      where user_id = auth.uid()
    ),
    false
  );
$$;

update public.profiles
set
  is_admin = true,
  must_change_password = false
where lower(email) = 'test@itdev.gr';
