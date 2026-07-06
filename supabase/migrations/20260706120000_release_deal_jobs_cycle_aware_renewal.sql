-- =============================================================================
-- release_deal_jobs: make the Renewal move CYCLE-aware, not CALL-aware.
--
-- Bug: branch 1c moved any onboarded recurring SEO job to Renewal on EVERY
-- re-entry into Fully-Paid. Accountant flows (edit amount -> unpay -> repay,
-- On-Hold trips) re-fire deals_hold_jobs_on_stage_change within the FIRST
-- billing cycle, bouncing brand-new projects out of New project into Renewal
-- minutes after onboarding (e.g. deals 004816 / 005548 / 000045, 2026-06/07).
--
-- Fix: 1c only treats a job as renewing when its paid billing period actually
-- advanced past onboarding: period_start_date (derived from paid payments by
-- the period-dates triggers) must be > onboarded_at + 14 days. Same-cycle
-- corrections keep period_start_date at/near the onboarding date -> skipped;
-- a genuine next cycle starts ~1 month later -> moved to Renewal as designed.
-- NULL period_start_date (dates cleared mid-edit) counts as NOT a renewal.
--
-- Everything else (1a/1b onboarding, branch 2 one-time SEO/ads/social renewal
-- move, branch 3 unblock) is byte-identical to the live 2026-06-29 body
-- (drift-checked via pg_get_functiondef on 2026-07-06).
--
-- ROLLBACK (manual): re-apply 20260629100000_recurring_seo_first_paid_onboarding.sql
-- section 3 (the previous release_deal_jobs body — identical minus the two
-- period_start_date guard lines in 1c).
-- =============================================================================

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Fail loud (never silent): SEO boards must have their New project stage.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- IMPORTANT ORDERING: the renewal move (1c) runs FIRST, before the onboarding
  -- branches (1a/1b). 1a/1b set onboarded_at=now() in this call; if 1c ran after
  -- them it would immediately match those just-onboarded rows (onboarded_at not null)
  -- and bounce them out of New project into Renewal in the same call. Running 1c first
  -- means it only ever sees rows onboarded in a PRIOR call.

  -- (1c) recurring SEO, onboarded in a PRIOR CYCLE -> Renewal (non-terminal) + unblock.
  --      Cycle-aware guard: only when the paid period advanced past onboarding
  --      (+14d tolerance absorbs same-cycle payment re-dating). Same-cycle
  --      Fully-Paid re-entries (amount edits, unpay/repay) leave the job alone.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and j.period_start_date is not null
     and j.period_start_date > (j.onboarded_at + interval '14 days')::date
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (1a) recurring SEO, never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email. Fixes the direct-drag gap.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) recurring SEO, never onboarded, already on a board -> mark + unblock; leave in place.
  --      (Placed earlier by complete_accounting / partial / ai_seo child; email already fired.)
  --      Kills the bounce-to-Renewal on first paid.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is not null;

  -- (2) UNCHANGED renewal-move: one-time SEO + all ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and ( (j.service_type in ('web_seo','local_seo') and j.billing_type='one_time')
           or j.service_type in ('ads','social_media') )
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $function$;
