-- Payment reminders were firing for deals in pre-invoice and terminal accounting
-- stages (New / Documents Verified / Closed / Done / Refunded), because
-- enqueue_payment_reminders() only gated on deals.archived + suppress_payment_reminders
-- and never looked at accounting_stage. Live audit found 3 reminders already sent to
-- New-stage deals + 22 to Closed + 3 to Done + 7 with no accounting_stage_id.
-- Restrict to the invoiced+ whitelist: invoice_issued, awaiting_payment,
-- partial_payment, paid_in_full, on_hold. Any other stage (or missing stage) is skipped.

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
     where dp.status in ('pending', 'overdue')
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

-- Cancel any pending / sending payment-reminder rows already queued for deals
-- that are now out-of-scope (pre-invoice or terminal). Uses the same "cancelled
-- by admin" pattern as email_outbox_cancel(). A snapshot table records what
-- was cancelled so the change is reversible.
create table if not exists public.email_outbox_stage_gate_backup_20260701 (
  id uuid primary key,
  prior_status text not null,
  prior_last_error text,
  cancelled_at timestamptz not null default now()
);

insert into public.email_outbox_stage_gate_backup_20260701 (id, prior_status, prior_last_error)
select o.id, o.status, o.last_error
  from public.email_outbox o
  left join public.deals d on d.id = (o.data->>'deal_id')::uuid
  left join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where o.template_key in ('payment_due_soon','payment_overdue','payment_final_notice')
   and o.status in ('pending','sending')
   and (
     d.id is null
     or d.archived = true
     or ps.id is null
     or ps.code not in ('invoice_issued','awaiting_payment','partial_payment','paid_in_full','on_hold')
   )
on conflict (id) do nothing;

update public.email_outbox
   set status = 'failed',
       last_error = 'cancelled by stage-gate fix 20260701'
 where id in (select id from public.email_outbox_stage_gate_backup_20260701);

-- ROLLBACK:
--   -- 1. Restore the reminder-enqueuer to the 20260626000004 version (removes
--   --    the pipeline_stages join).
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
--         join public.clients c on c.id = d.client_id
--        where dp.status in ('pending','overdue')
--          and c.email is not null and c.email <> ''
--          and dp.start_date in (current_date + 7, current_date - 1, current_date - 7)
--     loop
--       if r.due_date = current_date + 7 then tkey := 'payment_due_soon'; prefix := 'pay_soon';
--       elsif r.due_date = current_date - 1 then tkey := 'payment_overdue'; prefix := 'pay_overdue';
--       else tkey := 'payment_final_notice'; prefix := 'pay_final'; end if;
--       dkey := prefix || ':' || r.payment_id;
--       if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then continue; end if;
--       if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then continue; end if;
--       insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
--       values ('accounting', r.to_email, tkey,
--               jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
--                                  'service_type', r.service_type, 'amount_gross', r.amount_gross,
--                                  'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
--               dkey);
--       created := created + 1;
--     end loop;
--     return created;
--   end $$;
--   -- 2. Restore any outbox rows this migration cancelled:
--   update public.email_outbox o
--      set status = b.prior_status, last_error = b.prior_last_error
--     from public.email_outbox_stage_gate_backup_20260701 b
--    where o.id = b.id
--      and o.status = 'failed'
--      and o.last_error = 'cancelled by stage-gate fix 20260701';
--   drop table if exists public.email_outbox_stage_gate_backup_20260701;
