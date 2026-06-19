-- Make deal_payments self-healing for service_index / service_type.
--
-- The ClickUp reseed (and the "+ Add payment" UI) insert deal_payments with NULL
-- service_index + service_type. NULL service_index previously broke recurring-
-- billing idempotency (fixed in 20260619120000), and NULL service_type means the
-- payment doesn't link to its service/job for reporting & payment-line job linking.
--
-- This adds a BEFORE INSERT trigger that, when those keys are missing, derives
-- service_type from the unique amount-matching job on the deal and assigns a
-- service_index (reusing the index of an existing matching billing series so
-- recurring successors stay in the same series, else the next free per-deal index).
-- Covers every insert path, including the external reseed we don't control.
-- Then backfills the existing rows.

create or replace function public.deal_payments_default_service_keys()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Derive service_type from a unique amount-matching active job on the deal.
  if new.service_type is null then
    select j.service_type into new.service_type
      from public.jobs j
     where j.deal_id = new.deal_id and not j.archived and j.amount_net = new.amount_net
     order by j.created_at
     limit 1;
  end if;

  -- Assign service_index: reuse the matching billing series' index if one exists,
  -- otherwise the next free index for this deal.
  if new.service_index is null then
    select dp.service_index into new.service_index
      from public.deal_payments dp
     where dp.deal_id = new.deal_id
       and dp.billing_type = new.billing_type
       and dp.service_type is not distinct from new.service_type
       and dp.amount_net   is not distinct from new.amount_net
       and dp.service_index is not null
     order by dp.service_index
     limit 1;

    if new.service_index is null then
      select coalesce(max(dp.service_index), -1) + 1 into new.service_index
        from public.deal_payments dp where dp.deal_id = new.deal_id;
    end if;
  end if;

  return new;
end $function$;

drop trigger if exists deal_payments_default_service_keys on public.deal_payments;
create trigger deal_payments_default_service_keys
  before insert on public.deal_payments
  for each row execute function public.deal_payments_default_service_keys();

-- ── Backfill existing rows ────────────────────────────────────────────────────
-- 1) service_type from the unique amount-matching job
update public.deal_payments p
   set service_type = (
     select j.service_type from public.jobs j
      where j.deal_id = p.deal_id and not j.archived and j.amount_net = p.amount_net
      order by j.created_at limit 1)
 where p.service_type is null
   and (select count(*) from public.jobs j
         where j.deal_id = p.deal_id and not j.archived and j.amount_net = p.amount_net) = 1;

-- 2) service_index: same index per (service_type, billing_type, amount_net) series,
--    offset past any existing non-null index on the deal.
with base as (
  select deal_id, max(service_index) as maxidx
    from public.deal_payments where service_index is not null group by deal_id
),
series as (
  select p.id, p.deal_id,
    dense_rank() over (partition by p.deal_id
                       order by p.service_type, p.billing_type, p.amount_net) - 1 as rk
  from public.deal_payments p where p.service_index is null
)
update public.deal_payments p
   set service_index = s.rk + coalesce(b.maxidx, -1) + 1
  from series s left join base b on b.deal_id = s.deal_id
 where p.id = s.id;

-- CHANGES / REVERT:
--   drop trigger if exists deal_payments_default_service_keys on public.deal_payments;
--   drop function if exists public.deal_payments_default_service_keys();
--   (the backfilled service_index/service_type values can be reset to NULL if needed,
--    but they are derived correctly and should be kept.)
