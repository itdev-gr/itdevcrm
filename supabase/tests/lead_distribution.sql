begin;
select plan(3);

-- auto-distribute defaults OFF: a new unassigned lead stays unassigned.
do $$
declare sid uuid; lid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  insert into public.leads (source, title, stage_id) values ('manual', 'pgTAP no-auto', sid) returning id into lid;
  perform set_config('pgtap.lead_id', lid::text, true);
end $$;
select is(
  (select owner_user_id from public.leads where id = current_setting('pgtap.lead_id')::uuid),
  null, 'auto-distribute is OFF by default → lead stays unassigned');

-- the trigger never overwrites a lead inserted WITH an owner (even if enabled).
update public.lead_distribution_state set auto_enabled = true where id = true;
do $$
declare sid uuid; adm uuid; lid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  select user_id into adm from public.profiles limit 1;  -- any existing user
  insert into public.leads (source, title, stage_id, owner_user_id)
    values ('import', 'pgTAP preassigned', sid, adm) returning id into lid;
  perform set_config('pgtap.lead_id2', lid::text, true);
  perform set_config('pgtap.adm', adm::text, true);
end $$;
select is(
  (select owner_user_id from public.leads where id = current_setting('pgtap.lead_id2')::uuid),
  current_setting('pgtap.adm')::uuid, 'pre-assigned lead keeps its owner when auto is ON');

-- distribute_unassigned_leads with an empty sales pool returns 0 and assigns nothing.
-- (No sales-group members exist in the test transaction.)
select is( public.distribute_unassigned_leads(), 0,
  'distribute returns 0 when the sales pool is empty');

select * from finish();
rollback;
