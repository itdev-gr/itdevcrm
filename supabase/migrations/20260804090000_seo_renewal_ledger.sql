-- =============================================================================
-- SEO Renewal ledger — record the cycle that was already renewed instead of
-- inferring it from dates.
--
-- BUG (deal 005014 "Maniatis Noe Peiraias", local_seo — read live 2026-08-04):
--     onboarded_at        2026-06-26
--     period 26/06→26/07  paid 2026-06-29   -> card moved to Renewal, team worked
--     card dragged to Done 2026-08-03 14:16 (done_at)
--     period 26/07→26/08  paid 2026-08-04 06:38
--   deal_payments_pull_done_on_paid fired correctly on that payment, but the
--   2026-07-27 guard `period_start_date > done_at::date` evaluated
--   2026-07-26 > 2026-08-03 = FALSE, so the card stayed in Done for a cycle the
--   client had paid.
--
--   That guard compares the START of the paid period against the moment the team
--   parked the card. It is false for EVERY payment that arrives after the team
--   finished the month — i.e. every late payment, which is the normal case. Same
--   failure class as the `+14 days` guard it was layered on (2026-07-06): both
--   try to infer "same cycle or next?" from dates instead of recording what
--   already happened.
--
-- FIX — jobs.renewed_for_period (date): the period_start_date the card was last
--   sent to Renewal for. Stamped by trigger on EVERY entry into a 'renewal'
--   stage (automatic move, manual drag, or force_job_renewal), so it cannot
--   drift from reality. The move condition collapses to one comparison:
--
--       period_start_date > coalesce(renewed_for_period,
--                                    (onboarded_at + 14 days)::date)
--
--   Idempotent per cycle by construction: unpay/repay, amount edits, On-Hold
--   trips, Fully-Paid re-entries and the nightly reconciler can all re-run
--   without bouncing a card twice for the same period — which is what the two
--   date heuristics were trying (and failing) to achieve. `done_at` is no longer
--   consulted; the column and its stamp trigger stay as information only.
--   The +14d term survives only as the FIRST-cycle floor (renewed_for_period is
--   null until a card first reaches Renewal), preserving the 2026-07-06
--   anti-bounce for freshly onboarded projects.
--
-- CALL SITES — were 2, now 4. The missing ones are why "the client paid" often
--   produced no move at all (release_deal_jobs only ever runs on an accounting
--   stage TRANSITION into Fully Paid; a deal that keeps paying on time never
--   re-enters it):
--     1. deal_payments -> status 'paid'      existed; was narrowed to Done cards
--     2. jobs.period_start_date changed      NEW — late or hand-fixed dates
--     3. release_deal_jobs branch 1c         existed; now shares the one mover
--     4. reconcile_seo_renewal nightly cron  NEW — safety net for every path
--
-- BACKFILL IS DELIBERATELY MOVE-NEUTRAL (owner decision 2026-08-04: no sweep):
--   every existing onboarded SEO job gets renewed_for_period = period_start_date
--   ("current cycle already renewed"), so nothing moves retroactively when this
--   migration lands. Cards stuck today (005014 is the only one matching the
--   pattern live on 2026-08-04) are moved one by one with force_job_renewal.
--
-- BOARD MOVES CAN NO LONGER BREAK A PAYMENT: enforce_no_stage_move_when_blocked
--   raises 'client_blocked' on ANY stage_id change for a blocked client, and the
--   mover now runs from payment triggers — an unguarded move would abort the
--   accountant's "mark as paid". The mover therefore wraps its UPDATE in an
--   exception block: a failed move degrades to a warning, and the nightly
--   reconciler + the seo_renewal_pending integrity alert re-surface it.
--
-- LIVE DRIFT CHECK 2026-08-04 (md5(pg_get_functiondef) == repo emissions):
--   release_deal_jobs               ba38551e560d45875a84f2af1ca634d3  = 20260727120000
--   seo_pull_done_to_renewal        c5b335b37146d90bc34bab23c6622267  = 20260727120000
--   deal_payments_pull_done_on_paid 8e5ddd603fad90a46103c39c99d80cf7  = 20260727120000
--
-- APPLIED to prod 2026-08-04, post-change md5(pg_get_functiondef):
--   release_deal_jobs               73517c7be045a77d9b83ee4de22f5e7d
--   seo_sync_renewal_job            9d45f04c2a5f1fa8dbf626ece0d929cf
--   backfill touched 383 of 398 onboarded SEO jobs (15 have no period date at
--   all — the seo_job_no_period alert in 20260804091000 lists them).
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_sync_renewal_on_paid on public.deal_payments;
--   drop function if exists public.deal_payments_sync_renewal_on_paid();
--   drop trigger if exists jobs_sync_renewal_on_period on public.jobs;
--   drop function if exists public.jobs_sync_renewal_on_period();
--   drop trigger if exists jobs_stamp_renewed_for_period on public.jobs;
--   drop function if exists public.jobs_stamp_renewed_for_period();
--   select cron.unschedule('reconcile_seo_renewal');
--   drop function if exists public.reconcile_seo_renewal();
--   drop function if exists public.force_job_renewal(uuid);
--   drop function if exists public.seo_sync_renewal(uuid);
--   drop function if exists public.seo_sync_renewal_job(uuid);
--   alter table public.jobs drop column if exists renewed_for_period;
--   re-apply 20260727120000_seo_done_to_renewal_on_paid_cycle.sql (restores
--     seo_pull_done_to_renewal, deal_payments_pull_done_on_paid and the
--     pre-change release_deal_jobs body, md5s above).
-- =============================================================================

