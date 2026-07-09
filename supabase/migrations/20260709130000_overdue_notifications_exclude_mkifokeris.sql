-- 2026-07-09: Exclude mkifokeris@itdev.gr from overdue bell notifications.
-- Follow-up to 20260709120000 (which scoped 'payment_overdue' notifications to
-- the accounting group). mkifokeris@itdev.gr is a member of the accounting group
-- but, per owner request, should NOT receive the overdue bell reminders, while
-- stavroula@itdev.gr (also accounting) should continue to. This adds a single
-- null-safe email exclusion to the recipients CTE and keeps him in the group
-- (so his accounting access is unaffected). Everything else is unchanged.

CREATE OR REPLACE FUNCTION public.mark_overdue_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               and dp.start_date is not null and dp.start_date <  current_date)
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
       and p.email is distinct from 'mkifokeris@itdev.gr'  -- opted out of overdue reminders
       and exists (
             select 1 from public.user_groups ug
               join public.groups g on g.id = ug.group_id
              where ug.user_id = p.user_id and g.code = 'accounting')
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
end $function$;

-- ROLLBACK: remove the line
--   `and p.email is distinct from 'mkifokeris@itdev.gr'  -- opted out ...`
-- to restore delivery to the full accounting group (state after 20260709120000).
