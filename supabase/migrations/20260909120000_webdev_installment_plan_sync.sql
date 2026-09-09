-- =============================================================================
-- 20260909120000_webdev_installment_plan_sync.sql
-- Owner report 2026-09-09 (παράδειγμα deal 006042): πολλά websites έχουν
-- δόσεις στα payments αλλά το job δηλώνει «Πλήρης (1 πληρωμή)».
--
-- Αιτία: στο Won, ο deal-insert seeder κόβει τις δόσεις από το
-- services_planned[].payment_terms (η φόρμα πωλήσεων βάζει default 50_50 στο
-- web_dev — ServicesPlannedField.tsx), αλλά το release_billing_jobs_for_deal
-- εισάγει το job ΧΩΡΙΣ installment_plan → default 'none'. Κανείς δεν
-- συμφιλιώνει τα δύο μετά: ο generator είναι no-op όταν υπάρχουν ήδη lines,
-- και το update_job_billing αρνείται (cannot_replan_paid_installment) μόλις
-- πληρωθεί η 1η δόση. Ίδιο πρόβλημα είχε ήδη διορθωθεί σημειακά για τα
-- 005690/000249 (docs/data-fixes/2026-09-07-005690-webdev-installments.md,
-- migration 20260904300000) — αυτό εδώ κλείνει την πηγή.
--
-- Τι κάνει:
--   1. release_billing_jobs_for_deal: το generic job insert σφραγίζει πλέον
--      installment_plan από το payment_terms, ΜΟΝΟ για one-time web_dev με
--      terms 50_50/50_25_25 (καθρέφτης του split-condition του
--      seed_deal_payments — 20260827200000:114-124).
--   2. Backfill των ζωντανών ασυμφωνιών (7 στις 2026-09-09): plan από τα
--      ΠΡΑΓΜΑΤΙΚΑ payments — 2 ίσες δόσεις → 50_50, σχήμα 50/25/25 →
--      50_25_25, αλλιώς custom + installment_schedule από τα rows, μόνο όταν
--      το άθροισμα κουμπώνει με το amount_net (αλλιώς RAISE NOTICE, μένει για
--      απόφαση owner). Τα payments ΔΕΝ αγγίζονται.
--   3. accounting_integrity_alerts: νέος έλεγχος 31 webdev_plan_vs_installments
--      ώστε μελλοντικό drift (π.χ. χειροκίνητο Add payment «υπόλοιπο») να
--      φαίνεται στη σελίδα Alerts αντί να μένει αόρατο.
--
-- Τα δύο function bodies είναι ΑΥΤΟΥΣΙΑ τα live definitions (fetched &
-- md5-checked την ώρα του γραψίματος) με μόνο τις περιγραφόμενες προσθήκες:
--   release_billing_jobs_for_deal  pre-md5 0b77463fc328aafc0280e7b4d2f28e83
--                                  (= 20260903220000 emission, no drift)
--   accounting_integrity_alerts    pre-md5 f9f2a5c154e5ad438c6848a892c36766
-- Post-change md5 στο deploy output.
--
-- ROLLBACK:
--   Ξανατρέξε το release_billing_jobs_for_deal body του 20260903220000 και το
--   accounting_integrity_alerts του προηγούμενου emission (pre-md5 πάνω)·
--   update public.jobs set installment_plan='none', installment_schedule=null
--    where id in (τα backfilled ids — καταγράφονται στα NOTICEs του deploy).
-- =============================================================================

