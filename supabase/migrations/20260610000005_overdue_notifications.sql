-- =============================================================================
-- Internal alerting for overdue payments: when the daily cron flips a payment
-- to 'overdue', every accounting member and admin gets an in-app notification
-- (type 'payment_overdue') linking to the deal. Clients already get reminder
-- emails; this closes the loop on OUR side.
--
-- Each payment notifies exactly once — only rows transitioning
-- pending → overdue are returned by the update, so re-runs are silent.
--
-- Rollback: re-create mark_overdue_payments from
-- supabase/migrations/20260610000004_money_seeding_and_overdue.sql.
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
       and dp.end_date is not null
       and dp.end_date < current_date
    returning dp.id, dp.deal_id, dp.service_type, dp.amount_gross, dp.end_date
  ),
  details as (
    select f.id, f.deal_id, f.service_type, f.amount_gross, f.end_date,
           c.name as client_name
      from flipped_rows f
      join public.deals d on d.id = f.deal_id
      left join public.clients c on c.id = d.client_id
  ),
  recipients as (
    select p.user_id
      from public.profiles p
     where p.is_active
       and p.archived = false
       and (
         p.is_admin
         or exists (
           select 1
             from public.user_groups ug
             join public.groups g on g.id = ug.group_id
            where ug.user_id = p.user_id
              and g.code = 'accounting'
         )
       )
  ),
  inserted as (
    insert into public.notifications (user_id, type, payload)
    select r.user_id,
           'payment_overdue',
           jsonb_build_object(
             'parent_type', 'deal',
             'parent_id', det.deal_id,
             'parent_label', coalesce(det.client_name, ''),
             'service_type', det.service_type,
             'amount_gross', det.amount_gross,
             'due_date', to_char(det.end_date, 'DD/MM/YYYY'),
             'payment_id', det.id
           )
      from details det
     cross join recipients r
    returning 1
  )
  select count(*) into flipped from details;

  return flipped;
end $$;
