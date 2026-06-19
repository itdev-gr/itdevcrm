-- Close the reseed-ordering gap for deal_payments.service_type.
--
-- The deal_payments BEFORE INSERT trigger (20260619130000) derives service_type
-- from an amount-matching job — but the ClickUp reseed sometimes inserts a payment
-- BEFORE its job exists, so derivation finds nothing and service_type stays NULL.
-- This adds an AFTER INSERT trigger on jobs that backfills any NULL-service_type
-- payments on the same deal whose net amount matches the new job, so service_type
-- self-heals no matter which side is inserted first. Plus a one-time mop-up.

create or replace function public.jobs_backfill_payment_service_type()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.service_type is not null and new.amount_net is not null then
    update public.deal_payments p
       set service_type = new.service_type
     where p.deal_id = new.deal_id
       and p.service_type is null
       and p.amount_net = new.amount_net;
  end if;
  return new;
end $function$;

drop trigger if exists jobs_backfill_payment_service_type on public.jobs;
create trigger jobs_backfill_payment_service_type
  after insert on public.jobs
  for each row execute function public.jobs_backfill_payment_service_type();

-- one-time mop-up for payments whose job already exists now
update public.deal_payments p
   set service_type = (
     select j.service_type from public.jobs j
      where j.deal_id = p.deal_id and not j.archived and j.amount_net = p.amount_net
      order by j.created_at limit 1)
 where p.service_type is null
   and (select count(*) from public.jobs j
         where j.deal_id = p.deal_id and not j.archived and j.amount_net = p.amount_net) = 1;

-- CHANGES / REVERT:
--   drop trigger if exists jobs_backfill_payment_service_type on public.jobs;
--   drop function if exists public.jobs_backfill_payment_service_type();
