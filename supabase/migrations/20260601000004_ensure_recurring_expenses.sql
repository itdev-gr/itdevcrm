create or replace function public.ensure_recurring_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select e.*
      from public.expenses e
     where e.billing_type in ('recurring_monthly','recurring_yearly')
       and e.end_date is not null
       and e.end_date <= current_date + interval '7 days'
       and not exists (
         select 1 from public.expenses e2
          where coalesce(e2.parent_expense_id, e2.id)
              = coalesce(e.parent_expense_id, e.id)
            and e2.start_date >= e.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.expenses
      (category_id, vendor, billing_type, amount_net, vat_rate,
       start_date, end_date, status, notes, parent_expense_id, created_by)
      values
      (r.category_id, r.vendor, r.billing_type, r.amount_net, r.vat_rate,
       next_start, next_end, 'pending', r.notes,
       coalesce(r.parent_expense_id, r.id), r.created_by);

    created := created + 1;
  end loop;
  return created;
end $$;

grant execute on function public.ensure_recurring_expenses() to authenticated;

-- ROLLBACK:
-- drop function if exists public.ensure_recurring_expenses();
