-- Single-owner accounting stage — authoritative harness (2026-07-02).
-- Covers reconcile_deal_stage + the instant deal_payments trigger under Decision B.
-- Run via the RAISE-harness (savepoint-rollback) against the DB. Supersedes the grace/
-- mover scenarios in paid_in_full_flip_*.sql (24h grace + move_to_awaiting +
-- release_from_on_hold were retired; see docs/superpowers/specs/2026-07-02-accounting-stage-single-owner-design.md).

-- ===== reconcile_deal_stage in isolation =====
-- Task 1 harness: reconcile_deal_stage in isolation. Each block forces the deal's
-- start stage AFTER seeding (neutralising the still-present move_to_awaiting), then
-- calls reconcile_deal_stage directly and asserts. Terminal RAISE rolls everything back.

-- A: future charge (+30) from paid_in_full -> stays paid_in_full (no flip; the bug fixed)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1a','h1a@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1A','h1a','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 30, current_date + 60, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='paid_in_full' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % A :: future+30 from paid_in_full -> got %', v_status, v_after;
end $$;

-- B: charge due +3 from paid_in_full -> awaiting_payment (Fully Paid -> Awaiting when due soon)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1b','h1b@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1B','h1b','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, current_date + 33, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='awaiting_payment' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % B :: due+3 from paid_in_full -> got %', v_status, v_after;
end $$;

-- C: overdue charge (-2) from awaiting_payment -> on_hold
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1c','h1c@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1C','h1c','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 2, current_date + 28, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='on_hold' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % C :: overdue-2 from awaiting -> got %', v_status, v_after;
end $$;

-- D: charge due TODAY from awaiting_payment -> stays awaiting_payment (strict <, no grace)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1d','h1d@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1D','h1d','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date, current_date + 30, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='awaiting_payment' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % D :: due-today from awaiting -> got %', v_status, v_after;
end $$;

-- E: on_hold with nothing unpaid -> STAYS on_hold (B: never auto-lift a hold; accountant lifts)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1e','h1e@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1E','h1e','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 5, current_date + 25, 'paid');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='on_hold' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % E :: on_hold all-paid STAYS on_hold (B) -> got %', v_status, v_after;
end $$;

-- F: overdue charge but deal in documents_verified -> untouched (rule only manages 3 columns)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h1f','h1f@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H1F','h1f','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='documents_verified'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 2, current_date + 28, 'pending');
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='documents_verified') where id=v_deal;
  perform public.reconcile_deal_stage(v_deal);
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='documents_verified' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % F :: documents_verified untouched -> got %', v_status, v_after;
end $$;

-- ===== trigger-driven (instant) + job block/unblock =====
-- Task 3 harness: trigger-driven (no forcing). Under Decision B, an On-Hold deal is
-- never auto-lifted; the accountant's manual move to Paid In Full unblocks the jobs.

-- I: paid_in_full + future(+30) charge -> stays paid_in_full (trigger runs rule; no flip)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h3i','h3i@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3I','h3i','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 30, current_date + 60, 'pending');
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='paid_in_full' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % I :: trigger no-flip future+30 -> got %', v_status, v_after;
end $$;

-- J: paid_in_full + due(+3) charge -> awaiting_payment (Fully Paid -> Awaiting)
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h3j','h3j@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3J','h3j','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, current_date + 33, 'pending');
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='awaiting_payment' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % J :: trigger paid->awaiting due+3 -> got %', v_status, v_after;
end $$;

-- K: awaiting_payment + overdue(-2) charge -> on_hold
do $$
declare v_client uuid; v_deal uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h3k','h3k@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3K','h3k','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 2, current_date + 28, 'pending');
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='on_hold' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % K :: trigger awaiting->on_hold overdue-2 -> got %', v_status, v_after;
end $$;

-- L: on_hold + pay the charge -> STAYS on_hold (B: rule never auto-lifts a hold)
do $$
declare v_client uuid; v_deal uuid; v_pay uuid; v_after text; v_status text;
begin
  insert into public.clients(name,email,country) values('h3l','h3l@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3L','h3l','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 2, current_date + 28, 'pending') returning id into v_pay;
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold') where id=v_deal;
  update public.deal_payments set status='paid' where id=v_pay;
  select ps.code into v_after from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  v_status := case when v_after='on_hold' then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % L :: pay on_hold charge STAYS on_hold (B) -> got %', v_status, v_after;
end $$;

-- M: on_hold blocks the job; accountant moving deal to Paid In Full unblocks it
do $$
declare v_client uuid; v_deal uuid; v_job uuid; v_pay uuid;
        v_stage1 text; v_blocked1 boolean; v_reason1 text; v_stage2 text; v_blocked2 boolean; v_status text;
begin
  insert into public.clients(name,email,country) values('h3m','h3m@t.gr','Greece') returning id into v_client;
  insert into public.deals(client_id,code,title,payment_method,stage_id,accounting_stage_id)
    values(v_client,'H3M','h3m','cash',
      (select id from public.pipeline_stages where board='sales' and code='won'),
      (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.jobs(deal_id, client_id, service_type, billing_type, stage_id)
    values(v_deal, v_client, 'local_seo', 'recurring_monthly',
      (select id from public.pipeline_stages where board='local_seo' and code='new_project'))
    returning id into v_job;
  -- overdue charge -> trigger -> on_hold + job blocked
  insert into public.deal_payments(deal_id,service_type,service_index,billing_type,amount_net,vat_rate,start_date,end_date,status)
    values(v_deal,'local_seo',0,'recurring_monthly',100,24, current_date - 2, current_date + 28, 'pending')
    returning id into v_pay;
  select ps.code, j.is_blocked, j.blocked_reason into v_stage1, v_blocked1, v_reason1
    from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id, public.jobs j
   where d.id=v_deal and j.id=v_job;
  -- client pays (B: stays on_hold), then the ACCOUNTANT moves the deal to Paid In Full -> job unblocks
  update public.deal_payments set status='paid' where id=v_pay;
  update public.deals set accounting_stage_id=(select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full') where id=v_deal;
  select ps.code, j.is_blocked into v_stage2, v_blocked2
    from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id, public.jobs j
   where d.id=v_deal and j.id=v_job;
  v_status := case
    when v_stage1='on_hold' and v_blocked1 and v_reason1='account_on_hold'
     and v_stage2='paid_in_full' and not v_blocked2 then 'PASS' else 'FAIL' end;
  raise exception 'RESULT :: % M :: on_hold blocks job / accountant paid unblocks :: s1=% b1=% r1=% s2=% b2=%',
    v_status, v_stage1, v_blocked1, v_reason1, v_stage2, v_blocked2;
end $$;
