-- supabase/tests/ai_seo_child_job_codes.sql
begin;
select plan(2);
do $$
declare v_deal uuid; v_client uuid; v_code text; v_parent uuid; v_web uuid; v_local uuid;
begin
  select id, client_id, code into v_deal, v_client, v_code from public.deals where code is not null limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', true, false, v_parent) returning id into v_web;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_active, parent_job_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active', true, false, v_parent) returning id into v_local;
  perform set_config('t.web', v_web::text, true);
  perform set_config('t.local', v_local::text, true);
  perform set_config('t.deal_code', v_code, true);
end $$;
select is((select code from public.jobs where id = current_setting('t.web')::uuid),
  current_setting('t.deal_code') || '-AISEOWEB', 'web child code = <deal>-AISEOWEB');
select is((select code from public.jobs where id = current_setting('t.local')::uuid),
  current_setting('t.deal_code') || '-AISEOLOC', 'local child code = <deal>-AISEOLOC');
select * from finish();
rollback;
