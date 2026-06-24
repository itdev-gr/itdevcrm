-- 20260624100000_won_welcome_from_accounting.sql
-- The "won welcome" email is a post-sale onboarding email, so it should be sent
-- from accounting@itdev.gr instead of sales@. All other lead-lifecycle emails
-- (lead_welcome, no-answer, offer, scheduled, won_next_steps, re-engage) stay on
-- sales@. Only enqueue_lead_email's identity changes (per template key).
create or replace function public.enqueue_lead_email(
  target_lead_id uuid,
  tpl_key text,
  dkey text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_identity text;
begin
  select * into l from public.leads where id = target_lead_id;
  if l is null or l.archived then return false; end if;
  if l.email is null or l.email = '' then return false; end if;
  if l.email_opt_out or not l.automations_enabled then return false; end if;
  if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
    return false;
  end if;
  if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
    return false;
  end if;

  -- won_welcome = post-sale onboarding → accounting@; everything else → sales@.
  v_identity := case when tpl_key = 'won_welcome' then 'accounting' else 'sales' end;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values (v_identity, l.email, tpl_key, public.lead_email_payload(l), dkey);
  return true;
end $$;

-- ROLLBACK: restore the body from 20260610000007 (hardcoded identity 'sales').
