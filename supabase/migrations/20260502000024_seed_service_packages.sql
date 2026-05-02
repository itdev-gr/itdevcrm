-- =============================================================================
-- Seed placeholder packages. Admin can rename/re-price/archive via UI.
-- =============================================================================
insert into public.service_packages (service_type, code, display_names, default_one_time_amount, default_monthly_amount, sort_order) values
  -- Web SEO
  ('web_seo', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,    0,   300, 10),
  ('web_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,    0,   500, 20),
  ('web_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,    0,   900, 30),
  -- Local SEO
  ('local_seo', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,   0,   200, 10),
  ('local_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,   0,   350, 20),
  ('local_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,   0,   600, 30),
  -- Web Dev
  ('web_dev', 'starter',     '{"en": "Starter",     "el": "Starter"}'::jsonb,    1500, 0, 10),
  ('web_dev', 'business',    '{"en": "Business",    "el": "Business"}'::jsonb,   3000, 0, 20),
  ('web_dev', 'enterprise',  '{"en": "Enterprise",  "el": "Enterprise"}'::jsonb, 6000, 0, 30),
  -- Social Media
  ('social_media', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,    0,   250, 10),
  ('social_media', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,    0,   450, 20),
  ('social_media', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,    0,   800, 30),
  -- AI SEO (2 packages per brainstorming)
  ('ai_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb, 0,  600, 10),
  ('ai_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb, 0, 1200, 20)
  -- Hosting: no packages seeded (single offering)
on conflict (service_type, code) do nothing;
