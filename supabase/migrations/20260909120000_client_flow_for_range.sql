-- =============================================================================
-- Ροή πελατών ανά μήνα για το /accounting/report (owner request 2026-09-09):
-- για ένα διάστημα (στο UI: ένας μήνας) πόσα ΝΕΑ deals μπήκαν, πόσοι πελάτες
-- ΣΤΑΜΑΤΗΣΑΝ εντελώς, πόσοι πελάτες έκαναν RENEW (paid πληρωμή που δεν είναι
-- η πρώτη τους). Ένα RPC επιστρέφει μία γραμμή ανά οντότητα (kind-typed) ώστε
-- το UI να έχει και counts και drill-down λίστες με ένα call.
--
-- Ορισμοί (εγκεκριμένοι από owner 2026-09-09):
-- * new_deal: deals.created_at μέσα στο διάστημα, με όρια ώρας Ελλάδας.
-- * stopped_client: πελάτης με "end event" στο διάστημα που στο τέλος του
--   διαστήματος δεν είχε ΚΑΝΕΝΑ άλλο ανοιχτό job (πλήρης αποχώρηση).
-- * renewal_client: πελάτης με paid πληρωμή αποδιδόμενη στο διάστημα
--   (σύμβαση accounting_ledger_v: coalesce(paid_at::date, start_date)) ενώ
--   υπάρχει παλαιότερη paid πληρωμή του σε οποιοδήποτε deal του — δηλαδή η
--   πρώτη πληρωμή ΝΕΟΥ deal παλιού πελάτη μετράει ως renewal (per-client).
--
-- Το "end event" καλύπτει δύο εποχές του End:
-- * Νέο flow (end_and_archive_job, 20260904200000/20260908120000): archived
--   με archived_reason στην 4άδα ended* — ή, για το local_seo deferral,
--   pending_archive_reason not null πριν πατηθεί Disconnect. Ημερομηνία
--   γεγονότος = completed_at (το archived_at καθυστερεί στο deferral).
-- * Παλιό flow (end_job, τελικό σώμα 20260624060000): billing_active=false
--   + status='completed' (+completed_at), χωρίς archive. Αυτό ΔΕΝ το
--   αναπαράγουν: το drag σε closed lane (αφήνει status='active'), το
--   close_deal/backfills (δεν αγγίζουν billing_active), τα one_time
--   deliveries (τίποτα από τα δύο). Το unarchive_job σφραγίζει
--   blocked_reason='billing_paused' σε restored ended jobs, οπότε η εξαίρεση
--   "is distinct from 'billing_paused'" αυτοθεραπεύει τα restores (και
--   κόβει το σπάνιο paused-then-deal-closed). Το legacy stub archive
--   (archived_reason='accounting_archive') αποκλείεται παντού.
--
-- Γνωστές προσεγγίσεις (συνειδητά αποδεκτές):
-- * end_and_archive_job κρατά προϋπάρχον completed_at, άρα job που σύρθηκε
--   στο Closed μήνες πριν το End χρεώνει την αποχώρηση στον μήνα του drag.
-- * cancelled/άλλως archived jobs δεν έχουν αξιόπιστο "πότε" — λογίζονται
--   ως ουδέποτε ανοιχτά στο point-in-time τεστ.
-- * jobs με blocked_reason='awaiting_first_payment' μετράνε ως ανοιχτά:
--   πελάτης με φρέσκο ανεξόφλητο deal δεν είναι churned.
-- =============================================================================

create or replace function public.client_flow_for_range(p_from date, p_to date)
returns table (
  kind        text,
  client_id   uuid,
  client_name text,
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
  select 'new_deal'::text, d.client_id, c.name, d.id, d.code,
         (d.created_at at time zone 'Europe/Athens')::date
    from public.deals d
    join public.clients c on c.id = d.client_id
   where (d.created_at at time zone 'Europe/Athens')::date between p_from and p_to

  union all

  select 'stopped_client'::text, e.client_id, c.name, null::uuid, null::text,
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
   group by e.client_id, c.name

  union all

  select 'renewal_client'::text, p.client_id, c.name, null::uuid, null::text,
         min(p.pay_date)
    from paid p
    join public.clients c on c.id = p.client_id
   where p.pay_date between p_from and p_to
     and exists (select 1 from paid prior
                  where prior.client_id = p.client_id
                    and prior.pay_date < p_from)
   group by p.client_id, c.name;
end;
$$;

revoke all on function public.client_flow_for_range(date, date) from public, anon;
grant execute on function public.client_flow_for_range(date, date) to authenticated;

-- ROLLBACK:
-- drop function if exists public.client_flow_for_range(date, date);
