-- supabase/tests/jobs_parent_job_id.sql
begin;
select plan(2);

-- column exists
select has_column('public', 'jobs', 'parent_job_id', 'jobs.parent_job_id exists');

-- deleting a parent cascade-deletes its children
do $$
declare v_deal uuid; v_client uuid; v_parent uuid; v_child uuid;
begin
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_only, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', true, false, false, v_parent) returning id into v_child;
  perform set_config('t.child', v_child::text, true);
  delete from public.jobs where id = v_parent;
end $$;
select is(
  (select count(*)::int from public.jobs where id = current_setting('t.child')::uuid),
  0, 'deleting the parent cascade-deletes the child');

select * from finish();
rollback;
