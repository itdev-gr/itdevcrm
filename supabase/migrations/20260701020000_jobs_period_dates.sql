-- =============================================================================
-- Jobs get period_start_date + period_due_date, derived from the most recent
-- PAID deal_payments row for the job. On renewal (customer pays for the next
-- recurring period), the trigger recomputes the two dates so the kanban card
-- and the Overview panel always reflect the paid coverage extent.
--
-- Design notes:
--   1. period_start_date / period_due_date are DERIVED. The trigger writes
--      them; the client never does. Client-side edits will drift and be
--      overwritten by the next payment transition. This is intentional.
--   2. AI SEO parent (billing_only, service_type='ai_seo', billing_active=true)
--      owns the billing rows. Its web/local children (parent_job_id NOT NULL,
--      billing_active=false) have NO payment lines. Children inherit the
--      parent's dates via recompute_deal_job_period_dates().
--   3. Recompute happens at 4 points (full write-surface coverage):
--        a) AFTER INSERT / UPDATE on deal_payments (status flips to/from
--           'paid', or a paid row's dates change).
--        b) AFTER DELETE on deal_payments (drop of a paid row).
--        c) AFTER INSERT on deal_payment_lines (new link).
--        d) AFTER DELETE on deal_payment_lines (removed link).
--   4. Ended / archived jobs are still recomputed (their dates freeze naturally
--      once no more payments arrive).
--   5. No trigger loop possible: helpers write to jobs, all triggers watch
--      deal_payments / deal_payment_lines. No jobs trigger cascades back.
-- =============================================================================

-- 1. Columns.
alter table public.jobs
  add column if not exists period_start_date date,
  add column if not exists period_due_date   date;