-- 1. The ledger column ------------------------------------------------------

alter table public.jobs add column if not exists renewed_for_period date;

comment on column public.jobs.renewed_for_period is
  'period_start_date this card was last sent to Renewal for. Stamped on every entry into a renewal stage; the renewal mover only acts when the paid period is newer than this.';

-- Move-neutral backfill: treat the currently paid cycle as already renewed, so
-- landing this migration moves nothing (see header: no sweep).
update public.jobs
   set renewed_for_period = period_start_date
 where not archived
   and service_type in ('web_seo','local_seo')
   and onboarded_at is not null
   and period_start_date is not null
   and renewed_for_period is null;

-- 2. Stamp the ledger on every entry into Renewal ---------------------------
-- BEFORE UPDATE OF stage_id, and named so it sorts AFTER
-- jobs_protect_onboarded_seo_stage ('p' < 's'): that trigger can redirect
-- new_project -> renewal, and we must stamp the stage the row actually lands on.

create or replace function public.jobs_stamp_renewed_for_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage_id is distinct from old.stage_id
     and new.period_start_date is not null
     and exists (select 1 from public.pipeline_stages s
                  where s.id = new.stage_id and s.code = 'renewal') then
    new.renewed_for_period := new.period_start_date;
  end if;
  return new;
end $$;

revoke all on function public.jobs_stamp_renewed_for_period() from public, anon, authenticated;

drop trigger if exists jobs_stamp_renewed_for_period on public.jobs;
create trigger jobs_stamp_renewed_for_period
  before update of stage_id on public.jobs
  for each row execute function public.jobs_stamp_renewed_for_period();

-- 3. The single mover -------------------------------------------------------
-- Returns true only when it actually moved the card. Never recomputes period
-- dates (callers that need that use seo_sync_renewal), so it cannot re-enter the
-- period trigger in section 5.

create or replace function public.seo_sync_renewal_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  j         public.jobs;
  cur       public.pipeline_stages;
  v_renewal uuid;
begin
  select * into j from public.jobs where id = p_job_id;
  if not found
     or j.archived
     or j.service_type not in ('web_seo','local_seo')
     or j.onboarded_at is null
     or j.period_start_date is null then
    return false;
  end if;

  -- Off-board (stage null) belongs to the placement branches; terminal ('closed')
  -- belongs to close_deal / end_job. Neither is ours to override.
  select * into cur from public.pipeline_stages where id = j.stage_id;
  if not found or cur.is_terminal then
    return false;
  end if;

  -- The whole guard: has a cycle been PAID that we have not renewed for yet?
  if j.period_start_date <= coalesce(j.renewed_for_period,
                                     (j.onboarded_at + interval '14 days')::date) then
    return false;
  end if;

  select id into v_renewal from public.pipeline_stages
   where board = j.service_type and code = 'renewal' and not archived
   limit 1;
  if v_renewal is null then
    raise warning 'seo_sync_renewal_job: board % has no renewal stage (job %)',
                  j.service_type, j.code;
    return false;
  end if;

  if j.stage_id is not distinct from v_renewal then
    -- Already parked in Renewal (e.g. moved by hand before the payment landed):
    -- nothing to move, but the ledger must record the cycle.
    update public.jobs set renewed_for_period = j.period_start_date where id = p_job_id;
    return false;
  end if;

  -- A board move must never abort the write that triggered it — a payment, a
  -- date fix, a deal stage change. enforce_no_stage_move_when_blocked raises
  -- 'client_blocked' for blocked clients; degrade to a warning and let the
  -- nightly reconciler / integrity alert carry it.
  begin
    update public.jobs set stage_id = v_renewal where id = p_job_id;
  exception when others then
    raise warning 'seo_sync_renewal_job: job % not moved to renewal (%)', j.code, sqlerrm;
    return false;
  end;

  return true;
