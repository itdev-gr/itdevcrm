-- Global rule: never email a client whose engagement is closed.
--
-- Today's 06:00 UTC accounting cron sent payment reminders to 2 clients whose
-- status was already 'done' (closed relationship). This migration enforces
-- the rule in two layers:
--
--   1. `send-email` edge function (deployed as v41, verify_jwt=false): before
--      dispatching to Resend, look up the recipient email against clients.
--      If any row matches status='done', log status='failed' with reason
--      "blocked: client closed (status=done)" and skip the send. The
--      `internal` identity is exempt because it targets staff distribution
--      lists (noreply@) rather than client mailboxes.
--
--   2. `enqueue_payment_reminders` cron: the same rule at enqueue time, so
--      the row never even lands in the outbox. This SQL side of the migration
--      adds the `c.status <> 'done'` join filter on top of the earlier
--      stage-gate + no-back-dated + not-paid guards from
--      20260701020000_payment_reminders_stage_gate.sql and
--      20260701030000_payment_reminders_no_backdated.sql.
--
-- Why the edge-function layer matters too: closing a client is often the last
-- step in a lifecycle where several enqueue paths (welcome, contract, custom
-- ad-hoc) can still fire. The edge-function chokepoint catches them all
-- without needing a filter per enqueuer.

create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false
      join public.pipeline_stages ps
                        on ps.id = d.accounting_stage_id
                       and ps.board = 'accounting_onboarding'
                       and ps.code in ('invoice_issued','awaiting_payment',
                                       'partial_payment','paid_in_full','on_hold')
      join public.clients c on c.id = d.client_id
                           and c.status <> 'done'
     where dp.status in ('pending', 'overdue')
       and dp.paid_at is null
       and dp.created_at::date < dp.start_date
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 7, current_date - 1, current_date - 7)
  loop
    if r.due_date = current_date + 7 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date - 1 then
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    else
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
                               'service_type', r.service_type, 'amount_gross', r.amount_gross,
                               'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
--   -- 1. Revert enqueue_payment_reminders to drop the `c.status <> 'done'`
--   --    filter (keeping the 20260701030000 back-date guard):
--   create or replace function public.enqueue_payment_reminders() returns int
--   language plpgsql security definer set search_path = public as $$
--   declare r record; tkey text; dkey text; prefix text; created int := 0;
--   begin
--     for r in
--       select dp.id as payment_id, dp.service_type, dp.amount_gross,
--              dp.start_date as due_date, dp.deal_id, d.code as deal_code,
--              c.name as client_name, c.email as to_email
--         from public.deal_payments dp
--         join public.deals d on d.id = dp.deal_id
--                            and d.archived = false
--                            and d.suppress_payment_reminders = false
--         join public.pipeline_stages ps
--                           on ps.id = d.accounting_stage_id
--                          and ps.board = 'accounting_onboarding'
--                          and ps.code in ('invoice_issued','awaiting_payment',
--                                          'partial_payment','paid_in_full','on_hold')
--         join public.clients c on c.id = d.client_id
--        where dp.status in ('pending','overdue')
--          and dp.paid_at is null
--          and dp.created_at::date < dp.start_date
--          and c.email is not null and c.email <> ''
--          and dp.start_date in (current_date + 7, current_date - 1, current_date - 7)
--     loop ... end loop; return created; end $$;
--   -- 2. Redeploy send-email at v40 (drop the closed-client block in sendOne).
