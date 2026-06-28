-- =============================================================================
-- Audit M9: release_deal_jobs left `partial_payment_pending` blocks stranded on
-- hosting / AI-SEO-parent jobs when a deal reached Paid-In-Full via the board
-- drag / lifecycle trigger (it cleared that reason only for web_seo/local_seo/
-- ads/social_media; for other services it cleared only `account_on_hold`).
-- 0 live victims at audit time, but a latent gap. Fix: the second UPDATE now
-- also clears `partial_payment_pending`. Matches the live function otherwise.
-- =============================================================================

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- SEO / ads / social: unblock and move to their renewal lane (non-terminal only).
  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         stage_id = coalesce((select rs.id from public.pipeline_stages rs
                               where rs.board = j.service_type and rs.code = 'renewal' and not rs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo','ads','social_media')
     and cur.id = j.stage_id and not cur.is_terminal;

  -- Everything else (hosting, ai_seo parent, …): clear BOTH block reasons.
  update public.jobs
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
   where deal_id = p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;

-- =============================================================================
-- CHANGES / REVERT
--   release_deal_jobs(): second UPDATE reason filter
--     'account_on_hold' -> in ('account_on_hold','partial_payment_pending').
-- ROLLBACK: restore the prior body (second UPDATE filters blocked_reason='account_on_hold' only).
-- =============================================================================
