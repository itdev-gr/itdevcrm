-- 2026-07-03: Fix stale job period_due_date on renewal cards.
-- recompute_job_period_dates derived the due date from the newest PAID payment
-- LINKED to the job via deal_payment_lines, only falling back to deal+service
-- matching when the job had ZERO linked paid payments. The recurring generator
-- links a new period's line to the first job of the service (by created_at),
-- which can be a sibling job -- so a renewal job's due date froze one period back
-- even though the client had paid the newer period (14 jobs showed a past due
-- date while paid up). Fix: one query taking the newest paid payment matched by
-- EITHER the deal+service_type OR a line to the job. Body is the live prod def
-- with only that select block changed.

CREATE OR REPLACE FUNCTION public.recompute_job_period_dates(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent uuid;
  v_start  date;
  v_due    date;
begin
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

  -- Newest PAID payment for this job: either explicitly line-linked to the job,
  -- OR matching the job's deal + service_type. A single query (not primary-then-
  -- fallback) so a newer service-matched paid period wins even when an OLDER
  -- payment carries the deal_payment_line. Recurring renewals link the new
  -- period's line to the first job of the service by created_at, which may be a
  -- sibling job — under the old two-step logic that froze this job's due date one
  -- period back even though the client had paid the newer period.
  select dp.start_date, dp.end_date into v_start, v_due
    from public.deal_payments dp
    join public.jobs j on j.id = p_job_id
   where dp.deal_id = j.deal_id
     and dp.status = 'paid'
     and (
          dp.service_type = j.service_type
       or exists (select 1 from public.deal_payment_lines dpl
                   where dpl.payment_id = dp.id and dpl.job_id = p_job_id)
     )
   order by dp.end_date desc, dp.start_date desc
   limit 1;

  -- Collapse start=end (one_time convention) to NULL due — the payment period
  -- IS a single day, so no meaningful "Due" exists.
  if v_due is not null and v_due = v_start then
    v_due := null;
  end if;

  update public.jobs
     set period_start_date = v_start,
         period_due_date   = v_due,
         updated_at        = now()
   where id = p_job_id
     and (period_start_date is distinct from v_start
       or period_due_date   is distinct from v_due);
end $function$;

-- ROLLBACK: restore the two-step (linked-line primary, then deal+service fallback)
--   select block from the pre-fix live def captured 2026-07-03.
