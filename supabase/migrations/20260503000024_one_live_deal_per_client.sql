-- =============================================================================
-- Enforce one-live-deal-per-client. The CRM treats the deal as the canonical
-- working record (services, payments, accounting stage), so a client should
-- never have two non-archived deals at the same time.
--
-- A partial unique index lets archived deals stay (history) while blocking
-- a second simultaneously-active row.
-- =============================================================================

create unique index if not exists deals_one_live_per_client
  on public.deals (client_id)
  where archived = false;
