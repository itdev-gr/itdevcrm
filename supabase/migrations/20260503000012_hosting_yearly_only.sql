-- Hosting is sold yearly only. The frontend already enforces this on new
-- entries, but existing rows + the seed function need to be aligned.

-- 1. Coerce stored services_planned: any hosting service still on monthly /
--    one_time gets flipped to recurring_yearly.
update public.leads
   set services_planned = (
     select jsonb_agg(
       case
         when (svc->>'service_type') = 'hosting'
           then svc || jsonb_build_object('billing_type', 'recurring_yearly')
         else svc
       end
     )
     from jsonb_array_elements(services_planned) svc
   )
 where services_planned is not null
   and jsonb_typeof(services_planned) = 'array'
   and exists (
     select 1 from jsonb_array_elements(services_planned) s
      where s->>'service_type' = 'hosting' and (s->>'billing_type') is distinct from 'recurring_yearly'
   );

update public.deals
   set services_planned = (
     select jsonb_agg(
       case
         when (svc->>'service_type') = 'hosting'
           then svc || jsonb_build_object('billing_type', 'recurring_yearly')
         else svc
       end
     )
     from jsonb_array_elements(services_planned) svc
   )
 where services_planned is not null
   and jsonb_typeof(services_planned) = 'array'
   and exists (
     select 1 from jsonb_array_elements(services_planned) s
      where s->>'service_type' = 'hosting' and (s->>'billing_type') is distinct from 'recurring_yearly'
   );

-- 2. Fix deal_payments rows that came from a wrong-billing seed. Switch the
--    billing_type to yearly and stretch end_date by adding (1 year - 1 month)
--    so the customer's billing window matches reality. We only adjust rows
--    that are still pending — paid history stays intact.
update public.deal_payments
   set billing_type = 'recurring_yearly',
       end_date = case
         when start_date is not null and billing_type = 'recurring_monthly'
           then start_date + interval '1 year'
         else end_date
       end
 where service_type = 'hosting'
   and billing_type <> 'recurring_yearly'
   and status = 'pending';

-- 3. Update the seeder so future deals automatically force hosting → yearly.
create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record;
  svc jsonb;
  idx int := 0;
  s_start date;
  s_end date;
  amt numeric(12,2);
  bt text;
  st text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;

  if exists (select 1 from public.deal_payments where deal_id = d.id) then
    return;
  end if;

  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then
    return;
  end if;

  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    st := svc->>'service_type';
    bt := coalesce(svc->>'billing_type', 'one_time');
    -- Hosting is yearly only — coerce regardless of what's stored.
    if st = 'hosting' then bt := 'recurring_yearly'; end if;

    if bt = 'one_time' then
      amt := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      s_end := s_start;
    elsif bt = 'recurring_monthly' then
      amt := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 month';
    elsif bt = 'recurring_yearly' then
      amt := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 year';
    else
      amt := 0; s_end := s_start;
    end if;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount, start_date, end_date)
      values (d.id, st, idx, bt, amt, s_start, s_end);

    idx := idx + 1;
  end loop;
end $$;
