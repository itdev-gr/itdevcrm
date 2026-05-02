-- =============================================================================
-- Let users edit their own profile fields (name, phone, extension, locale,
-- avatar, email). Admins still have full update access via existing policy.
-- =============================================================================
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists phone_extension text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists timezone text;

-- Re-grant column-level UPDATE so the new columns are self-editable.
grant update (full_name, avatar_url, preferred_locale, email, phone, phone_extension, job_title, timezone)
  on public.profiles to authenticated;
