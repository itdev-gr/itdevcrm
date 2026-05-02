-- =============================================================================
-- Phase 5 migration: recurring billing RPCs + daily overdue job
-- =============================================================================

-- ---------------------------------------------------------------------------
-- generate_monthly_invoices(period) — manual, idempotent
-- For every client with at least one active recurring job, insert one
-- monthly_invoices row + one monthly_invoice_items row per job (if not exists).
-- ---------------------------------------------------------------------------
create or replace function public.generate_monthly_invoices(target_period text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  client_record record;
  job_record record;
  invoice_id uuid;
  total numeric(12,2);
  item_count int;
  generated_count int := 0;
  due_offset_days int := 14;
  due date;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_recurring', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if target_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_period_format']);
  end if;

  due := (target_period || '-01')::date + (due_offset_days * interval '1 day');

  -- For each client with active recurring jobs (and not blocked? — block doesn't suspend invoicing)
  for client_record in
    select distinct j.client_id
    from public.jobs j
    where j.archived = false
      and j.status = 'active'
      and j.billing_type = 'recurring_monthly'
  loop
    -- Skip if invoice already exists for this client+period
    if exists (
      select 1 from public.monthly_invoices
      where client_id = client_record.client_id and period = target_period
    ) then
      continue;
    end if;

    total := 0;
    item_count := 0;

    -- Create the invoice row first to get an id
    insert into public.monthly_invoices (
      client_id, period, due_date, subtotal, total_amount, status
    ) values (
      client_record.client_id, target_period, due, 0, 0, 'pending'
    ) returning id into invoice_id;

    -- Add one item per active recurring job for this client
    for job_record in
      select id, service_type, monthly_amount
      from public.jobs
      where client_id = client_record.client_id
        and archived = false
        and status = 'active'
        and billing_type = 'recurring_monthly'
        and monthly_amount is not null
        and monthly_amount > 0
    loop
      insert into public.monthly_invoice_items (
        invoice_id, job_id, service_type, amount, description
      ) values (
        invoice_id, job_record.id, job_record.service_type,
        job_record.monthly_amount,
        job_record.service_type || ' — ' || target_period
      );
      total := total + job_record.monthly_amount;
      item_count := item_count + 1;
    end loop;

    if item_count = 0 then
      -- No billable items — delete the empty invoice
      delete from public.monthly_invoices where id = invoice_id;
    else
      update public.monthly_invoices
        set subtotal = total, total_amount = total
        where id = invoice_id;
      generated_count := generated_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'period', target_period, 'invoices_generated', generated_count);
end $$;

grant execute on function public.generate_monthly_invoices(text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_overdue_invoices() — flips status='overdue' on past-due unpaid invoices
-- ---------------------------------------------------------------------------
create or replace function public.mark_overdue_invoices()
returns int
language plpgsql security definer set search_path = public as $$
declare
  flipped int;
begin
  update public.monthly_invoices
    set status = 'overdue'
    where archived = false
      and status in ('pending', 'partial')
      and due_date < current_date;
  get diagnostics flipped = row_count;
  return flipped;
end $$;

grant execute on function public.mark_overdue_invoices() to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron: schedule mark_overdue_invoices() daily at 02:00 UTC
-- (Supabase Pro has pg_cron pre-installed; the cron schema is `cron`.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'daily_mark_overdue_invoices',
      '0 2 * * *',
      $cron$ select public.mark_overdue_invoices(); $cron$
    );
  end if;
end $$;
