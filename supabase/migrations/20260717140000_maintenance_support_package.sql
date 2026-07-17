-- =============================================================================
-- Seed the sellable "Support" (maintenance) catalog package.
--
-- The offer builder is catalog-driven: it only shows a service category when at
-- least one active `service_packages` row exists for that service_type. The
-- 'maintenance' service (board "Support") had no catalog row, so sales could add
-- it as a custom line on a deal but it never appeared in the offer builder.
--
-- This seeds one active monthly package (50 €/mo, no setup fee) so "Support" /
-- "Υποστήριξη" shows up as an offerable category. Admins can edit price / name /
-- add tiers afterwards from Admin → Service Packages.
--
-- Applied live on 2026-07-17 via the same INSERT (ON CONFLICT DO NOTHING); this
-- file records it for version control + rebuild parity. Data-only, no deploy.
--
-- ROLLBACK:
--   delete from public.service_packages
--    where service_type = 'maintenance' and code = 'maintenance-support';
-- =============================================================================

insert into public.service_packages
  (service_type, code, display_names, default_monthly_amount, default_one_time_amount, setup_fee,
   description, sort_order, is_active, archived)
values
  ('maintenance', 'maintenance-support',
   '{"en":"Monthly Support","el":"Μηνιαία Υποστήριξη"}'::jsonb,
   50.00, 0.00, 0.00,
   'Μηνιαία συντήρηση, ενημερώσεις & τεχνική υποστήριξη ιστοσελίδας.',
   10, true, false)
on conflict do nothing;
