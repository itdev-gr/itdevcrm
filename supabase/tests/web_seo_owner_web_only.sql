-- supabase/tests/web_seo_owner_web_only.sql
begin;
select plan(2);
do $$
declare v_deal uuid; v_client uuid; v_ai uuid; v_web uuid;
begin
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true, true) returning id into v_ai;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, is_custom, billing_active)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', true, false) returning id into v_web;
  perform set_config('t.ai', v_ai::text, true);
  perform set_config('t.web', v_web::text, true);
end $$;
select is((select owner_user_id from public.jobs where id = current_setting('t.ai')::uuid),
  null, 'ai_seo job is left unowned by the trigger');
select is((select owner_user_id from public.jobs where id = current_setting('t.web')::uuid),
  '19aa9170-bd62-4319-8118-668c11e93c98'::uuid, 'web_seo job still forced to pefstathiadis');
select * from finish();
rollback;
