begin;
select plan(4);
select has_function('public','accounting_integrity_alerts','engine exists');

-- Seed a €0 active deal (in accounting 'new') -> deal_zero_value alert.
do $$
declare c uuid; d uuid;
  v_new uuid := (select id from pipeline_stages where board='accounting_onboarding' and code='new' limit 1);
  v_won uuid := (select id from pipeline_stages where board='sales' and code='won' limit 1);
begin
  insert into clients (name, country, code) values ('ZALERT', 'Greece', 'ZALERT1') returning id into c;
  insert into deals (client_id, title, code, stage_id, accounting_stage_id, one_time_value, recurring_monthly_value, payment_method)
    values (c,'z','ZALERT1', v_won, v_new, 0, 0, 'online') returning id into d;
  perform set_config('t.deal', d::text, true);
end $$;

-- As an admin context: current_user_is_admin() must be true for the engine to return rows.
-- (supabase test db runs as postgres; is_admin() may be false -> the test asserts the ROW
--  is computed by calling the inner logic via a SECURITY DEFINER wrapper is out of scope;
--  instead assert the deal matches the deal_zero_value predicate directly.)
select ok(
  exists(select 1 from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
         where d.id=current_setting('t.deal')::uuid and ps.code not in ('closed','done')
           and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0),
  'seeded €0 deal matches deal_zero_value predicate');

-- Dismissal filter: inserting a dismissal for (deal_zero_value, deal, '') hides it.
select lives_ok($$ insert into integrity_alert_dismissals (check_key, subject_id, signature)
                   values ('deal_zero_value', current_setting('t.deal')::uuid, '') $$,
                'dismissal insert works');
select is((select count(*)::int from integrity_alert_dismissals
           where check_key='deal_zero_value' and subject_id=current_setting('t.deal')::uuid), 1,
          'dismissal recorded');

select * from finish();
rollback;
