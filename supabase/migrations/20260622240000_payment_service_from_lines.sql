-- Payments showed no/ wrong service name because the payment HEADER's service_type was set
-- to null by generate_payments_for_deal (the real service is only on the payment lines/jobs),
-- and an earlier backfill from deals.services_planned mis-tagged deals whose services_planned
-- was incomplete. Fix: derive the payment's service_type from its LINES' job (the accurate
-- source) — in the generator (future payments) + a backfill (existing). Plus convert hosting
-- payments that are still one_time to recurring_yearly (the job is now yearly). Reversible.

-- (1) Generator: set the grouped payment header's service_type from its lines' jobs.
create or replace function public.generate_payments_for_deal(target_deal_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $function$
declare
  v_start date; v_end date; grp record; j record; v_payment_id uuid;
  v_total_cents int; v_alloc int; v_cents int; v_n int; v_i int; v_vat numeric; v_due date;
begin
  select coalesce(actual_close_date, current_date) into v_start from public.deals where id = target_deal_id;
  if v_start is null then v_start := current_date; end if;

  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
       and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25')
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and coalesce(l.label, '') <> 'Setup fee')
  loop
    v_vat := coalesce(j.vat_rate, 24);
    v_total_cents := round(coalesce(j.amount_net, 0) * 100)::int;
    v_n := case j.installment_plan when '50_25_25' then 3 else 2 end;
    v_alloc := 0;
    for v_i in 1..v_n loop
      if v_i = v_n then v_cents := v_total_cents - v_alloc;
      elsif v_i = 1 then v_cents := round(v_total_cents * 0.5)::int;
      else v_cents := round(v_total_cents * 0.25)::int; end if;
      v_alloc := v_alloc + v_cents;
      v_due := case when v_i = 1 then v_start else null end;
      insert into public.deal_payments
        (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
        values (target_deal_id, j.service_type, 'one_time', v_due, v_due, 'pending',
                v_cents / 100.0, v_vat, 'Installment ' || v_i || '/' || v_n)
        returning id into v_payment_id;
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id,
                coalesce(nullif(j.title, ''), j.service_type) || ' (' || v_i || '/' || v_n || ')',
                v_cents / 100.0, v_vat);
    end loop;
  end loop;

  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key, jb.billing_type
      from public.jobs jb
     where jb.deal_id = target_deal_id and not jb.archived and jb.billing_active
       and jb.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and not (jb.billing_type = 'one_time' and jb.service_type = 'web_dev'
                and coalesce(jb.installment_plan, 'none') in ('50_50', '50_25_25'))
       and not exists (select 1 from public.deal_payment_lines l where l.job_id = jb.id)
     group by coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text), jb.billing_type
  loop
    v_end := case grp.billing_type
               when 'recurring_monthly' then (v_start + interval '1 month')::date
               when 'recurring_yearly'  then (v_start + interval '1 year')::date
               else v_start end;
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, null, grp.billing_type, v_start, v_end, 'pending', 0, 24)
      returning id into v_payment_id;
    for j in
      select * from public.jobs jj
       where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
         and jj.billing_type = grp.billing_type
         and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key
         and not (jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
                  and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25'))
         and not exists (select 1 from public.deal_payment_lines l where l.job_id = jj.id)
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;
    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24),
      service_type = (select case when count(distinct j2.service_type) filter (where j2.service_type is not null) = 1
                                  then max(j2.service_type) else null end
                      from public.deal_payment_lines l join public.jobs j2 on j2.id = l.job_id
                      where l.payment_id = p.id)
     where p.id = v_payment_id;
  end loop;

  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and coalesce(jj.setup_fee, 0) > 0
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and l.label = 'Setup fee')
  loop
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, j.service_type, 'one_time', v_start, v_start, 'pending', j.setup_fee, coalesce(j.vat_rate, 24))
      returning id into v_payment_id;
    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id, j.id, 'Setup fee', j.setup_fee, coalesce(j.vat_rate, 24));
  end loop;
end $function$;

-- (2) Backfill existing payments' service_type from their lines' job (single distinct service).
create table if not exists public.deal_payments_service_fix_20260622 (
  id uuid, old_service_type text, new_service_type text, backed_up_at timestamptz default now());
with svc as (
  select l.payment_id,
    case when count(distinct j.service_type) filter (where j.service_type is not null) = 1
         then max(j.service_type) else null end as svc
  from public.deal_payment_lines l join public.jobs j on j.id = l.job_id
  group by l.payment_id
)
insert into public.deal_payments_service_fix_20260622 (id, old_service_type, new_service_type)
select p.id, p.service_type, s.svc
from public.deal_payments p join svc s on s.payment_id = p.id
where s.svc is not null and p.service_type is distinct from s.svc;

update public.deal_payments p
   set service_type = b.new_service_type
  from public.deal_payments_service_fix_20260622 b
 where p.id = b.id;

-- (3) Hosting payments still one_time but whose hosting job is now recurring_yearly → make the
-- payment recurring_yearly with a 1-year period (so the cadence matches + it renews). Backup.
create table if not exists public.deal_payments_hosting_yearly_20260622 (
  id uuid, old_billing_type text, old_end_date date, backed_up_at timestamptz default now());
insert into public.deal_payments_hosting_yearly_20260622 (id, old_billing_type, old_end_date)
select p.id, p.billing_type, p.end_date
from public.deal_payments p
where p.billing_type = 'one_time'
  and exists (select 1 from public.deal_payment_lines l join public.jobs j on j.id = l.job_id
              where l.payment_id = p.id and j.service_type = 'hosting' and j.billing_type = 'recurring_yearly');

update public.deal_payments p
   set billing_type = 'recurring_yearly', end_date = (p.start_date + interval '1 year')::date
  from public.deal_payments_hosting_yearly_20260622 b
 where p.id = b.id;
