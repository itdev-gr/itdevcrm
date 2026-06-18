-- =============================================================================
-- Sync service_packages prices to the public site www.itdev.gr (June 2026).
-- Names are kept as-is; only prices change. Website "support" (credit) packages
-- are intentionally excluded (they are not part of this catalog).
--
-- All amounts are net (ex-VAT 24%), matching how the catalog stores prices.
--
-- Ads: the site's tiered Χορηγούμενες Καμπάνιες prices are mapped onto the three
-- existing ad packages in tier order (Ξεκίνημα → Services Google Ads,
-- Ανάπτυξη → Eshop Google Ads, Premium → Meta Ads), names unchanged, and the
-- one-time activation fee is recorded as setup_fee.
--
-- Applied to prod via the admin (RLS) path; this file is the tracked record.
-- Idempotent: re-running sets the same target values.
-- =============================================================================

-- Local SEO (monthly)
update public.service_packages set default_monthly_amount = 300 where service_type = 'local_seo' and code = 'local-seo-local';
update public.service_packages set default_monthly_amount = 400 where service_type = 'local_seo' and code = 'local-seo-growth';
update public.service_packages set default_monthly_amount = 700 where service_type = 'local_seo' and code = 'local-seo-premium';

-- Web SEO (monthly)
update public.service_packages set default_monthly_amount = 400 where service_type = 'web_seo' and code = 'web-seo-basic';
update public.service_packages set default_monthly_amount = 750 where service_type = 'web_seo' and code = 'web-seo-eshop';
update public.service_packages set default_monthly_amount = 950 where service_type = 'web_seo' and code = 'web-seo-enterprise';

-- Web Dev (one-time)
update public.service_packages set default_one_time_amount = 600 where service_type = 'web_dev' and code = 'web-dev-professional';

-- Ads (monthly + one-time activation as setup_fee), names unchanged
update public.service_packages set default_monthly_amount = 149, setup_fee = 150 where service_type = 'ads' and code = 'ads-google-ads';
update public.service_packages set default_monthly_amount = 179, setup_fee = 220 where service_type = 'ads' and code = 'ads-eshop-google-ads';
update public.service_packages set default_monthly_amount = 275, setup_fee = 350 where service_type = 'ads' and code = 'ads-meta-ads';

-- New website-construction package the site lists but the catalog lacked.
insert into public.service_packages
  (service_type, code, display_names, default_one_time_amount, default_monthly_amount, setup_fee, description, sort_order)
values
  ('web_dev', 'web-dev-basic', '{"en": "Basic Website", "el": "Basic Website"}'::jsonb, 1000, 0, 0, 'Up to 10 subpages / έως 10 υποσελίδες', 25)
on conflict (service_type, code) do nothing;

-- AI SEO (€400 / €600) and all six Social Media packages already match the site
-- and are left unchanged.

-- =============================================================================
-- Rollback (prior values, June 2026):
--   update public.service_packages set default_monthly_amount = 250 where service_type='local_seo' and code='local-seo-local';
--   update public.service_packages set default_monthly_amount = 349 where service_type='local_seo' and code='local-seo-growth';
--   update public.service_packages set default_monthly_amount = 650 where service_type='local_seo' and code='local-seo-premium';
--   update public.service_packages set default_monthly_amount = 350 where service_type='web_seo' and code='web-seo-basic';
--   update public.service_packages set default_monthly_amount = 650 where service_type='web_seo' and code='web-seo-eshop';
--   update public.service_packages set default_monthly_amount = 0   where service_type='web_seo' and code='web-seo-enterprise';
--   update public.service_packages set default_one_time_amount = 500 where service_type='web_dev' and code='web-dev-professional';
--   update public.service_packages set default_monthly_amount = 150, setup_fee = 0 where service_type='ads' and code='ads-google-ads';
--   update public.service_packages set default_monthly_amount = 300, setup_fee = 0 where service_type='ads' and code='ads-eshop-google-ads';
--   update public.service_packages set default_monthly_amount = 150, setup_fee = 0 where service_type='ads' and code='ads-meta-ads';
--   delete from public.service_packages where service_type='web_dev' and code='web-dev-basic';
-- =============================================================================
