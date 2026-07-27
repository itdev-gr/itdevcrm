-- =============================================================================
-- SEO Done -> Renewal on the next PAID cycle (owner decision 2026-07-27).
--
-- Case (deal 000270, AI SEO): the SEO teams drag a recurring SEO card to Done
-- when the month's work is finished. When the client pays the NEXT month, the
-- card must come back to Renewal — Done is a per-cycle resting column for
-- recurring SEO work, not an end state ('closed' is the end state; end_job and
-- close_deal use it / stop billing, so ended jobs are never resurrected here).
--
-- Until now release_deal_jobs branch 1c skipped every terminal stage
-- (`not cur.is_terminal`), so a Done card stayed in Done forever even though
-- the client kept paying (000270-AISEOLOC / -AISEOWEB, Done since 07-07,
-- AI SEO paid through 22/08).
--
-- Change:
--   1) jobs.done_at (timestamptz, null) + BEFORE UPDATE trigger stamp: entering
--      a stage with code 'done' sets done_at=now(); leaving it clears it.
--      No backfill: legacy Done cards have done_at NULL, which the guard treats
--      as "pull allowed" — deliberate, so long-stuck cards (000270) recover on
--      their deal's next Fully-Paid entry.
--   2) release_deal_jobs branch 1c: the terminal-stage skip gains ONE exception —
--      a stage with code 'done' when the paid period started AFTER the card was
--      placed in Done (period_start_date > done_at::date, or done_at is null).
--      Same-cycle accountant corrections (unpay/repay, amount edits) keep
--      period_start_date <= done_at, so freshly-finished cards STAY in Done —
--      preserving the 2026-07-06 anti-bounce behavior. 'closed'/'suspended'/
--      'verification' remain fully sticky. Branches 1a/1b/2/3 byte-identical to
--      20260716190000 (drift rule: read live pg_get_functiondef before applying).
--
-- Scope: web_seo/local_seo only (incl. AI SEO children — they are real
-- web_seo/local_seo rows). Ads/social branch 2 unchanged (owner may extend later;
-- it lacks a cycle guard, so a Done-pull there would fire on ANY deal re-entry).
--
-- ROLLBACK:
--   * restore release_deal_jobs from 20260716190000_one_time_seo_onboarding_parity.sql
--     (drift-check live def first);
--   * drop trigger if exists jobs_stamp_done_at on public.jobs;
--     drop function if exists public.jobs_stamp_done_at();
--     alter table public.jobs drop column if exists done_at;
-- =============================================================================

alter table public.jobs add column if not exists done_at timestamptz;

create or replace function public.jobs_stamp_done_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_done boolean;
  v_old_done boolean;
begin
  if new.stage_id is distinct from old.stage_id then
    v_new_done := exists (select 1 from public.pipeline_stages s
                           where s.id = new.stage_id and s.code = 'done');
    v_old_done := exists (select 1 from public.pipeline_stages s
                           where s.id = old.stage_id and s.code = 'done');
    if v_new_done then
      new.done_at := now();
    elsif v_old_done then
      new.done_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_stamp_done_at on public.jobs;
create trigger jobs_stamp_done_at
  before update on public.jobs
  for each row execute function public.jobs_stamp_done_at();

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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

  -- (1c) SEO onboarded in a PRIOR CYCLE -> Renewal + unblock.
  --      Cycle-aware guard: only when the paid period advanced past onboarding
  --      (+14d tolerance absorbs same-cycle payment re-dating).
  --      2026-07-27: Done is NOT sticky for recurring SEO — a card parked in
  --      Done returns to Renewal once a period PAID AFTER the Done move starts
  --      (done_at null = legacy card, pull allowed). Other terminal stages
  --      (closed/suspended/verification) stay sticky.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is not null
     and j.period_start_date is not null
     and j.period_start_date > (j.onboarded_at + interval '14 days')::date
     and cur.id=j.stage_id
     and ( not cur.is_terminal
           or (cur.code = 'done'
               and (j.done_at is null or j.period_start_date > j.done_at::date)) );

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

  -- (2) ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('ads','social_media')
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;
