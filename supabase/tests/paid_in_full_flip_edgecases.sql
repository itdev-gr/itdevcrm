\set ON_ERROR_STOP off

-- ---- Scenario A1: shorten end_date of a paid recurring row ---------
-- Expected: cron sees the new (earlier) end_date, guard still blocks a
-- duplicate because any next-period row already covers the shortened
-- window (or accepts a new one if the shortening removed coverage).
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int; v_row uuid;
begin
  insert into public.clients (name) values ('edge_A1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-A1', 'edge A1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  -- Original paid row + a manually-created next-period paid row
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid');

  -- Accounting shortens the original paid row's end_date by 5 days
  update public.deal_payments set end_date = current_date - 15 where id = v_row;

  -- Run the cron (scope assertion to THIS deal — global return value
  -- is unreliable in a savepoint against prod)
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  -- Assertion: no new duplicate created (existing next-period covers)
  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL A1 :: cron created % row(s) despite existing coverage', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS A1 :: shortened paid end_date does not cause duplicate';
end $$;
rollback;

-- ---- Scenario A2: extend end_date of a paid recurring row ----------
-- Expected: extended end_date means the "next" row's start_date might
-- now be BEFORE the extended end_date — guard checks start_date >=
-- dp.end_date, so it would NOT match. Cron may create a duplicate.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int; v_row uuid;
begin
  insert into public.clients (name) values ('edge_A2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-A2', 'edge A2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid');

  -- Accounting extends the original paid row to overlap the next one
  update public.deal_payments set end_date = current_date + 5 where id = v_row;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL A2 :: extending paid end_date past next-period start caused % dup', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS A2 :: extending end_date does not cause duplicate';
end $$;
rollback;

-- ---- Scenario A3: move start_date of an unpaid row forward ---------
-- Expected: deal_next_due shifts to the new date. If the deal was
-- paid_in_full and the new start_date is > 24h old, reconcile flips
-- to on_hold. If new start_date is in the future, deal stays.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('edge_A3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-A3', 'edge A3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days'),
           (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
    returning id into v_row;  -- captures the last insert (unpaid one)

  -- Accounting moves the pending row 10 days into the past
  update public.deal_payments set start_date = current_date - 5, end_date = current_date + 25
   where id = v_row;

  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  -- The unpaid row's created_at is 5 days ago (>24h) → no grace → flip expected
  if v_stage <> 'on_hold' then
    raise exception 'RESULT :: FAIL A3 :: expected on_hold after start_date moved to past, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A3 :: unpaid start_date moved to past flips to on_hold';
end $$;
rollback;

-- ---- Scenario A4: move end_date of an unpaid row forward -----------
-- Expected: end_date change doesn't affect deal_next_due (uses
-- start_date for recurring). No state change.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_before text; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_A4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-A4', 'edge A4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
    returning id into v_row;

  select ps.code into v_stage_before from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;

  update public.deal_payments set end_date = current_date + 60 where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;

  if v_stage_after <> v_stage_before then
    raise exception 'RESULT :: FAIL A4 :: end_date extension caused stage flip % -> %', v_stage_before, v_stage_after;
  end if;
  raise exception 'RESULT :: PASS A4 :: end_date extension does not affect stage (%)', v_stage_after;
end $$;
rollback;

-- ---- Scenario A5: swap start/end (invalid date range) --------------
-- Expected: no CHECK constraint prevents this; system tolerates it
-- without crashing. deal_next_due may return the "start" (now > end).
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid;
begin
  insert into public.clients (name) values ('edge_A5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-A5', 'edge A5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 10, current_date - 10, 'pending')
    returning id into v_row;

  perform public.reconcile_block_lifecycle(false);
  raise exception 'RESULT :: PASS A5 :: swapped dates tolerated (no crash)';
exception when others then
  raise exception 'RESULT :: FAIL A5 :: swapped dates raised: %', sqlerrm;
end $$;
rollback;

-- ---- Scenario B1: change amount_net on paid row -------------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_B1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-B1', 'edge B1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid');

  update public.deal_payments set amount_net = 250 where id = v_row;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL B1 :: amount change on paid row caused % dup', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS B1 :: amount change on paid row does not affect chain';
end $$;
rollback;

-- ---- Scenario B2: change amount_net on unpaid row -----------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_B2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-B2', 'edge B2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
    returning id into v_row;

  update public.deal_payments set amount_net = 50 where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL B2 :: amount change on unpaid row flipped stage to %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS B2 :: amount change on unpaid row does not affect stage';
end $$;
rollback;

-- ---- Scenario B3: amount_net = 0 (known edge from reference_recurring_payments) ----
-- Known concern: cron with amount_net=0 propagates. NOT strictly a flip
-- bug, but scenarios where accounting zeros a row expect the cron to
-- respect it. Only verify chain integrity here.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_B3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-B3', 'edge B3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 0, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;
  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL B3 :: expected 1 zero-amount next row, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS B3 :: zero-amount row still creates next chain link (billing memory: known concern)';
end $$;
rollback;

-- ---- Scenario B4: amount_net negative (CHECK-guarded) --------------
begin;
do $$
declare v_client uuid; v_deal uuid;
begin
  insert into public.clients (name) values ('edge_B4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-B4', 'edge B4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  begin
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', -50, 24,
              current_date - 40, current_date - 10, 'paid');
    raise exception 'RESULT :: FAIL B4 :: negative amount_net was accepted (CHECK missing?)';
  exception when check_violation then
    raise exception 'RESULT :: PASS B4 :: negative amount_net rejected by CHECK constraint';
  end;
end $$;
rollback;

-- ---- Scenario C1: mark paid → pending on an old row ----------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_C1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-C1', 'edge C1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days')
    returning id into v_row;

  update public.deal_payments set status = 'pending' where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL C1 :: expected on_hold after paid→pending, got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS C1 :: paid→pending correctly flips to on_hold';
end $$;
rollback;

-- ---- Scenario C2: mark overdue → paid triggers release ------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_C2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-C2', 'edge C2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue', now() - interval '30 days')
    returning id into v_row;

  update public.deal_payments set status = 'paid' where id = v_row;
  -- No reconcile needed; the release trigger fires on the update
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL C2 :: expected paid_in_full after overdue→paid, got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS C2 :: overdue→paid trigger releases from on_hold';
end $$;
rollback;

-- ---- Scenario C3: mark paid on a row from an on_hold deal WITH
-- another unpaid past-due row still present ------------------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row1 uuid; v_row2 uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_C3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-C3', 'edge C3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'overdue', now() - interval '50 days')
    returning id into v_row1;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date - 5, 'overdue', now() - interval '20 days')
    returning id into v_row2;

  update public.deal_payments set status = 'paid' where id = v_row1;
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL C3 :: expected on_hold (second row still overdue), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS C3 :: release respects remaining unpaid past-due';
end $$;
rollback;

