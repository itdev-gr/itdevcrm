-- =============================================================================
-- 2026-07-13: Defensive invariant — an already-onboarded standalone SEO job is
-- never (re)placed at its board's New project stage, and is never silently
-- taken off-board. Enforced at the row level so it holds regardless of which
-- code path (release_*, reconcile_offboard_jobs cron, a one-off bulk op, or the
-- AI-SEO re-derivation) attempts the change.
--
-- WHY (root-cause investigation 2026-07-13, reproduced on throwaway demo deals):
--   * The accounting "Done" move does NOT reset a job — verified: the accounting
--     stage-change trigger only UNBLOCKS on 'done'; reconcile_deal_stage no-ops
--     at 'done'. The reported symptom is not caused by the Done move.
--   * Behavioural test matrix: a local_seo/web_seo job lands on new_project ONLY
--     when its stage_id is NULL at placement time. On-board jobs (stage set) are
--     never moved by the release logic — whether onboarded or not.
--   * So the true defect is upstream: some path NULLs an onboarded job's stage
--     (observed SYSTEM batch 2026-07-06 13:44:52 reset 004816/000045/005548
--     renewal->new_project and re-fired 3 onboarding emails). Once off-board, the
--     standing placement (release_* / the 15-min reconcile_offboard_jobs cron)
--     puts it at new_project and jobs_seo_onboarding_email re-fires.
--
-- This guard fixes the SYMPTOM safely WITHOUT rewriting the drift-prone
-- release_*/reconcile_* functions (which must be read live via pg_get_functiondef
-- before any edit). It is an ABSOLUTE invariant — no actor check — because a
-- SECURITY DEFINER release function still runs under the caller's auth.uid(), so
-- an actor gate could not distinguish an accountant's board drag from an
-- accountant-triggered automatic placement. For an already-onboarded job the
-- correct "restart" column is Renewal, not the onboarding entry column, and
-- Renewal does not trigger the onboarding access email — so redirecting is also
-- the more correct behaviour for the rare deliberate case.
--
-- Scope excludes AI-SEO children (parent_job_id not null) and billing-only
-- records, whose stage is intentionally managed/off-board by the AI-SEO split.
--
-- ROLLBACK:
--   drop trigger if exists jobs_protect_onboarded_seo_stage on public.jobs;
--   drop function if exists public.jobs_protect_onboarded_seo_stage();
-- =============================================================================

create or replace function public.jobs_protect_onboarded_seo_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_project uuid;
  v_renewal uuid;
begin
  -- Guard only standalone, already-onboarded SEO jobs.
  if old.onboarded_at is null
     or new.service_type not in ('local_seo','web_seo')
     or old.parent_job_id is not null
     or coalesce(old.billing_only, false) then
    return new;
  end if;

  -- (a) Never take an on-board onboarded job off-board via an automated write.
  if old.stage_id is not null and new.stage_id is null then
    raise warning 'protect_onboarded_seo_stage: blocked null of stage on onboarded % (job %)', new.code, new.id;
    new.stage_id := old.stage_id;
    return new;
  end if;

  -- (b) Never (re)place an onboarded job at New project -> use Renewal instead
  --     (no onboarding email, no reset to the onboarding column).
  select id into v_new_project from public.pipeline_stages
    where board = new.service_type and code = 'new_project' and not archived limit 1;
  if v_new_project is not null
     and new.stage_id = v_new_project
     and old.stage_id is distinct from new.stage_id then
    select id into v_renewal from public.pipeline_stages
      where board = new.service_type and code = 'renewal' and not archived limit 1;
    raise warning 'protect_onboarded_seo_stage: redirected new_project -> renewal on onboarded % (job %)', new.code, new.id;
    new.stage_id := coalesce(v_renewal, old.stage_id, new.stage_id);
  end if;

  return new;
end $$;

drop trigger if exists jobs_protect_onboarded_seo_stage on public.jobs;
create trigger jobs_protect_onboarded_seo_stage
  before update of stage_id on public.jobs
  for each row execute function public.jobs_protect_onboarded_seo_stage();

-- Definer function: close the default PUBLIC execute per grant-boundary rule.
revoke all on function public.jobs_protect_onboarded_seo_stage() from public, anon, authenticated;
