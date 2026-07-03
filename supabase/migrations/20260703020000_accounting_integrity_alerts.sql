-- 2026-07-03: Live billing/data integrity checks for the Accounting Alerts page.
create or replace function public.accounting_integrity_alerts()
returns table (check_key text, severity text, category text, subject_type text,
               subject_id uuid, subject_code text, title text, detail text,
               deal_id uuid, job_id uuid, signature text)
language plpgsql stable security definer set search_path = public as $$
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
    -- 3 vat_missing
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not Cyprus and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
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
    -- (Mid-cycle deals are covered by a current period, so they don't match; the
    --  next renewal is only generated ~7d before the current ends, so "no future
    --  payment" alone is normal and NOT a gap.)
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
    -- (invisible on its kanban board). Auto-healed by the reconcile_offboard_jobs cron;
    -- surfaced here too so it is visible in the window before the cron runs.
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads')
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $$;
revoke all on function public.accounting_integrity_alerts() from public, anon;
grant execute on function public.accounting_integrity_alerts() to authenticated;

create or replace function public.accounting_integrity_alerts_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.accounting_integrity_alerts();
$$;
revoke all on function public.accounting_integrity_alerts_count() from public, anon;
grant execute on function public.accounting_integrity_alerts_count() to authenticated;

-- ROLLBACK:
--   drop function if exists public.accounting_integrity_alerts_count();
--   drop function if exists public.accounting_integrity_alerts();
