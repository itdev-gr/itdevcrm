-- supabase/tests/jobs_owner_only_boards_rls.sql
-- Run with: supabase test db   (transactional; rolls back)
--
-- RLS regression for the owner-only boards (2026-09-08, migration
-- 20260908160000): on social_media / ads a non-admin board member SELECTs
-- ONLY the jobs assigned to them; colleagues' and unassigned jobs are
-- invisible (and therefore un-updatable — the UPDATE row fetch goes through
-- the SELECT policy). Admins see everything. global_search mirrors the rule.
begin;
select plan(9);

select has_function('public', 'owner_only_boards', 'owner_only_boards() exists');
select is(
  (select 'social_media' = any(public.owner_only_boards())
      and 'ads' = any(public.owner_only_boards())),
  true, 'owner_only_boards covers social_media and ads');

-- Fixture as superuser: two non-admin members of the social_media group (with
-- board view permission), three social jobs — one per member plus one
-- unassigned — hanging off any existing client/deal.
do $$
declare
  v_group uuid; v_a uuid; v_b uuid; v_admin uuid;
  v_client uuid; v_deal uuid;
begin
  select id into v_group from public.groups where code = 'social_media';

  -- Non-admin members WITHOUT the accounting view perms (those escape the
  -- owner-only conjunct by design and would see all fixture rows).
  select user_id into v_a from public.profiles p
   where coalesce(p.is_admin, false) = false and p.is_active
     and not exists (select 1 from public.user_effective_permissions uep
                      where uep.user_id = p.user_id and uep.allowed
                        and uep.action = 'view'
                        and uep.board in ('accounting_recurring', 'accounting_onboarding'))
   limit 1;
  select user_id into v_b from public.profiles p
   where coalesce(p.is_admin, false) = false and p.is_active and p.user_id <> v_a
     and not exists (select 1 from public.user_effective_permissions uep
                      where uep.user_id = p.user_id and uep.allowed
                        and uep.action = 'view'
                        and uep.board in ('accounting_recurring', 'accounting_onboarding'))
   limit 1;
  select user_id into v_admin from public.profiles
   where coalesce(is_admin, false) = true limit 1;

  insert into public.user_groups (user_id, group_id)
    values (v_a, v_group), (v_b, v_group)
    on conflict do nothing;
  insert into public.group_permissions (group_id, board, action, scope, allowed)
    values (v_group, 'social_media', 'view', 'group', true)
    on conflict (group_id, board, action) do update set allowed = true;

  select id into v_client from public.clients where not archived limit 1;
  select id into v_deal from public.deals where client_id = v_client limit 1;
  if v_deal is null then
    select d.id, d.client_id into v_deal, v_client from public.deals d limit 1;
  end if;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, title,
                           code, owner_user_id, billing_active, status)
    values (v_deal, v_client, 'social_media', 'one_time', 'pgTAP social A', 'zzpgtapa', v_a, false, 'active'),
           (v_deal, v_client, 'social_media', 'one_time', 'pgTAP social B', 'zzpgtapb', v_b, false, 'active'),
           (v_deal, v_client, 'social_media', 'one_time', 'pgTAP social none', 'zzpgtapn', null, false, 'active');

  perform set_config('t.a', v_a::text, true);
  perform set_config('t.b', v_b::text, true);
  perform set_config('t.admin', v_admin::text, true);
end $$;

-- ---- Member A: own job only; colleague + unassigned invisible. ----
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.a'), 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.jobs where code like 'zzpgtap%'),
  1, 'member A sees exactly their own social job');
select is((select count(*)::int from public.jobs where code = 'zzpgtapb'),
  0, 'colleague''s job is invisible to member A');
select is((select count(*)::int from public.jobs where code = 'zzpgtapn'),
  0, 'unassigned social job is invisible to a non-admin member');
-- UPDATE on a colleague's job matches zero rows (SELECT policy row fetch).
select is((with u as (
             update public.jobs set title = 'hijack'
              where code = 'zzpgtapb' returning 1)
           select count(*)::int from u),
  0, 'member A cannot UPDATE a colleague''s job (0 rows matched)');
select is((select count(*)::int from public.global_search('zzpgtapb', 20)
            where entity_type = 'job'),
  0, 'global_search hides the colleague''s job from member A');

-- ---- Admin: everything. ----
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.jobs where code like 'zzpgtap%'),
  3, 'admin sees all three social jobs, unassigned included');
select is((select count(*)::int from public.global_search('zzpgtapb', 20)
            where entity_type = 'job'),
  1, 'global_search returns the job for an admin');

select * from finish();
rollback;