end $$;

revoke all on function public.seo_sync_renewal_job(uuid) from public, anon, authenticated;

-- 4. Deal-level entry point: fresh dates, then the mover per job ------------

create or replace function public.seo_sync_renewal(p_deal_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_moved integer := 0;
begin
  -- Parents before children (children mirror their parent's period), so the
  -- guard never reads stale dates regardless of trigger ordering.
  perform public.recompute_deal_job_period_dates(p_deal_id);

  for r in select id from public.jobs
            where deal_id = p_deal_id and not archived
              and service_type in ('web_seo','local_seo')
            order by (parent_job_id is not null), created_at
  loop
    if public.seo_sync_renewal_job(r.id) then
      v_moved := v_moved + 1;
    end if;
  end loop;

  return v_moved;
end $$;

revoke all on function public.seo_sync_renewal(uuid) from public, anon, authenticated;

-- 5. Call site 2 — period dates changed on a job ----------------------------
-- Catches the case no event covered before: the payment was already paid but its
-- dates arrived (or were corrected) later. The mover only writes stage_id /
-- renewed_for_period, neither of which is in this trigger's column list, so it
-- cannot recurse.

create or replace function public.jobs_sync_renewal_on_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.period_start_date is distinct from old.period_start_date
     and new.service_type in ('web_seo','local_seo') then
    perform public.seo_sync_renewal_job(new.id);
  end if;
  return null;
end $$;

revoke all on function public.jobs_sync_renewal_on_period() from public, anon, authenticated;

drop trigger if exists jobs_sync_renewal_on_period on public.jobs;
create trigger jobs_sync_renewal_on_period
  after update of period_start_date on public.jobs
  for each row execute function public.jobs_sync_renewal_on_period();

-- 6. Call site 1 — a payment is marked paid (replaces the Done-only pull) ----

create or replace function public.deal_payments_sync_renewal_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'paid' then
    return null;
  end if;
  -- Nested ifs, not one OR: plpgsql does not guarantee short-circuit evaluation
  -- and OLD is unassigned on INSERT.
  if tg_op = 'INSERT' then
    perform public.seo_sync_renewal(new.deal_id);
  elsif old.status is distinct from 'paid'
     or old.start_date is distinct from new.start_date
     or old.end_date   is distinct from new.end_date then
    perform public.seo_sync_renewal(new.deal_id);
  end if;
  return null;
end $$;

revoke all on function public.deal_payments_sync_renewal_on_paid() from public, anon, authenticated;

drop trigger if exists deal_payments_pull_done_on_paid on public.deal_payments;
drop function if exists public.deal_payments_pull_done_on_paid();
drop function if exists public.seo_pull_done_to_renewal(uuid);

-- Sorts after deal_payments_recompute_job_dates_trg, so dates are already fresh
-- when this runs (seo_sync_renewal recomputes anyway — the move is idempotent).
drop trigger if exists deal_payments_sync_renewal_on_paid on public.deal_payments;
create trigger deal_payments_sync_renewal_on_paid
  after insert or update on public.deal_payments
  for each row execute function public.deal_payments_sync_renewal_on_paid();

-- 7. Call site 3 — release_deal_jobs -----------------------------------------
-- Live 2026-08-04 body (md5 ba38551e560d45875a84f2af1ca634d3) with ONE change:
-- branch 1c delegates to seo_sync_renewal_job instead of carrying its own copy
-- of the date heuristics. Unblock stays scoped to the rows that actually moved,
-- exactly as the single UPDATE did. Branches 1a/1b/2/3 are byte-identical.

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  -- Fail loud (never silent): SEO boards must have their New project stage.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- IMPORTANT ORDERING: the renewal move (1c) runs FIRST, before the onboarding
  -- branches (1a/1b), so it only ever sees rows onboarded in a PRIOR call.
  -- 2026-07-16: one_time SEO onboards exactly like recurring (owner decision) —
  -- the billing_type filters were removed from 1c/1a/1b; branch 2 is ads/social only.

  -- (1c) SEO onboarded in a PRIOR CYCLE -> Renewal (non-terminal) + unblock.
  --      2026-08-04: the cycle test now lives in seo_sync_renewal_job and is
  --      ledger-driven (renewed_for_period), replacing the +14d / done_at date
  --      heuristics that silently skipped every late payment.
  for r in select j.id from public.jobs j
            where j.deal_id = p_deal_id and not j.archived
              and j.service_type in ('web_seo','local_seo')
              and j.onboarded_at is not null
  loop
    if public.seo_sync_renewal_job(r.id) then
      update public.jobs
         set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
       where id = r.id;
    end if;
  end loop;

  -- (1a) SEO never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) SEO never onboarded, already on a board -> mark + unblock; leave in place.
  --      (Placed earlier by release_jobs_for_deal / partial / ai_seo child; email
  --      already fired on that placement.)
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is not null;

  -- (2) ads/social_media/maintenance -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('ads','social_media','maintenance')
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media','maintenance');
end $function$;

-- 8. Call site 4 — nightly safety net ---------------------------------------
-- Every path that can leave a card behind (manual payment edits, imports, a
-- move that hit 'client_blocked', a trigger disabled during maintenance) is
-- re-asserted once a night. With the move-neutral backfill this is a no-op on
-- day one; it only ever acts on cycles paid after this migration.

create or replace function public.reconcile_seo_renewal()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_moved integer := 0;
begin
  for r in
    select distinct j.deal_id
      from public.jobs j
      join public.deals d on d.id = j.deal_id
      join public.pipeline_stages cur on cur.id = j.stage_id
     where not j.archived and not d.archived and not cur.is_terminal
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and j.period_start_date is not null
       and j.period_start_date > coalesce(j.renewed_for_period,
                                          (j.onboarded_at + interval '14 days')::date)
  loop
    v_moved := v_moved + public.seo_sync_renewal(r.deal_id);
  end loop;
  return v_moved;
end $$;

revoke all on function public.reconcile_seo_renewal() from public, anon, authenticated;

-- 02:40 UTC — after reconcile_block_lifecycle (02:20), whose stage moves can
-- themselves produce renewals, and clear of the 02:35 slot (auto_close_stale_tasks).
do $$ begin
  perform cron.unschedule('reconcile_seo_renewal');
exception when others then null; end $$;
select cron.schedule('reconcile_seo_renewal', '40 2 * * *',
                     $$ select public.reconcile_seo_renewal(); $$);

-- 9. Manual escape hatch -----------------------------------------------------
-- Accounting moves one card to Renewal without a board drag, on any renewable
-- board. Stamps the ledger through the section-2 trigger, so the automatic mover
-- will not act again for the same cycle.

create or replace function public.force_job_renewal(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  j         public.jobs;
  v_from    text;
  v_renewal uuid;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding','edit')) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select * into j from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0001';
  end if;
  if j.archived then
    raise exception 'job_archived' using errcode = 'P0001';
  end if;

  select id into v_renewal from public.pipeline_stages
   where board = j.service_type and code = 'renewal' and not archived
   limit 1;
  if v_renewal is null then
    raise exception 'no_renewal_stage' using errcode = 'P0001',
      hint = j.service_type;
  end if;

  select code into v_from from public.pipeline_stages where id = j.stage_id;

  update public.jobs
     set stage_id = v_renewal,
         is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
   where id = p_job_id;

  -- action is CHECK-limited to insert/update/delete; the kind goes in changes.
  insert into public.activity_log(entity_type, entity_id, action, changes, user_id, client_id)
    values ('job', p_job_id, 'update',
            jsonb_build_object('kind','forced_renewal',
                               'from', v_from,
                               'period', j.period_start_date),
            auth.uid(), j.client_id);

  select * into j from public.jobs where id = p_job_id;
  return j;
end $$;

revoke all on function public.force_job_renewal(uuid) from public, anon;
grant execute on function public.force_job_renewal(uuid) to authenticated;
