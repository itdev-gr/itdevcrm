-- =============================================================================
-- Remove trailing "Με εκτίμηση, …" sign-offs from email_templates bodies.
-- The send-email function now appends the branded IT DEV signature (company
-- variant) to every client-facing email at render time
-- (supabase/functions/_shared/signature.ts) — leaving these in would sign
-- every email twice. Full backup first; bodies may have drifted from seeds.
-- SEO-onboarding contact-person closings do not match the pattern and stay.
-- =============================================================================

create table if not exists public.email_templates_backup_20260713 as
  select * from public.email_templates;

-- The backup is the rollback path — deny API-role access entirely (RLS on,
-- no policies). Management-API rollback SQL runs as postgres and bypasses.
alter table public.email_templates_backup_20260713 enable row level security;

update public.email_templates
   set body = regexp_replace(
         body,
         '\s*Με εκτίμηση,\s*(\{\{owner_name\}\})?\s*(Η ομάδα της)?\s*(ITDEV|ITDev|itdev)?(\s*Λογιστήριο)?\s*$',
         ''
       ),
       updated_at = now()
 where body ~ '\s*Με εκτίμηση,\s*(\{\{owner_name\}\})?\s*(Η ομάδα της)?\s*(ITDEV|ITDev|itdev)?(\s*Λογιστήριο)?\s*$';

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   select count(*) as still_signed from public.email_templates
--    where body like '%εκτίμηση%';                      -- expect 0
--   select key, right(body, 60) as tail
--     from public.email_templates order by key;          -- eyeball every tail
-- ROLLBACK:
--   update public.email_templates t
--      set body = b.body, subject = b.subject, updated_at = now()
--     from public.email_templates_backup_20260713 b
--    where b.key = t.key;
-- ---------------------------------------------------------------------------
