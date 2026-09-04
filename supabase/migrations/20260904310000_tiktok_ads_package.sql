-- =============================================================================
-- 2026-09-04 (owner: «βάλε και τα tiktok ads»): TikTok Ads joins the service
-- catalogue.
--
-- It was already being sold — job 000126-ADS, «Tik tok ads», one-off €150 — but
-- it had no catalogue row, so it could not be picked in the offer builder or in
-- the new ads-type field on Add job, and its name had to be typed by hand.
--
-- €150/month, chosen by the owner (same as ChatGPT Ads, and the same figure as
-- the one job sold so far). One-time amount stays 0, like every other ads
-- package: an ads line is priced per month, and Add job leaves a typed one-off
-- amount alone precisely because these are 0.
--
-- Idempotent: service_packages has a unique key on (service_type, code).
-- =============================================================================

insert into public.service_packages
  (service_type, code, display_names, description,
   default_one_time_amount, default_monthly_amount, setup_fee, sort_order, is_active)
values
  ('ads', 'ads-tiktok-ads',
   '{"en": "TikTok Ads", "el": "TikTok Ads"}'::jsonb,
   'Διαχείριση και βελτιστοποίηση διαφημίσεων TikTok.',
   0, 150, 0, 50, true)
on conflict (service_type, code) do nothing;

-- ROLLBACK:
--   delete from public.service_packages
--    where service_type = 'ads' and code = 'ads-tiktok-ads';
--   -- (refuses if an offer already references it; archive it instead:
--   --  update public.service_packages set archived = true where code = 'ads-tiktok-ads';)
