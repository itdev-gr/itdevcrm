-- supabase/tests/end_job_cascade_children.sql
begin;
select plan(2);
do $$
declare v_admin uuid; v_deal uuid; v_client uuid; v_parent uuid; v_child uuid;
begin
  select user_id into v_admin from public.profiles where is_admin limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', true, true, v_parent) returning id into v_child;
  perform public.end_job(v_parent);
  perform set_config('t.child', v_child::text, true);
end $$;
select is((select status from public.jobs where id = current_setting('t.child')::uuid),
  'completed', 'ending the parent completes the child');
select is((select billing_active from public.jobs where id = current_setting('t.child')::uuid),
  false, 'ending the parent deactivates the child');
select * from finish();
rollback;
