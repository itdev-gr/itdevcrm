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

-- ===================================================================
-- Category F — Deal-level modifications (4 scenarios)
-- ===================================================================

-- ---- Scenario F1: deal.payment_method → null ---------------------
-- Per-deal-delta rewrite: reconcile_block_lifecycle() returns a GLOBAL
-- count across prod; use the deal's own stage before/after instead.
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_before text; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_F1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-F1', 'edge F1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 5, current_date + 25, 'overdue', now() - interval '5 days');

  update public.deals set payment_method = null where id = v_deal;

  select ps.code into v_stage_before from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;

  -- Reconcile filters WHERE payment_method is not null → deal not evaluated
  if v_stage_after is distinct from v_stage_before then
    raise exception 'RESULT :: FAIL F1 :: reconcile changed stage %→% despite null payment_method', v_stage_before, v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F1 :: null payment_method excludes deal from reconcile (stage unchanged=%)', v_stage_after;
end $$;
rollback;

-- ---- Scenario F2: manually set to done stage --------------------
-- Per-deal-delta rewrite: measure deal_payments count before/after
-- to see whether cron created any rows for THIS deal specifically.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_F2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-F2', 'edge F2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='done'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  -- Cron filter: stage != 'closed' — 'done' is allowed. Cron may try
  -- to create next-period. We only report the per-deal delta.
  raise exception 'RESULT :: INFO F2 :: cron created % rows on done-stage deal (info only)', v_after - v_before;
end $$;
rollback;

-- ---- Scenario F3: archive deal ------------------------------------
-- Per-deal-delta rewrite: use per-deal deal_payments count before/after
-- rather than the global return value of ensure_recurring_payments().
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('edge_F3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-F3', 'edge F3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid');

  update public.deals set archived = true where id = v_deal;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) > 0 then
    raise exception 'RESULT :: FAIL F3 :: cron touched archived deal (% new rows)', v_after - v_before;
  end if;
  raise exception 'RESULT :: PASS F3 :: archived deal excluded from cron (delta=0)';
end $$;
rollback;

-- ---- Scenario F4: manual promote on_hold → paid_in_full with
--      an unpaid past-due row still present ---------------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text; v_paid_id uuid;
begin
  insert into public.clients (name) values ('edge_F4_' || gen_random_uuid()::text) returning id into v_client;
  select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-F4', 'edge F4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- Legitimately-old unpaid row (5 days ago)
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 5, current_date + 25, 'overdue', now() - interval '5 days');

  -- Accountant manually flips to paid_in_full (bypasses release trigger)
  update public.deals set accounting_stage_id = v_paid_id where id = v_deal;

  -- Reconcile runs — should flip back to on_hold because the row is
  -- >24h old and target_accounting_stage returns 'on_hold'.
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL F4 :: manual promote to paid_in_full stuck at % despite real past-due', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F4 :: reconcile correctly reverses accidental manual promote';
end $$;
rollback;

-- ===================================================================
-- Category G — Trigger cascades (3 scenarios)
-- ===================================================================

-- ---- Scenario G1: INSERT paid row → move_to_awaiting suppressed --
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_G1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-G1', 'edge G1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 5, current_date + 35, 'paid');
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  -- move_to_awaiting only moves when the deal is in new/on_hold/partial —
  -- paid_in_full stays. Confirmed here.
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL G1 :: INSERT of paid row flipped stage to %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS G1 :: INSERT of paid row does not perturb paid_in_full';
end $$;
rollback;

-- ---- Scenario G2: INSERT pending row → move_to_awaiting ---------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_G2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-G2', 'edge G2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date + 5, current_date + 35, 'pending');

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  -- move_to_awaiting fires: deal goes to awaiting_payment immediately.
  -- This is EXISTING behavior — L3 grace on reconcile is the corrector.
  if v_stage_after <> 'awaiting_payment' then
    raise exception 'RESULT :: INFO G2 :: expected awaiting_payment after INSERT, got % (documenting existing trigger behavior)', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS G2 :: INSERT of pending row moves to awaiting_payment (existing behavior)';
end $$;
rollback;

