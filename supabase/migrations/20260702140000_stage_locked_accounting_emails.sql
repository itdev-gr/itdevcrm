-- =========================================================================
-- 20260702140000_stage_locked_accounting_emails.sql
--
-- Every automated accounting email fires ONLY from its one correct column,
-- after the nightly board move. Sections:
--   1. enqueue_payment_reminders() — stage-locked windows (this task)
--   2. run_daily_payment_reminders() wrapper + repoint cron (Task 3)
--   3. Drop payment_due_today template (Task 4)
--   4. Cancel out-of-scope queued reminders + backup (Task 5)
--   5. Revert block (Task 6, commented)
--
-- Column locks:
--   payment_due_soon      -> awaiting_payment, today < due <= today+7
--   payment_overdue       -> on_hold,          1..6 days past due
--   payment_final_notice  -> on_hold,          >=7 days past due
-- Dedup: one row per (payment_id, template) via dedupe_key.
-- =========================================================================

-- ---- Section 1: stage-locked enqueuer ----------------------------------
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $function$
declare
  r record; tkey text; dkey text; prefix text; created int := 0; v_days_past int;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email,
           ps.code as stage_code
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false
      join public.pipeline_stages ps
                        on ps.id = d.accounting_stage_id
                       and ps.board = 'accounting_onboarding'
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending','overdue')
       and c.email is not null and c.email <> ''
  loop
    v_days_past := current_date - r.due_date;   -- >0 overdue, <0 not yet due

    if r.stage_code = 'awaiting_payment'
       and r.due_date > current_date
       and r.due_date <= current_date + 7 then
      tkey := 'payment_due_soon';     prefix := 'pay_soon';
    elsif r.stage_code = 'on_hold' and v_days_past between 1 and 6 then
      tkey := 'payment_overdue';      prefix := 'pay_overdue';
    elsif r.stage_code = 'on_hold' and v_days_past >= 7 then
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    else
      continue;   -- deal not in the required column / timing window: no email
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log   where dedupe_key = dkey and status = 'sent') then
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
end $function$;

-- ---- Section 2: nightly chain (move, then send) ------------------------
create or replace function public.run_daily_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $function$
declare v_created int;
begin
  perform public.reconcile_block_lifecycle(false);          -- 1) MOVE every deal to its column
  select public.enqueue_payment_reminders() into v_created; -- 2) THEN send, stage-locked
  return v_created;
end $function$;

-- Repoint the 06:00 cron from the bare enqueuer to the chained wrapper.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'daily_payment_reminders'),
  command => 'select public.run_daily_payment_reminders();'
);

-- ---- Section 3: drop the unwired payment_due_today template ------------
-- No trigger + no automation-settings row (audit flag F9). Back up the row, then remove it.
create table if not exists public.email_templates_dropped_backup_20260702 (like public.email_templates including all);
insert into public.email_templates_dropped_backup_20260702
select * from public.email_templates where key = 'payment_due_today'
on conflict (key) do nothing;
delete from public.email_templates where key = 'payment_due_today';

-- ---- Section 4: cancel queued reminders now in the wrong column --------
create table if not exists public.email_outbox_stagelock_backup_20260702 (
  id uuid primary key,
  prior_status text not null,
  prior_last_error text,
  cancelled_at timestamptz not null default now()
);
insert into public.email_outbox_stagelock_backup_20260702 (id, prior_status, prior_last_error)
select o.id, o.status, o.last_error
  from public.email_outbox o
  left join public.deals d on d.id = (o.data->>'deal_id')::uuid
  left join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where o.status in ('pending','sending')
   and (
     (o.template_key = 'payment_due_soon'     and coalesce(ps.code,'') <> 'awaiting_payment')
  or (o.template_key = 'payment_overdue'      and coalesce(ps.code,'') <> 'on_hold')
  or (o.template_key = 'payment_final_notice' and coalesce(ps.code,'') <> 'on_hold')
   )
on conflict (id) do nothing;
update public.email_outbox
   set status = 'failed', last_error = 'cancelled by stage-lock 20260702'
 where id in (select id from public.email_outbox_stagelock_backup_20260702);
