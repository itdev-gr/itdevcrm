-- Narrow the On Hold -> hold-jobs automation (migration 20260618000013) so it
-- only holds the three SEO services that share the Web/Local SEO boards:
-- web_seo, local_seo, ai_seo. web_dev (one-time, never blocked elsewhere),
-- hosting, social_media and ads are no longer auto-held on account On Hold.
-- Also hardened to SECURITY DEFINER so the hold/release runs regardless of who
-- moves the deal (manual board move or the overdue cron).

create or replace function public.deals_hold_jobs_on_stage_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;

  select code into new_code
    from public.pipeline_stages
   where id = new.accounting_stage_id and board = 'accounting_onboarding';

  if new_code = 'on_hold' then
    update public.jobs j
       set is_blocked = true,
           blocked_reason = 'account_on_hold',
           blocked_at = now()
      from public.pipeline_stages s
     where j.deal_id = new.id
       and j.service_type in ('web_seo', 'local_seo', 'ai_seo')
       and not j.archived
       and not j.is_blocked
       and s.id = j.stage_id
       and not s.is_terminal;
  elsif new_code is not null then
    -- Leaving On Hold releases exactly the holds this automation placed.
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null
     where deal_id = new.id
       and is_blocked = true
       and blocked_reason = 'account_on_hold';
  end if;

  return new;
end $$;

drop trigger if exists deals_hold_jobs_on_hold on public.deals;
create trigger deals_hold_jobs_on_hold
  after update on public.deals
  for each row
  when (new.accounting_stage_id is distinct from old.accounting_stage_id)
  execute function public.deals_hold_jobs_on_stage_change();

-- One-time correction: release jobs the previous (all-service) version held that
-- are now out of scope (web_dev / hosting / social_media / ads).
update public.jobs
   set is_blocked = false, blocked_reason = null, blocked_at = null
 where blocked_reason = 'account_on_hold'
   and service_type not in ('web_seo', 'local_seo', 'ai_seo')
   and not archived;

-- ROLLBACK (revert to the all-service behaviour of 20260618000013):
-- restore that migration's function body (without the service_type filter) and
-- re-run its backfill. The released jobs above are not re-held automatically.