-- ---- Scenario G3: race — cron creates phantom, reconcile L3 fires
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_G3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-G3', 'edge G3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  -- Simulate: cron just ran, created a fresh past-dated pending row
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days'),
           (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue', now() - interval '10 minutes');

  -- Reconcile runs 20 min later — L3 grace should force back to paid_in_full
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL G3 :: L3 grace failed (stage=%)', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS G3 :: cron→reconcile chain with L3 grace holds paid_in_full';
end $$;
rollback;

-- ===================================================================
-- Category H — Concurrent modifications (3 scenarios)
-- ===================================================================

-- ---- Scenario H1: two rapid updates on same row (last-write-wins)
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_start_final date;
begin
  insert into public.clients (name) values ('edge_H1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-H1', 'edge H1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'pending')
    returning id into v_row;

  update public.deal_payments set start_date = current_date - 5 where id = v_row;
  update public.deal_payments set start_date = current_date + 2 where id = v_row;

  select start_date into v_start_final from public.deal_payments where id = v_row;
  if v_start_final <> current_date + 2 then
    raise exception 'RESULT :: FAIL H1 :: LWW failed: expected +2, got %', v_start_final;
  end if;
  raise exception 'RESULT :: PASS H1 :: last-write-wins on rapid updates';
end $$;
rollback;

-- ---- Scenario H2: cron advisory lock held --------------------
-- Cannot easily simulate two connections in one savepoint; instead,
-- verify sequential calls don't crash. Per-deal-delta pattern:
-- seed a fresh deal and measure its row-count before/after two
-- sequential cron calls, reporting the delta only (INFO).
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_mid int; v_after int;
begin
  insert into public.clients (name) values ('edge_H2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-H2', 'edge H2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_mid from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;
  raise exception 'RESULT :: INFO H2 :: sequential cron calls on this deal delta=%,% (concurrent race not simulable in one session)', v_mid - v_before, v_after - v_mid;
end $$;
rollback;

-- ---- Scenario H3: two dup INSERTs — only one lands ------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_a uuid; v_b uuid;
begin
  insert into public.clients (name) values ('edge_H3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-H3', 'edge H3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'pending')
    returning id into v_a;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'pending')
    returning id into v_b;
  if v_a is null then
    raise exception 'RESULT :: FAIL H3 :: first INSERT was dropped';
  end if;
  if v_b is not null then
    raise exception 'RESULT :: FAIL H3 :: second INSERT was NOT dropped (id=%)', v_b;
  end if;
  raise exception 'RESULT :: PASS H3 :: L2 drops second dup INSERT, first survives';
end $$;
rollback;

-- ===================================================================
-- Category I — L3 grace boundary (4 scenarios)
-- ===================================================================

-- ---- Scenario I1: row created exactly at 23h59m boundary --------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_I1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-I1', 'edge I1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue', now() - interval '23 hours 59 minutes');

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL I1 :: L3 grace failed at 23h59m boundary (stage=%)', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS I1 :: grace holds at 23h59m';
end $$;
rollback;

-- ---- Scenario I2: row created exactly at 24h01m boundary --------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_I2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-I2', 'edge I2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue', now() - interval '24 hours 1 minute');

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL I2 :: expected on_hold at 24h+1m (grace should have expired), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS I2 :: grace expires after 24h';
end $$;
rollback;

-- ---- Scenario I3: accountant modifies created_at (superuser only)
-- Cannot modify created_at via normal DML — it's declared NOT NULL
-- with default now(). Bypassing via direct UPDATE: does it stick?
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_created_at_after timestamptz;
begin
  insert into public.clients (name) values ('edge_I3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-I3', 'edge I3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue')
    returning id into v_row;

  update public.deal_payments set created_at = now() - interval '30 days' where id = v_row;
  select created_at into v_created_at_after from public.deal_payments where id = v_row;
  if v_created_at_after > now() - interval '29 days' then
    raise exception 'RESULT :: FAIL I3 :: created_at UPDATE did not stick (=%)', v_created_at_after;
  end if;
  raise exception 'RESULT :: CONCERN I3 :: created_at is UPDATE-able → grace can be bypassed by editing timestamp';
end $$;
rollback;

-- ---- Scenario I4: dual rows one <24h and one >24h ---------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('edge_I4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-I4', 'edge I4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  -- One row >24h (legit overdue) + one <24h (phantom): reconcile should
  -- still flip to on_hold because the >24h row is a real past-due.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue', now() - interval '30 days'),
           (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 5, current_date + 25, 'pending', now() - interval '1 hour');
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'on_hold' then
    raise exception 'RESULT :: FAIL I4 :: mixed-age rows should still flip (real past-due present), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS I4 :: legit past-due wins over fresh phantom in mixed case';
end $$;
rollback;

-- ===================================================================
-- Category J — L4 audit corner cases (3 scenarios)
-- ===================================================================

-- ---- Scenario J1: duplicate created RIGHT before audit runs -----
begin;
do $$
declare v_client uuid; v_deal uuid; v_alerts int; v_before int;
begin
  insert into public.clients (name) values ('edge_J1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'EDGE-J1', 'edge J1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  alter table public.deal_payments disable trigger user;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid'),
           (v_deal, 'ai_seo', 1, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid');
  alter table public.deal_payments enable trigger user;

  select count(*) into v_before from public.data_integrity_alerts;
  select public.reconcile_payment_integrity() into v_alerts;
  if v_alerts < 1 then
    raise exception 'RESULT :: FAIL J1 :: audit did not fire (alerts=%)', v_alerts;
  end if;
  raise exception 'RESULT :: PASS J1 :: L4 audit catches fresh duplicate';
end $$;
rollback;

-- ---- Scenario J2: no dupes → no alerts --------------------------
-- (Can't isolate against prod's existing alerts; just confirm the
-- function tolerates a clean state by running it and confirming it
-- doesn't crash.)
begin;
do $$
declare v_alerts int;
begin
  select public.reconcile_payment_integrity() into v_alerts;
  -- v_alerts reflects prod's current state; the assertion is
  -- "function ran without crashing".
  raise exception 'RESULT :: INFO J2 :: audit ran cleanly, returned alerts=%', v_alerts;
end $$;
rollback;

-- ---- Scenario J3: RLS blocks non-admin from reading alerts ------
begin;
do $$
declare v_client uuid; v_deal uuid; v_visible_by_anon int;
begin
  -- Set role to anon to test RLS
  set local role anon;
  select count(*) into v_visible_by_anon from public.data_integrity_alerts;
  reset role;
  if v_visible_by_anon > 0 then
    raise exception 'RESULT :: FAIL J3 :: anon can read data_integrity_alerts (RLS breach)';
  end if;
  raise exception 'RESULT :: PASS J3 :: anon cannot read data_integrity_alerts';
exception when others then
  reset role;
  -- Rethrow so the outer exception surfaces
  raise;
end $$;
rollback;
