-- Social profile fields for leads (shown in a "Social" section of the lead Overview,
-- and the destination for ClickUp's Instagram/Facebook/Tiktok/Linkedin fields on import).
alter table public.leads
  add column if not exists instagram text,
  add column if not exists facebook text,
  add column if not exists tiktok text,
  add column if not exists linkedin text;

-- ROLLBACK:
-- alter table public.leads
--   drop column if exists instagram,
--   drop column if exists facebook,
--   drop column if exists tiktok,
--   drop column if exists linkedin;
