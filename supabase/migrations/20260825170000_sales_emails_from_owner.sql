-- =============================================================================
-- 2026-08-25: automated sales emails send FROM the lead owner's personal Gmail
-- with CC sales@itdev.gr (owner decision — the exact inverse of the previous
-- "from sales@, CC the owner" behaviour). Resend/sales@ stays as the fallback
-- transport whenever the owner has no connected Gmail (or there is no owner),
-- so no email is ever lost. won_welcome / won_next_steps are NOT affected.
--
-- DB side: email_outbox grows send_as_user_id; lead_email_payload adds
-- owner_user_id; enqueue_lead_email fills send_as_user_id for the sales
-- templates. The transport decision lives in the send-email edge function
-- (deployed together with this migration).
--
-- LIVE DRIFT CHECK 2026-08-25 (md5(pg_get_functiondef) == repo emissions):
--   lead_email_payload   <pre-md5 captured in deploy output>  = 20260624120000
--   enqueue_lead_email   <pre-md5 captured in deploy output>  = 20260721100000
-- APPLIED to prod 2026-08-25, post-change md5s in the deploy output.
-- =============================================================================

-- 1. The outbox carries WHO the email should be sent as (null = house identity).
alter table public.email_outbox
  add column if not exists send_as_user_id uuid;

-- 2. lead_email_payload: expose the owner's user id (needed to look up the
--    Gmail connection at send time). Everything else byte-for-byte identical.
create or replace function public.lead_email_payload(l public.leads)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', coalesce(l.code, ''),
    'name', coalesce(nullif(trim(l.contact_first_name), ''), l.company_name, ''),
    'company', coalesce(l.company_name, ''),
    'industry', coalesce(l.industry, ''),
    'owner_name', coalesce(
      (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.user_id = l.owner_user_id),
      'η ομάδα μας'),
    'owner_email', coalesce(
      (select p.email from public.profiles p where p.user_id = l.owner_user_id), ''),
    'owner_user_id', l.owner_user_id,
    'scheduled_for', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$$;

-- 3. enqueue_lead_email: LIVE body from 20260721100000 with ONE addition —
--    send_as_user_id = the lead's owner for every template except won_welcome.
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

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key, send_as_user_id)
  values (v_identity, l.email, tpl_key, public.lead_email_payload(l), dkey,
          case when tpl_key = 'won_welcome' then null else l.owner_user_id end);
  return true;
end $function$;

-- ROLLBACK:
--   restore enqueue_lead_email from 20260721100000 and lead_email_payload from
--   20260624120000; alter table public.email_outbox drop column send_as_user_id;
