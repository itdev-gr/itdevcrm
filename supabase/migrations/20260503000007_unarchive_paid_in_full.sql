-- Paid In Full was originally seeded archived=true because complete_accounting
-- moved deals out of view. We now keep paid deals visible on the board, so the
-- column itself must show.

update public.pipeline_stages
  set archived = false
  where board = 'accounting_onboarding' and code = 'paid_in_full';
