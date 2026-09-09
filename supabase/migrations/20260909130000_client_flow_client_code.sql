-- =============================================================================
-- client_flow_for_range v2: κάθε γραμμή επιστρέφει και τον κωδικό πελάτη
-- (clients.code) — owner request 2026-09-09, οι λίστες του report πρέπει να
-- δείχνουν τον κωδικό δίπλα στο όνομα, όπως και στις άλλες λίστες.
-- Το return type αλλάζει (νέα στήλη client_code), άρα drop + recreate.
-- Λογική μετρικών ΙΔΙΑ με το 20260909120000 (ορισμοί/σκεπτικό εκεί).
-- =============================================================================

drop function if exists public.client_flow_for_range(date, date);

create function public.client_flow_for_range(p_from date, p_to date)
returns table (
  kind        text,
  client_id   uuid,
  client_name text,
  client_code text,
  deal_id     uuid,
  deal_code   text,
  event_date  date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid range % → %', p_from, p_to;
  end if;

  return query
  with ended as (
    select j.id,
           j.client_id,
           (j.completed_at at time zone 'Europe/Athens')::date as end_date
      from public.jobs j
     where j.completed_at is not null
       and (
         (j.archived and j.archived_reason in
            ('ended_by_accounting','ended_by_accounting_cascade',
             'ended_after_disconnect','ended_after_disconnect_cascade'))
         or (not j.archived and j.pending_archive_reason is not null)
         or (not j.archived and j.pending_archive_reason is null
             and not j.billing_active and j.status = 'completed'
             and j.blocked_reason is distinct from 'billing_paused')
       )
  ),
  paid as (
    select d.client_id,
           coalesce(dp.paid_at::date, dp.start_date) as pay_date
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.status = 'paid'
  )
  select 'new_deal'::text, d.client_id, c.name, c.code, d.id, d.code,
         (d.created_at at time zone 'Europe/Athens')::date
    from public.deals d
    join public.clients c on c.id = d.client_id
   where (d.created_at at time zone 'Europe/Athens')::date between p_from and p_to

  union all

  select 'stopped_client'::text, e.client_id, c.name, c.code, null::uuid, null::text,
         max(e.end_date)
    from ended e
    join public.clients c on c.id = e.client_id
   where e.end_date between p_from and p_to
     and not exists (
       select 1
         from public.jobs o
        where o.client_id = e.client_id
          and (o.created_at at time zone 'Europe/Athens')::date <= p_to
          and (
            exists (select 1 from ended oe
                     where oe.id = o.id and oe.end_date > p_to)
            or (not exists (select 1 from ended oe where oe.id = o.id)
                and o.status <> 'cancelled' and not o.archived)
          )
     )
   group by e.client_id, c.name, c.code

  union all

  select 'renewal_client'::text, p.client_id, c.name, c.code, null::uuid, null::text,
         min(p.pay_date)
    from paid p
    join public.clients c on c.id = p.client_id
   where p.pay_date between p_from and p_to
     and exists (select 1 from paid prior
                  where prior.client_id = p.client_id
                    and prior.pay_date < p_from)
   group by p.client_id, c.name, c.code;
end;
$$;

revoke all on function public.client_flow_for_range(date, date) from public, anon;
grant execute on function public.client_flow_for_range(date, date) to authenticated;

-- ROLLBACK:
-- drop function if exists public.client_flow_for_range(date, date);
-- (και επανα-εφάρμοσε το 20260909120000 για την v1 χωρίς client_code)