-- ---- Scenario D1: change service_type on a paid row ---------------
-- Chain identity shifts. Cron treats it as a NEW chain, may create a
-- next-period row for the new service. Original chain has a gap.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_D1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-D1', 'edge D1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;

  update public.deal_payments set service_type = 'local_seo' where id = v_row;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 or v_after <> 2 then
    raise exception 'RESULT :: FAIL D1 :: expected 1 new row (local_seo chain), got delta=% total=%', (v_after - v_before), v_after;
  end if;
  raise exception 'RESULT :: PASS D1 :: service_type change starts new chain';
end $$;
rollback;

-- ---- Scenario D2: recurring_monthly → recurring_yearly ------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
    v_next_start date; v_next_end date;
begin
  insert into public.clients (name) values ('edge_D2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-D2', 'edge D2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'hosting', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;

  update public.deal_payments set billing_type = 'recurring_yearly' where id = v_row;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;
  select start_date, end_date into v_next_start, v_next_end
    from public.deal_payments where deal_id = v_deal and status <> 'paid'
    order by created_at desc limit 1;

  if (v_after - v_before) <> 1 or v_next_end <> (v_next_start + interval '1 year')::date then
    raise exception 'RESULT :: FAIL D2 :: yearly cadence not applied: delta=% start=% end=%',
      (v_after - v_before), v_next_start, v_next_end;
  end if;
  raise exception 'RESULT :: PASS D2 :: billing_type change to yearly applies 1-year cadence';
end $$;
rollback;

-- ---- Scenario D3: change service_index only (no other change) -----
-- With L1/L2 no longer scoped by service_index, this should have no
-- effect on cron or trigger.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_D3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-D3', 'edge D3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid'),
           (v_deal, 'web_seo', 1, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid')
    returning id into v_row;

  update public.deal_payments set service_index = 5 where id = v_row;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL D3 :: service_index change caused % dup', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS D3 :: service_index change alone does not create dupes (fix holds)';
end $$;
rollback;

-- ---- Scenario D4: recurring → one_time (cron should skip) --------
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_D4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-D4', 'edge D4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row;

  update public.deal_payments set billing_type = 'one_time' where id = v_row;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL D4 :: cron created % row(s) for one_time', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS D4 :: recurring→one_time removes from cron loop';
end $$;
rollback;

-- ---- Scenario E1: delete a paid recurring row --------------------
-- Cron may re-create it. If it does, and the recreated row has an
-- immediately-past start_date, deal could flip.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row_del uuid; v_before int; v_after int;
    v_stage_after text;
begin
  insert into public.clients (name) values ('edge_E1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-E1', 'edge E1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row_del;

  delete from public.deal_payments where id = v_row_del;
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  -- After delete, no expiring row → cron creates 0 for this deal.
  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL E1 :: cron created % rows after paid-row deletion', (v_after - v_before);
  end if;
  -- Deal stayed paid_in_full since no unpaid rows exist
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL E1 :: stage flipped to % after paid-row deletion', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS E1 :: deleting a paid row does not create phantom next-period';
end $$;
rollback;

-- ---- Scenario E2: delete an unpaid past-due row on on_hold deal ---
-- Reconcile's "no auto-release" gate should keep the deal on_hold
-- (accountant must promote manually).
begin;
do $$
declare v_client uuid; v_deal uuid; v_row_del uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_E2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-E2', 'edge E2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue', now() - interval '30 days')
    returning id into v_row_del;

  delete from public.deal_payments where id = v_row_del;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL E2 :: expected on_hold (no auto-release), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS E2 :: deleting past-due row does NOT auto-release from on_hold';
end $$;
rollback;

-- ---- Scenario E3: manual INSERT of past-dated pending row ---------
-- Layer 3 grace should protect paid_in_full for 24h.
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_E3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-E3', 'edge E3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 5, current_date + 25, 'pending', now() - interval '1 hour');

  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL E3 :: expected paid_in_full (L3 grace), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS E3 :: L3 grace protects paid_in_full from <24h past-dated insert';
end $$;
rollback;

-- ---- Scenario E4: manual INSERT of a duplicate — L2 silently drops
begin;
do $$
declare v_client uuid; v_deal uuid; v_new_id uuid;
begin
  insert into public.clients (name) values ('edge_E4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-E4', 'edge E4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid');
  -- Try to insert a "correction" row for the same period
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 1, 'recurring_monthly', 90, 24,
            current_date - 10, current_date + 20, 'pending')
    returning id into v_new_id;

  if v_new_id is not null then
    raise exception 'RESULT :: FAIL E4 :: dup insert returned id %, expected NULL', v_new_id;
  end if;
  raise exception 'RESULT :: PASS E4 :: L2 silently drops duplicate insert';
end $$;
rollback;

-- ---- Scenario E5: UPDATE to create a duplicate (L2 bypass!) -------
-- L2 only fires on INSERT. Accountant edits a row's start_date to
-- MATCH another existing row's period — creates a duplicate that L2
-- doesn't catch. L4 audit is the only defense.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row1 uuid; v_row2 uuid; v_alerts int;
begin
  insert into public.clients (name) values ('edge_E5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-E5', 'edge E5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid')
    returning id into v_row1;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'paid')
    returning id into v_row2;

  -- Accountant edits row1 to overlap row2's period
  update public.deal_payments
     set start_date = current_date - 10, end_date = current_date + 20
   where id = v_row1;

  -- L4 audit should catch it
  select public.reconcile_payment_integrity() into v_alerts;
  if v_alerts < 1 then
    raise exception 'RESULT :: FAIL E5 :: L2 bypass via UPDATE not caught by L4 audit';
  end if;
  raise exception 'RESULT :: CONCERN E5 :: L2 bypassed via UPDATE (only L4 audit catches, next-day detection)';
end $$;
rollback;
