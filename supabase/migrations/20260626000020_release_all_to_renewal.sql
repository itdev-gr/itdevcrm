-- On payment (deal -> paid_in_full) move EVERY non-terminal renewable job to its board's
-- Renewal lane, clearing any block. Non-renewable jobs (web_dev/hosting/ai_seo parent) are
-- only unblocked, never moved.
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         stage_id = coalesce((select rs.id from public.pipeline_stages rs
                               where rs.board = j.service_type and rs.code = 'renewal' and not rs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo','ads','social_media')
     and cur.id = j.stage_id and not cur.is_terminal;

  update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
   where deal_id = p_deal_id and is_blocked and blocked_reason = 'account_on_hold' and not archived
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;

-- ROLLBACK: restore release_deal_jobs from 20260626000014 (only moved blocked jobs to renewal).