-- --- 1. Ο seeder σφραγίζει το plan -------------------------------------------
CREATE OR REPLACE FUNCTION public.release_billing_jobs_for_deal(target_deal_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_group uuid; v_local_group uuid;
        v_unpaid boolean; v_reason text; v_at timestamptz;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  -- Never paid = no full-payment stamp AND no settled payment row. A service
  -- added later to an ALREADY paid deal is therefore born open, as before.
  v_unpaid := d.first_paid_in_full_at is null
              and not exists (select 1 from public.deal_payments p
                               where p.deal_id = d.id and p.paid_at is not null);
  v_reason := case when v_unpaid then 'awaiting_first_payment' else null end;
  v_at     := case when v_unpaid then now() else null end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- 2026-08-31 (006042): never open a job for an unpriced service row —
    -- defense in depth behind the convert_lead_to_client validation (other
    -- deal-insert paths must not spawn phantom 0-euro jobs either). The AI SEO
    -- 0-euro children below are unaffected: they are explicit inserts, not
    -- services_planned rows.
    if coalesce(nullif(service->>'one_time_amount','')::numeric, 0)
       + coalesce(nullif(service->>'monthly_amount','')::numeric, 0)
       + coalesce(nullif(service->>'setup_fee','')::numeric, 0) <= 0 then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);

    -- AI SEO: off-board billing record + off-board web & local work cards (placed at Fully Paid).
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', null, v_web_group, v_parent, now(), d.code,
          v_unpaid, v_reason, v_at);  -- OFF-BOARD until Fully Paid

      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', null, v_local_group, v_parent, now(), d.code,
          v_unpaid, v_reason, v_at);  -- OFF-BOARD until Fully Paid

      inserted := inserted + 1;
      continue;
    end if;

    select id into v_group from public.groups where code = st;
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        one_time_amount, monthly_amount, setup_fee, title, stage_id, assigned_group_id, owner_user_id,
        status, billing_active, is_custom, started_at, code,
        is_blocked, blocked_reason, blocked_at, installment_plan)
      values (d.id, d.client_id, st, bt, v_amount, v_vat,
        nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
        nullif(service->>'setup_fee','')::numeric, initcap(replace(st, '_', ' ')),
        null, v_group, null,                       -- OFF-BOARD: stage_id null, no owner yet
        'active', true, false, now(), d.code,
        v_unpaid, v_reason, v_at,
        -- 2026-09-09: mirror seed_deal_payments' split condition EXACTLY —
        -- the seeder cuts 'Installment i/n' rows for one-time web_dev when the
        -- sales form's payment_terms says so, and the job must DECLARE the
        -- same plan or the billing panel shows «Πλήρης (1 πληρωμή)» over a
        -- 2-δόσεις ledger (deal 006042 class). Other services never split
        -- here, so they stay 'none' (stamping them would create the inverse
        -- mismatch).
        case when st = 'web_dev' and bt = 'one_time'
              and service->>'payment_terms' in ('50_50','50_25_25')
             then service->>'payment_terms' else 'none' end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$
;

-- --- 2. Backfill: plan από τα πραγματικά payments ----------------------------
do $$
declare
  r record; v jsonb; v_pays int; v_sum numeric; a1 numeric; a2 numeric; a3 numeric;
  v_plan text; v_sched jsonb; v_fixed int := 0;
begin
  for r in
    select j.id, j.code, j.amount_net
      from public.jobs j
     where j.service_type = 'web_dev' and j.billing_type = 'one_time'
       and coalesce(j.installment_plan,'none') = 'none' and not j.archived
       and (select count(distinct p.id)
              from public.deal_payment_lines l
              join public.deal_payments p on p.id = l.payment_id and p.status <> 'cancelled'
             where l.job_id = j.id) > 1
  loop
    -- Ένα «δοσο-ποσό» ανά payment (άθροισμα των lines του job στο payment),
    -- με την ημερομηνία του payment για το τυχόν custom schedule.
    select count(*), sum(t.amt),
           jsonb_agg(jsonb_build_object('amount_net', t.amt, 'due_date', t.due)
                     order by t.due asc nulls last, t.amt desc)
      into v_pays, v_sum, v_sched
      from (select p.id, sum(l.amount_net) as amt, min(p.start_date) as due
              from public.deal_payment_lines l
              join public.deal_payments p on p.id = l.payment_id and p.status <> 'cancelled'
             where l.job_id = r.id
             group by p.id) t;

    select max(t.amt), min(t.amt)
      into a1, a2
      from (select sum(l.amount_net) as amt
              from public.deal_payment_lines l
              join public.deal_payments p on p.id = l.payment_id and p.status <> 'cancelled'
             where l.job_id = r.id group by p.id) t;

    v_plan := null;
    if abs(coalesce(v_sum,0) - coalesce(r.amount_net,0)) > 0.02 then
      raise notice 'SKIP % — δόσεις % με σύνολο % <> amount_net % (θέλει απόφαση owner)',
        r.code, v_pays, v_sum, r.amount_net;
      continue;
    end if;

    if v_pays = 2 and abs(a1 - a2) <= 0.02 then
      v_plan := '50_50'; v_sched := null;
    elsif v_pays = 3 then
      select (array_agg(t.amt order by t.amt desc))[1],
             (array_agg(t.amt order by t.amt desc))[2],
             (array_agg(t.amt order by t.amt desc))[3]
        into a1, a2, a3
        from (select sum(l.amount_net) as amt
                from public.deal_payment_lines l
                join public.deal_payments p on p.id = l.payment_id and p.status <> 'cancelled'
               where l.job_id = r.id group by p.id) t;
      if abs(a1 - r.amount_net * 0.5) <= 0.02
         and abs(a2 - r.amount_net * 0.25) <= 0.02
         and abs(a3 - r.amount_net * 0.25) <= 0.02 then
        v_plan := '50_25_25'; v_sched := null;
      end if;
    end if;
    if v_plan is null then
      v_plan := 'custom';  -- schedule = τα πραγματικά rows, ήδη στο v_sched
    end if;

    update public.jobs
       set installment_plan = v_plan,
           installment_schedule = case when v_plan = 'custom' then v_sched else null end,
           updated_at = now()
     where id = r.id;
    v_fixed := v_fixed + 1;
    raise notice 'FIXED % -> % (% δόσεις, σύνολο %)', r.code, v_plan, v_pays, v_sum;
  end loop;
  raise notice 'Backfilled % web_dev jobs', v_fixed;
end $$;

-- --- 3. Integrity check 31 ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounting_integrity_alerts()
 RETURNS TABLE(check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts (check_key, severity, category, subject_type,
               subject_id, subject_code, title, detail,
               deal_id, job_id, signature) as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing (Cyprus + UAE are legit 0%-VAT countries)
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not a 0%-VAT country (Cyprus/UAE) and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
       and coalesce(c.country,'') not ilike 'united arab emirates'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap: recurring billing has STALLED — no period covers today.
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring billing has stalled',
           'No billing period covers today (schedule lapsed)', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled'
                        and p.start_date <= current_date and p.end_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, coalesce(c.code, left(c.id::text,8)), 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
    union all
    -- 15 cash_deal_with_vat: deal chose cash + no-VAT, yet a job still charges VAT
    select 'cash_deal_with_vat','amber','possible_mistakes','job', j.id, j.code,
           'Cash deal but VAT charged',
           'Deal is cash + no-VAT, but this job has VAT '||j.vat_rate::text||'%',
           j.deal_id, j.id, j.vat_rate::text
      from jobs j join deals d on d.id=j.deal_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0
       and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)
    union all
    -- 16 duplicate_vat_number: two+ active clients share a VAT number
    select 'duplicate_vat_number','amber','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Duplicate VAT number', 'VAT '||c.vat_number||' is shared by another client',
           null::uuid, null::uuid, c.vat_number
      from clients c
     where not c.archived and nullif(trim(coalesce(c.vat_number,'')),'') is not null
       and exists (select 1 from clients c2 where c2.id<>c.id and not c2.archived
                    and trim(coalesce(c2.vat_number,''))=trim(c.vat_number))
    union all
    -- 17 deal_value_mismatch: deal's monthly value != sum of its recurring job amounts
    select 'deal_value_mismatch','grey','possible_mistakes','deal', d.id, d.code,
           'Deal value differs from its jobs',
           'Monthly value E'||coalesce(d.recurring_monthly_value,0)::text||' vs jobs E'||js.jobsum::text,
           d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
      join lateral (select coalesce(sum(j.amount_net),0) as jobsum from jobs j
                     where j.deal_id=d.id and not j.archived and j.billing_active
                       and j.billing_type in ('recurring_monthly','recurring_yearly')) js on true
     where not d.archived and ps.code not in ('closed','done')
       and js.jobsum>0 and coalesce(d.recurring_monthly_value,0)>0
       and abs(coalesce(d.recurring_monthly_value,0)-js.jobsum)>=1
    union all
    -- 18 large_recurring_amount: an unusually large recurring amount (possible typo)
    select 'large_recurring_amount','grey','possible_mistakes','job', j.id, j.code,
           'Unusually large recurring amount', 'Recurring E'||j.amount_net::text||' / period',
           j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)>3000
    union all
    -- 19 test_client_name: client name looks like a test/placeholder
    select 'test_client_name','grey','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Test-looking client name', 'Client name: '||c.name, null::uuid, null::uuid, ''
      from clients c
     where not c.archived and coalesce(c.status,'')<>'done'
       and (c.name ilike '%test%' or c.name ilike '%δοκιμ%' or c.name ilike '%asdf%'
            or c.name ilike '%xxx%' or c.name ilike '%qwerty%')
    union all
    -- 20 off_board_job: active service job on a Paid-In-Full deal with no board stage
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance','franchise','domains')
    union all
    -- 21 seo_renewal_pending: a PAID cycle the card was never renewed for.
    --     Mirrors seo_sync_renewal_job's guard (20260804090000). Normally empty —
    --     the move is automatic — so a row here means the move itself failed.
    select 'seo_renewal_pending','red','lifecycle','job', j.id, j.code,
           'Paid cycle not sent to Renewal',
           'Period from '||j.period_start_date::text||' is paid but the card sits in '||
             coalesce(s.code,'?')||' (last renewed for '||
             coalesce(j.renewed_for_period::text,'never')||')',
           j.deal_id, j.id, j.period_start_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and not s.is_terminal and s.code <> 'renewal'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and j.period_start_date is not null
       and j.period_start_date > coalesce(j.renewed_for_period,
                                          (j.onboarded_at + interval '14 days')::date)
    union all
    -- 22 seo_job_no_period: client has paid on this deal, job has no period at all.
    --     recompute_job_period_dates matches on service_type AND billing_type, so a
    --     mis-keyed payment leaves the job dateless and every guard downstream
    --     (renewal, due chips, reminders) silently no-ops.
    --     Live cards only: on a terminal lane the missing period is history, not a
    --     defect (6 of the 14 matches on 2026-08-04 were closed engagements).
    select 'seo_job_no_period','red','lifecycle','job', j.id, j.code,
           'Paid deal but job has no billing period',
           'No paid payment matches this job on service type + billing type',
           j.deal_id, j.id, ''
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and j.period_start_date is null
       and not s.is_terminal and j.status='active'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and exists (select 1 from deal_payments p
                    where p.deal_id=j.deal_id and p.status='paid')
    union all
    -- 23 paid_period_no_job: the same defect seen from the payment side.
    select 'paid_period_no_job','amber','lifecycle','deal', p.deal_id,
           (select code from deals where id=p.deal_id),
           'Paid period matches no job',
           'Paid '||coalesce(p.service_type,'(no service)')||' '||
             coalesce(p.start_date::text,'?')||' has no live job of that service on the deal',
           p.deal_id, null::uuid,
           coalesce(p.service_type,'')||':'||coalesce(p.start_date::text,'')
      from deal_payments p join deals d on d.id=p.deal_id
     where p.status='paid' and not d.archived and p.service_type is not null
       and not exists (select 1 from jobs j
                        where j.deal_id=p.deal_id and not j.archived
                          and j.service_type=p.service_type)
       and not exists (select 1 from deal_payment_lines l where l.payment_id=p.id)
    union all
    -- 24 service_card_not_billing: a live card whose service nobody bills.
    --     ensure_recurring_payments() only extends a period when a NON-archived,
    --     billing_active job of the same service_type + billing_type exists, so
    --     clearing billing_active on the last such job stops the schedule for
    --     ever — silently, because billing_gap (check 11) needs a billing_active
    --     recurring job to fire at all. Deal 000403 ran two months this way.
    --     Exclusions, each measured on prod 2026-08-04 (131 -> 10 rows):
    --       parent_job_id / billing_only  AI-SEO trio children bill on the parent (-96)
    --       ai_seo parent on the deal     same structure, seen from the child (-2)
    --       amount_net = 0                bundled or free, nothing to bill (-2)
    --       deal stage closed/done        finished engagement, stale card (-20)
    --       status <> 'active'            the team ended the work (-1)
    select 'service_card_not_billing','red','lifecycle','job', j.id, j.code,
           'Live service card with no active billing',
           'Card is live and bills EUR '||j.amount_net::text||'/period, but no '||
             'billing_active recurring job covers '||j.service_type||' on this deal',
           j.deal_id, j.id, ''
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived and not s.is_terminal
       and ps.code not in ('closed','done')
       and j.status = 'active'
       and j.service_type in ('web_seo','local_seo','ads','social_media','maintenance')
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and not j.billing_active
       and j.parent_job_id is null
       and not coalesce(j.billing_only, false)
       and coalesce(j.amount_net, 0) > 0
       and not exists (select 1 from jobs j2
                        where j2.deal_id = j.deal_id and not j2.archived
                          and j2.service_type = j.service_type and j2.billing_active)
       and not exists (select 1 from jobs p
                        where p.deal_id = j.deal_id and not p.archived
                          and p.billing_active and p.service_type = 'ai_seo')
    union all
    -- 25 invisible_card: a live card that has a stage but renders in NO column.
    --     The kanban builds its columns from the board's NON-ARCHIVED stages
    --     (src/features/jobs/JobsKanbanPage.tsx:114) and groupJobsForBoard drops
    --     any card whose stage code has no matching column with a bare
    --     `if (!col) continue` (src/features/jobs/kanbanGrouping.ts:82). The card
    --     exists, is not archived, is not blocked, has a stage — and is visible
    --     nowhere. Deal 006122 sat like this for three days after a convert put
    --     its Web SEO card on the archived web_seo/onboarding stage, and nothing
    --     in the product could say why the team had no card to work on.
    --     Distinct from check 20 off_board_job, which catches stage_id IS NULL.
    --     Not raised when the card is blocked on a board that renders a virtual
    --     Blocked column (local_seo, web_seo, social_media, ads, maintenance,
    --     franchise, and ai_seo via those two SEO boards): kanbanGrouping diverts
    --     blocked cards there BEFORE the column lookup, so they stay visible.
    --     signature = the stage id, so dismissing one broken stage does not hide
    --     the card if it later lands on a different broken stage.
    select 'invisible_card','red','lifecycle','job', j.id, j.code,
           'Card is live but invisible on its board',
           'Job sits on '||s.board||'/'||s.code||
             case when s.archived then ' (archived stage)' else ' (stage belongs to another board)' end||
             ', so the '||j.service_type||' kanban renders no column for it',
           j.deal_id, j.id, s.id::text
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived
       and ps.code not in ('closed','done')
       and not (j.is_blocked and j.service_type in
                ('local_seo','web_seo','social_media','ads','maintenance','franchise','ai_seo'))
       and not exists (
         select 1 from pipeline_stages c
          where not c.archived and c.code = s.code
            and c.board = any (case when j.service_type = 'ai_seo'
                                    then array['web_seo','local_seo']
                                    else array[j.service_type] end))
    union all
    -- 26 payment_vat_mismatch: the check A0 proved was completely missing (0 of
    --     27 broken rows were visible anywhere). Non-cancelled deal_payments
    --     rows whose vat_rate disagrees with the single VAT rule
    --     (public.deal_vat_rate). Cancelled rows are excluded — voided, no VAT
    --     will ever be collected on them.
    --     EXPECTED to fire on two known, owner-gated populations until a
    --     decision is made (visible != forgotten is the point of this check):
    --       - the A0 cash-charged-VAT rows paid before the 2026-08-26 fix
    --       - the B3 mirror bug: online deals whose vat_rate was copied forward
    --         at 0% and never corrected to the country rate (raising it now
    --         would silently re-invoice a client)
    --     signature carries both sides of the mismatch so a future edit to
    --     either value re-surfaces the row instead of hiding behind a stale
    --     dismissal recorded at the old numbers.
    select 'payment_vat_mismatch','amber','money','deal_payment', dp.id, d.code,
           'Payment VAT does not match the deal''s VAT rule',
           'VAT is '||dp.vat_rate::text||'% but deal_vat_rate() expects '||
             public.deal_vat_rate(dp.deal_id)::text||'%',
           dp.deal_id, null::uuid,
           dp.vat_rate::text||'->'||coalesce(public.deal_vat_rate(dp.deal_id)::text,'?')
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status<>'cancelled'
       and dp.vat_rate is distinct from public.deal_vat_rate(dp.deal_id)
    union all
    -- 27 paid_backdate_gap: a payment marked paid more than 30 days after its
    --     own service period started. Reference case: deal 000205 (ΓΑΒΡΙΗΛΙΔΗΣ
    --     ΜΠΑΝΤΑΒΑΣ), web_dev, period started 2026-04-02, was paid around that
    --     date but paid_at was stamped 2026-08-06 — its income was invisible in
    --     April and only surfaced four months later where nobody was looking
    --     for it (repaired 2026-08-27,
    --     docs/data-fixes/2026-08-27-paid-at-backdate-repair.md). This is the
    --     standing guard so that class of gap can never silently return.
    select 'paid_backdate_gap','red','lifecycle','deal_payment', dp.id, d.code,
           'Paid long after the period started',
           'Marked paid on '||dp.paid_at::date::text||' for a period starting '||
             dp.start_date::text||' ('||(dp.paid_at::date - dp.start_date)::text||' days)',
           dp.deal_id, null::uuid, dp.paid_at::date::text
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status='paid' and dp.paid_at::date > dp.start_date + 30
    union all
    -- 27b paid_backdate_gap (expenses, final-review addition): the same
    --     ΓΑΒΡΙΗΛΙΔΗΣ-class predicate on the OTHER money table. Check 27 above
    --     only ever watched deal_payments; expenses have the identical
    --     status/paid_at/start_date shape and were completely unwatched for
    --     this class. Same check_key so both tables' backdated-paid rows show
    --     up together under one alert kind.
    select 'paid_backdate_gap','red','lifecycle','expense', e.id,
           coalesce(e.vendor, left(e.id::text,8)),
           'Paid long after the period started',
           'Marked paid on '||e.paid_at::date::text||' for a period starting '||
             e.start_date::text||' ('||(e.paid_at::date - e.start_date)::text||' days)',
           null::uuid, null::uuid, e.paid_at::date::text
      from expenses e
     where e.status='paid' and e.paid_at::date > e.start_date + 30
    union all
    -- 28 payment_missing_dates: a live (non-cancelled) payment row with no
    --     start_date. Every date-driven guard downstream (renewal, due chips,
    --     reminders, check 27 above) silently no-ops on a dateless row, so it
    --     needs its own daily surface until fixed.
    select 'payment_missing_dates','amber','missing','deal_payment', dp.id, d.code,
           'Payment has no start date',
           coalesce(nullif(dp.service_type,''),'(no service)')||' '||dp.status||' payment has start_date = NULL',
           dp.deal_id, null::uuid, ''
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status<>'cancelled' and dp.start_date is null
    union all
    -- 29 expense_stale_pending: an expense still "pending" more than 60 days
    --     after its own period ended — either it was actually paid and nobody
    --     flipped the status, or it is genuinely unpaid and two months overdue.
    --     Either way it needs a human, not a nightly no-op.
    select 'expense_stale_pending','amber','lifecycle','expense', e.id,
           coalesce(e.vendor, left(e.id::text,8)), 'Expense pending long after it ended',
           coalesce(e.vendor,'(no vendor)')||' ended '||e.end_date::text||' and is still pending',
           null::uuid, null::uuid, ''
      from expenses e
     where e.status='pending' and e.end_date < current_date - 60
    union all
    -- 30 expense_zero_vat_streak: a software/ads_spend/hosting_domains expense
    --     entered in the last 7 days at 0% VAT. Task 1 finding E5 found 100% of
    --     expenses carry vat_rate=0 (owner-gated, unresolved) — this does not
    --     fix that, it nudges the question at the moment of entry for the three
    --     categories most likely to actually carry real VAT, instead of letting
    --     the backlog grow unnoticed.
    select 'expense_zero_vat_streak','grey','possible_mistakes','expense', e.id,
           coalesce(e.vendor, left(e.id::text,8)), 'New expense at 0% VAT',
           coalesce(e.vendor,'(no vendor)')||' ('||ec.key||') entered at 0% VAT — confirm that''s correct',
           null::uuid, null::uuid, ''
      from expenses e join expense_categories ec on ec.id=e.category_id
     where e.created_at >= now() - interval '7 days'
       and coalesce(e.vat_rate,0)=0
       and ec.key in ('software','ads_spend','hosting_domains')
    union all
    -- 31 webdev_plan_vs_installments: a one-time web_dev job whose ledger
    --     holds more than one non-cancelled payment while the job still
    --     declares installment_plan = 'none' — the billing panel then shows
    --     «Πλήρης (1 πληρωμή)» over a multi-δόσεις ledger (deal 006042 class,
    --     2026-09-09). Catches the two ways this can still happen after the
    --     release_billing_jobs_for_deal fix: manual «Add payment» splits and
    --     any future seeding drift.
    select 'webdev_plan_vs_installments','amber','possible_mistakes','job', j.id,
           coalesce(j.code, left(j.id::text,8)),
           'Website has installments but no declared plan',
           coalesce(j.code,'(no code)')||' has '||count(distinct dp.id)||' non-cancelled payments but installment_plan is none',
           j.deal_id, j.id, ''
      from jobs j
      join deal_payment_lines dl on dl.job_id = j.id
      join deal_payments dp on dp.id = dl.payment_id and dp.status <> 'cancelled'
     where j.service_type = 'web_dev' and j.billing_type = 'one_time'
       and coalesce(j.installment_plan,'none') = 'none' and not j.archived
     group by j.id, j.code, j.deal_id
    having count(distinct dp.id) > 1
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $function$
;
