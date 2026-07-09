-- 2026-07-09: Overdue bell notifications -> accounting group only.
-- mark_overdue_payments() inserts an in-app 'payment_overdue' notification
-- (the bell-icon "Payment reminder") for every recipient. The recipient set
-- previously included admins (p.is_admin) OR members of the 'accounting' group.
-- Per owner request, admins should no longer receive these; only the accounting
-- group should. This drops the `p.is_admin or` disjunct from the recipients CTE.
-- Everything else in the function body is unchanged from the live def
-- (supabase/migrations/20260702180000_overdue_grace_day.sql).
-- Client-facing overdue emails are a separate path (enqueue_payment_reminders,
-- to the client's address) and are intentionally left untouched.

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

-- ROLLBACK: re-add the admin disjunct to the recipients CTE, i.e. change
--   `and exists (` back to `and (p.is_admin or exists (` (and close the extra
--   paren) to restore admin + accounting recipients, matching the live def in
--   20260702180000_overdue_grace_day.sql.
