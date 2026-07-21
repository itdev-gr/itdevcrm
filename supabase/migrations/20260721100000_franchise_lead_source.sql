-- Franchise lead source
-- Spec: docs/superpowers/specs/2026-07-21-franchise-lead-source-design.md
--
-- Adds 'franchise' as a third lead source next to meta / manual / import.
-- Franchise leads are created manually for now. NO automated email may ever be
-- sent to a franchise-source lead until the owner explicitly enables it. The
-- silence is enforced centrally by a single guard at the top of
-- enqueue_lead_email(), which is the one choke point every current/future
-- lead-email call site funnels through (incl. the Unique-Lead welcome trigger
-- leads_email_automations()).
--
-- Live pre-image of enqueue_lead_email captured before editing (prod drift):
--   .superpowers/sdd/pre-franchise-enqueue_lead_email.sql
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- 1) Restore prior CHECK (drop the 4-value constraint, re-add the 3-value one):
--
--    alter table public.leads drop constraint leads_source_check;
--    alter table public.leads add constraint leads_source_check
--      check (source = any (array['meta','manual','import']));
--
-- 2) Restore enqueue_lead_email pre-image by re-running the body saved in
--    .superpowers/sdd/pre-franchise-enqueue_lead_email.sql (a CREATE OR REPLACE
--    of the pre-guard function). create-or-replace preserves ACLs.
-- ============================================================================

-- 1) Widen the source CHECK to include 'franchise'.
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source = any (array['meta'::text, 'manual'::text, 'import'::text, 'franchise'::text]));

-- 2) Recreate enqueue_lead_email from the LIVE body with ONLY the franchise
--    guard added (create or replace preserves ACLs; never drop).
create or replace function public.enqueue_lead_email(target_lead_id uuid, tpl_key text, dkey text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  l public.leads;
  v_identity text;
begin
  select * into l from public.leads where id = target_lead_id;
  if l is null or l.archived then return false; end if;
  -- Franchise leads receive NO automated email (central gate; owner-gated).
  if l.source = 'franchise' then return false; end if;
  if l.email is null or l.email = '' then return false; end if;
  if l.email_opt_out or not l.automations_enabled then return false; end if;
  if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
    return false;
  end if;
  if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
    return false;
  end if;

  if tpl_key = 'won_welcome' and (
       exists (select 1 from public.email_log
                where template_key = 'won_welcome' and status = 'sent'
                  and lower(btrim(to_email)) = lower(btrim(l.email)))
    or exists (select 1 from public.email_outbox
                where template_key = 'won_welcome' and status in ('pending','sending','sent')
                  and lower(btrim(to_email)) = lower(btrim(l.email)))
  ) then
    return false;
  end if;

  v_identity := case when tpl_key = 'won_welcome' then 'accounting' else 'sales' end;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values (v_identity, l.email, tpl_key, public.lead_email_payload(l), dkey);
  return true;
end $function$;
