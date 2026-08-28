-- =============================================================================
-- 2026-08-28: offers.pdf_generated_at — freshness stamp for the stored PDF.
-- api/offer-view.ts (the public /o/<token> link) regenerates the PDF on the
-- fly when this is NULL or older than the latest edit of an offer_svc_*
-- template used by the offer, so already-sent links self-heal after copy
-- changes (and after a failed generation at compose time). Stamped by the
-- shared generation core (api/_offer-pdf-core.ts) on every render.
-- Existing rows stay NULL on purpose: their stored PDFs predate the
-- service-description feature, so the first public open regenerates them.
-- =============================================================================

alter table public.offers add column pdf_generated_at timestamptz;

-- ROLLBACK: alter table public.offers drop column pdf_generated_at;
