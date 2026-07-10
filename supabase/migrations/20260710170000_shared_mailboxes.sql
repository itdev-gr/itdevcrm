-- 2026-07-10: shared company mailboxes (accounting@/support@) as first-class
-- capture sources. Spec: docs/superpowers/specs/2026-07-10-shared-mailboxes-design.md

-- 1. Service identities: auth users that never log in (random bcrypt password,
-- no auth.identities row). handle_new_auth_user backfills profiles.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', m.email,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', m.label, 'must_change_password', false),
       '', '', '', '', now(), now()
from (values ('accounting@itdev.gr', 'Accounting Mailbox'),
             ('support@itdev.gr', 'Support Mailbox')) as m(email, label)
where not exists (select 1 from auth.users u where lower(u.email) = m.email);

-- Invisible to rosters/pickers (they filter is_active), never assignable.
update public.profiles set is_active = false
 where lower(email) in ('accounting@itdev.gr', 'support@itdev.gr');

-- 2. Registry: which addresses are company mailboxes + their fixed department.
create table if not exists public.shared_mailboxes (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text not null unique,
  department text not null check (department in ('accounting', 'support')),
  created_at timestamptz not null default now()
);
alter table public.shared_mailboxes enable row level security;
create policy shared_mailboxes_admin_select on public.shared_mailboxes
  for select using (public.current_user_is_admin());
-- writes: service_role / migrations only.

insert into public.shared_mailboxes (user_id, email, department)
select p.user_id, lower(p.email),
       case lower(p.email) when 'accounting@itdev.gr' then 'accounting' else 'support' end
  from public.profiles p
 where lower(p.email) in ('accounting@itdev.gr', 'support@itdev.gr')
on conflict (user_id) do nothing;

-- 3. 'support' group (Technical bucket) + own-board view permission.
insert into public.groups (code, display_names, parent_label, position)
select 'support', '{"en": "Support", "el": "Υποστήριξη"}'::jsonb, 'Technical',
       coalesce((select max(position) + 1 from public.groups), 99)
where not exists (select 1 from public.groups where code = 'support');

insert into public.group_permissions (group_id, board, action, scope, allowed)
select id, 'support', 'view', 'group', true
  from public.groups where code = 'support'
on conflict (group_id, board, action) do nothing;
-- No members seeded: admins see everything; owner adds members in Settings.

-- 4. Paginated backfill cursor for shared boxes (Task 4 uses it).
alter table public.user_google_sync add column if not exists backfill_page_token text;

-- 5. Status for the admin Settings page (user_google_accounts has no client
-- policies, so an admin-gated security-definer RPC reads it).
create or replace function public.shared_mailbox_status()
returns table (user_id uuid, email text, department text, google_email text, connected boolean,
               last_synced_at timestamptz, backfilled boolean)
language sql stable security definer set search_path = public as $$
  select sm.user_id, sm.email, sm.department, uga.google_email,
         (uga.user_id is not null and uga.revoked_at is null
          and coalesce(uga.scopes, '') like '%gmail.readonly%') as connected,
         s.last_synced_at,
         (s.backfilled_at is not null and s.backfill_page_token is null) as backfilled
    from public.shared_mailboxes sm
    left join public.user_google_accounts uga on uga.user_id = sm.user_id
    left join public.user_google_sync s on s.user_id = sm.user_id
   where public.current_user_is_admin()
   order by sm.email;
$$;
revoke execute on function public.shared_mailbox_status() from public, anon;
grant execute on function public.shared_mailbox_status() to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK:
--   drop function if exists public.shared_mailbox_status();
--   alter table public.user_google_sync drop column if exists backfill_page_token;
--   delete from public.group_permissions where board = 'support';
--   delete from public.groups where code = 'support';
--   drop table if exists public.shared_mailboxes;
--   delete from auth.users where lower(email) in ('accounting@itdev.gr','support@itdev.gr');
--     (cascades profiles + user_google_accounts + user_google_sync)
