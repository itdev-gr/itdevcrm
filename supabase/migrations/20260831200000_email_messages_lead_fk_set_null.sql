-- 2026-08-31: Admin lead delete fails for leads with captured emails.
--
-- Incident (2026-08-31, lead 007072): `delete from leads` hit
-- `email_messages_lead_id_fkey` — 20260710150000 added email_messages.lead_id
-- referencing leads(id) with NO on-delete action, so public.delete_leads()
-- (the admin Delete in the leads UI, 20260618000005) errors for ANY lead that
-- has captured Gmail messages. Every other lead FK in the schema already uses
-- `on delete set null` (offers.lead_id, lead_intake.released_lead_id,
-- pro_formas.lead_id) — the mail archive must survive the lead, just unlinked.
--
-- Fix: recreate the FK with `on delete set null`. No RPC change needed.
-- See docs/data-fixes/2026-08-31-delete-lead-007072.md for the incident.
--
-- LIVE DRIFT CHECK 2026-08-31, APPLIED same day via Management API:
--   pg_constraint email_messages_lead_id_fkey confdeltype pre 'a' (no action) -> post 'n' (set null).

alter table public.email_messages
  drop constraint email_messages_lead_id_fkey;

alter table public.email_messages
  add constraint email_messages_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;

-- ROLLBACK:
-- alter table public.email_messages drop constraint email_messages_lead_id_fkey;
-- alter table public.email_messages
--   add constraint email_messages_lead_id_fkey
--   foreign key (lead_id) references public.leads(id);