-- 2. Helpers.
create or replace function public.recompute_job_period_dates(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_parent uuid;
  v_start  date;
  v_due    date;
begin
  -- If this job is an AI SEO child (parent_job_id set), inherit parent's dates.
  select parent_job_id into v_parent from public.jobs where id = p_job_id;
  if v_parent is not null then
    select period_start_date, period_due_date into v_start, v_due
      from public.jobs where id = v_parent;
    update public.jobs
       set period_start_date = v_start,
           period_due_date   = v_due,
           updated_at        = now()
     where id = p_job_id
       and (period_start_date is distinct from v_start
         or period_due_date   is distinct from v_due);
    return;
  end if;

  -- Regular job: derive from the most recent PAID deal_payments row linked
  -- via deal_payment_lines. If no line links exist for the job yet, fall back
  -- to matching on (deal_id, service_type) — this covers pre-lines legacy rows
  -- and any transient window before the seed function backfills the line.
  select dp.start_date, dp.end_date into v_start, v_due
    from public.deal_payments dp
    join public.deal_payment_lines dpl on dpl.payment_id = dp.id
   where dpl.job_id = p_job_id
     and dp.status = 'paid'
   order by dp.end_date desc, dp.start_date desc
   limit 1;

  if v_start is null then
    select dp.start_date, dp.end_date into v_start, v_due
      from public.deal_payments dp
      join public.jobs j on j.deal_id = dp.deal_id and j.service_type = dp.service_type
     where j.id = p_job_id
       and dp.status = 'paid'
     order by dp.end_date desc, dp.start_date desc
     limit 1;
  end if;

  update public.jobs
     set period_start_date = v_start,
         period_due_date   = v_due,
         updated_at        = now()
   where id = p_job_id
     and (period_start_date is distinct from v_start
       or period_due_date   is distinct from v_due);
end $$;

grant execute on function public.recompute_job_period_dates(uuid) to authenticated;

create or replace function public.recompute_deal_job_period_dates(p_deal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  j record;
begin
  -- First pass: parents + solo jobs (parent_job_id IS NULL).
  for j in
    select id from public.jobs
     where deal_id = p_deal_id and not archived and parent_job_id is null
  loop
    perform public.recompute_job_period_dates(j.id);
  end loop;
  -- Second pass: children (they inherit from parent — parent's row must be up
  -- to date first).
  for j in
    select id from public.jobs
     where deal_id = p_deal_id and not archived and parent_job_id is not null
  loop
    perform public.recompute_job_period_dates(j.id);
  end loop;
end $$;

grant execute on function public.recompute_deal_job_period_dates(uuid) to authenticated;

-- 3. Triggers.
create or replace function public.deal_payments_recompute_job_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'paid' then
      perform public.recompute_deal_job_period_dates(NEW.deal_id);
    end if;
    return NEW;
  end if;

  if (OLD.status is distinct from NEW.status
        and (OLD.status = 'paid' or NEW.status = 'paid'))
     or (NEW.status = 'paid'
         and (OLD.start_date is distinct from NEW.start_date
              or OLD.end_date is distinct from NEW.end_date))
  then
    perform public.recompute_deal_job_period_dates(NEW.deal_id);
  end if;
  return NEW;
end $$;

drop trigger if exists deal_payments_recompute_job_dates_trg on public.deal_payments;
create trigger deal_payments_recompute_job_dates_trg
  after insert or update on public.deal_payments
  for each row execute function public.deal_payments_recompute_job_dates();

create or replace function public.deal_payments_recompute_on_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if OLD.status = 'paid' then
    perform public.recompute_deal_job_period_dates(OLD.deal_id);
  end if;
  return OLD;
end $$;

drop trigger if exists deal_payments_recompute_on_delete_trg on public.deal_payments;
create trigger deal_payments_recompute_on_delete_trg
  after delete on public.deal_payments
  for each row execute function public.deal_payments_recompute_on_delete();

create or replace function public.deal_payment_lines_recompute_job_dates()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if NEW.job_id is not null then
    perform public.recompute_job_period_dates(NEW.job_id);
  end if;
  return NEW;
end $$;

drop trigger if exists deal_payment_lines_recompute_job_dates_trg on public.deal_payment_lines;
create trigger deal_payment_lines_recompute_job_dates_trg
  after insert on public.deal_payment_lines
  for each row execute function public.deal_payment_lines_recompute_job_dates();

create or replace function public.deal_payment_lines_recompute_on_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if OLD.job_id is not null then
    perform public.recompute_job_period_dates(OLD.job_id);
  end if;
  return OLD;
end $$;

drop trigger if exists deal_payment_lines_recompute_on_delete_trg on public.deal_payment_lines;
create trigger deal_payment_lines_recompute_on_delete_trg
  after delete on public.deal_payment_lines
  for each row execute function public.deal_payment_lines_recompute_on_delete();

-- 4. One-time backfill: walk every deal with any paid rows.
do $$
declare d record;
begin
  for d in
    select distinct deal_id from public.deal_payments where status = 'paid'
  loop
    perform public.recompute_deal_job_period_dates(d.deal_id);
  end loop;
end $$;

-- =============================================================================
-- CHANGES / REVERT
--   + jobs.period_start_date date
--   + jobs.period_due_date   date
--   + public.recompute_job_period_dates(uuid)
--   + public.recompute_deal_job_period_dates(uuid)
--   + trigger deal_payments_recompute_job_dates_trg (INSERT/UPDATE)
--   + trigger deal_payments_recompute_on_delete_trg (DELETE)
--   + trigger deal_payment_lines_recompute_job_dates_trg (INSERT)
--   + trigger deal_payment_lines_recompute_on_delete_trg (DELETE)
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_recompute_job_dates_trg      on public.deal_payments;
--   drop trigger if exists deal_payments_recompute_on_delete_trg      on public.deal_payments;
--   drop trigger if exists deal_payment_lines_recompute_job_dates_trg on public.deal_payment_lines;
--   drop trigger if exists deal_payment_lines_recompute_on_delete_trg on public.deal_payment_lines;
--   drop function if exists public.deal_payments_recompute_job_dates();
--   drop function if exists public.deal_payments_recompute_on_delete();
--   drop function if exists public.deal_payment_lines_recompute_job_dates();
--   drop function if exists public.deal_payment_lines_recompute_on_delete();
--   drop function if exists public.recompute_deal_job_period_dates(uuid);
--   drop function if exists public.recompute_job_period_dates(uuid);
--   alter table public.jobs drop column if exists period_start_date;
--   alter table public.jobs drop column if exists period_due_date;
-- =============================================================================
