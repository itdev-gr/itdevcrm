-- =============================================================================
-- Align mark_overdue_payments with the system's due-date model.
--
-- The whole block lifecycle (deal_next_due, target_accounting_stage,
-- reconcile_block_lifecycle, deal_payments_release_from_on_hold) treats the
-- RECURRING due date as start_date (the start of the unpaid period). But the
-- live mark_overdue_payments was still on the legacy end_date basis, so a
-- recurring deal correctly went On Hold at start_date yet its payment row stayed
-- 'pending' (instead of 'overdue') — and the overdue notification fired — a full
-- period late. Smoke test 2026-06-28 found 98 recurring rows in this lagging
-- state (their deals were already correctly On Hold; only the status badge lagged).
--
-- Fix: recurring rows go overdue at start_date (<= today, matching the reconciler
-- exactly); one_time rows stay on end_date (< today) — unchanged, no drift there.
-- Then a one-time SILENT backfill flips the 98 lagging rows WITHOUT emitting
-- notifications (they are already On Hold; notifying now would just be noise).
-- =============================================================================

create or replace function public.mark_overdue_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  flipped int;
begin
  with flipped_rows as (
    update public.deal_payments dp
       set status = 'overdue'
      from public.deals d
     where d.id = dp.deal_id
       and d.archived = false
       and dp.status = 'pending'
       and (
            (dp.billing_type in ('recurring_monthly','recurring_yearly')
               and dp.start_date is not null and dp.start_date <= current_date)
         or (dp.billing_type = 'one_time'
               and dp.end_date  is not null and dp.end_date  <  current_date)
       )
    returning dp.id, dp.deal_id, dp.service_type, dp.amount_gross,
              dp.billing_type, dp.start_date, dp.end_date
  ),
  details as (
    select f.id, f.deal_id, f.service_type, f.amount_gross,
           case when f.billing_type in ('recurring_monthly','recurring_yearly')
                then f.start_date else f.end_date end as due_date,
           c.name as client_name
      from flipped_rows f
      join public.deals d on d.id = f.deal_id
      left join public.clients c on c.id = d.client_id
  ),
  recipients as (
    select p.user_id
      from public.profiles p
     where p.is_active and p.archived = false
       and (p.is_admin or exists (
             select 1 from public.user_groups ug
               join public.groups g on g.id = ug.group_id
              where ug.user_id = p.user_id and g.code = 'accounting'))
  ),
  inserted as (
    insert into public.notifications (user_id, type, payload)
    select r.user_id, 'payment_overdue',
           jsonb_build_object(
             'parent_type', 'deal', 'parent_id', det.deal_id,
             'parent_label', coalesce(det.client_name, ''),
             'service_type', det.service_type, 'amount_gross', det.amount_gross,
             'due_date', to_char(det.due_date, 'DD/MM/YYYY'),
             'payment_id', det.id)
      from details det cross join recipients r
    returning 1
  )
  select count(*) into flipped from details;
  return flipped;
end $$;

-- One-time SILENT backfill of the lagging recurring rows (no notifications).
create table if not exists public.deal_payments_overdue_backfill_backup_20260628 as
  select dp.id, dp.deal_id, dp.status, dp.billing_type, dp.start_date, dp.end_date, now() as backed_up_at
    from public.deal_payments dp
    join public.deals d on d.id = dp.deal_id
   where d.archived = false
     and dp.status = 'pending'
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.start_date is not null and dp.start_date <= current_date;

update public.deal_payments dp
   set status = 'overdue'
  from public.deals d
 where d.id = dp.deal_id
   and d.archived = false
   and dp.status = 'pending'
   and dp.billing_type in ('recurring_monthly','recurring_yearly')
   and dp.start_date is not null and dp.start_date <= current_date;

-- =============================================================================
-- CHANGES / REVERT
--   mark_overdue_payments(): recurring overdue basis end_date -> start_date (<= today);
--     one_time unchanged (end_date < today).
--   + silent backfill of recurring rows + backup deal_payments_overdue_backfill_backup_20260628.
--
-- ROLLBACK:
--   -- restore the pre-fix rows that this migration flipped:
--   update public.deal_payments dp set status = 'pending'
--     from public.deal_payments_overdue_backfill_backup_20260628 b
--    where dp.id = b.id and dp.status = 'overdue';
--   -- restore mark_overdue_payments() body from 20260610000004 (end_date < current_date for all types).
-- =============================================================================
