-- =============================================================================
-- SEO Done -> Renewal whenever a NEW cycle is PAID (owner decision 2026-07-27).
--
-- Case (deal 000270, AI SEO): the SEO teams park a recurring SEO card in Done
-- when the month's work is finished. When the client pays the NEXT month, the
-- card must return to Renewal. Done is a per-cycle resting column for
-- recurring SEO work; 'closed' is the end state (end_job / close_deal).
--
-- LIVE FINDINGS at authoring (pg_get_functiondef + pipeline_stages read
-- 2026-07-27; drift vs repo: branch 2/3 already carry 'maintenance' from
-- 20260717130000):
--   * 'done' is NOT terminal on web_seo/local_seo/ads (only 'closed' is), so
--     release_deal_jobs branch 1c ALREADY pulls Done -> Renewal ...
--   * ... but release_deal_jobs' ONLY caller is deals_hold_jobs_on_stage_change,
--     i.e. it fires solely on an accounting-stage TRANSITION into Fully Paid.
--     A deal that keeps paying on time never re-enters Fully Paid, so its Done
--     cards never return (000270: children parked 07-07, AI SEO month paid
--     22-07 while the deal was ALREADY Fully Paid -> no transition -> no pull;
--     the deal then dropped to On Hold over the ads line instead). Holds are
--     never auto-lifted (accounting_stage single-owner), so "the client paid"
--     often produces NO stage transition at all.
--
-- Change (all pieces additive):
--   1) jobs.done_at (timestamptz) + BEFORE UPDATE stamp trigger: entering a
--      stage with code 'done' sets done_at=now(); leaving it clears it. Legacy
--      Done cards keep done_at NULL = pull allowed (deliberate; heals 000270).
--   2) seo_pull_done_to_renewal(deal): the NARROW pull — web_seo/local_seo
--      (incl. AI SEO children) sitting in 'done' move to 'renewal' when the
--      paid period advanced past onboarding (+14d) AND past the Done drag
--      (period_start_date > done_at::date). Recomputes period dates first
--      (parents before children) so it never reads stale dates regardless of
--      trigger ordering. NO unblocks, NO onboarding — safe on every payment.
--   3) deal_payments trigger (INSERT or UPDATE landing on status='paid') calls
--      the pull for that deal. This is the owner's rule verbatim: paid => back
--      to Renewal, independent of accounting-stage transitions.
--   4) release_deal_jobs branch 1c gains the same done_at correction-guard so a
--      Fully-Paid RE-ENTRY (unpay/repay, hold trips) no longer yanks a card the
--      team parked in Done mid-cycle — same anti-bounce spirit as 2026-07-06.
--      Otherwise byte-identical to the live 2026-07-27 def (incl. maintenance).
--
-- Scope: web_seo/local_seo only. Ads/social/maintenance branch 2 untouched.
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_pull_done_on_paid on public.deal_payments;
--   drop function if exists public.deal_payments_pull_done_on_paid();
--   drop function if exists public.seo_pull_done_to_renewal(uuid);
--   drop trigger if exists jobs_stamp_done_at on public.jobs;
--   drop function if exists public.jobs_stamp_done_at();
--   alter table public.jobs drop column if exists done_at;
--   -- restore release_deal_jobs to the 2026-07-27 pre-image (20260716190000
--   -- body + 'maintenance' in branches 2/3); drift-check live def first.
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

-- The narrow pull. Recompute dates first (parents, then children — children
-- mirror their parent) so the guard reads fresh periods no matter which
-- deal_payments trigger fired first.
create or replace function public.seo_pull_done_to_renewal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id from public.jobs
            where deal_id = p_deal_id and not archived
            order by (parent_job_id is not null), created_at
  loop
    perform public.recompute_job_period_dates(r.id);
  end loop;

  update public.jobs j
     set stage_id = rs.id
    from public.pipeline_stages cur,
         public.pipeline_stages rs
   where j.deal_id = p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is not null
     and j.period_start_date is not null
     and j.period_start_date > (j.onboarded_at + interval '14 days')::date
     and cur.id = j.stage_id and cur.code = 'done'
     and (j.done_at is null or j.period_start_date > j.done_at::date)
     and rs.board = j.service_type and rs.code = 'renewal' and not rs.archived;
end $$;

revoke execute on function public.seo_pull_done_to_renewal(uuid) from public, anon, authenticated;

create or replace function public.deal_payments_pull_done_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform public.seo_pull_done_to_renewal(new.deal_id);
  end if;
  return new;
end $$;

drop trigger if exists deal_payments_pull_done_on_paid on public.deal_payments;
create trigger deal_payments_pull_done_on_paid
  after insert or update of status on public.deal_payments
  for each row execute function public.deal_payments_pull_done_on_paid();

-- release_deal_jobs: live 2026-07-27 body (incl. 'maintenance') with ONE change —
-- branch 1c's done correction-guard (see header #4).
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

  -- (1c) SEO onboarded in a PRIOR CYCLE -> Renewal (non-terminal) + unblock.
  --      Cycle-aware guard: only when the paid period advanced past onboarding
  --      (+14d tolerance absorbs same-cycle payment re-dating).
  --      2026-07-27: a card in 'done' additionally requires the paid period to
  --      have started AFTER the Done drag (done_at null = legacy, allowed) —
  --      Fully-Paid re-entries no longer yank freshly-finished cards.
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
     and cur.id=j.stage_id and not cur.is_terminal
     and (cur.code <> 'done' or j.done_at is null or j.period_start_date > j.done_at::date);

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
end $$;
