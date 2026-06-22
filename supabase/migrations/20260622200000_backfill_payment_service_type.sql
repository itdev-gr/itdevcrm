-- Income-by-service shows mostly "Unspecified" because most paid deal_payments have a NULL
-- service_type (created/re-baselined manually). Each payment carries a service_index into its
-- deal's services_planned; backfill service_type from deals.services_planned[service_index]
-- (the current service on the deal). Fill-blank only; reversible via the backup table.
--
-- ROLLBACK:
--   update public.deal_payments dp set service_type=b.old_service_type
--     from public.deal_payments_service_backfill_20260622 b where dp.id=b.id;

create table if not exists public.deal_payments_service_backfill_20260622 (
  id uuid, old_service_type text, new_service_type text, backed_up_at timestamptz default now()
);

with resolved as (
  select dp.id,
         nullif(btrim((select d.services_planned -> dp.service_index ->> 'service_type'
                       from public.deals d where d.id = dp.deal_id)), '') as svc
  from public.deal_payments dp
  where dp.service_type is null and dp.service_index is not null
)
insert into public.deal_payments_service_backfill_20260622 (id, old_service_type, new_service_type)
select id, null, svc from resolved where svc is not null;

update public.deal_payments dp
   set service_type = b.new_service_type
  from public.deal_payments_service_backfill_20260622 b
 where dp.id = b.id and dp.service_type is null;
