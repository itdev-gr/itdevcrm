-- won_welcome → every new client (Build A).
--
-- Problem: won_welcome only fired on the LEAD path (lead stage → 'won'). Deals
-- created directly in accounting (accounting_create_deal makes a linked lead with
-- automations_enabled=false) and re-baselined deals never fired it, so those
-- clients got no welcome + no onboarding (JotForm) form.
--
-- Fix: also enqueue won_welcome when a deal enters accounting 'new' (covers every
-- new-client deal regardless of origin). To stop the lead path + deal path from
-- BOTH sending (convert_lead_to_client inserts the deal, then flips the lead to
-- 'won' — same transaction, so both would fire), won_welcome now dedups by
-- RECIPIENT, not just by dedupe_key. One welcome per client email, ever.
--
-- Changes / Revert: revert SQL at the bottom (commented).

-- 1) enqueue_lead_email: add recipient-level dedup for won_welcome, and treat the
--    new 'sending' claim status as in-flight for the generic key dedup too.
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
  if l.email is null or l.email = '' then return false; end if;
  if l.email_opt_out or not l.automations_enabled then return false; end if;
  if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
    return false;
  end if;
  if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
    return false;
  end if;

  -- won_welcome is once-per-client: also dedup by recipient so the lead path and
  -- the deal path (different dedupe_keys) can never both send to the same client.
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

-- 2) Deal-side enqueue: fire won_welcome when a deal is in accounting 'new'.
create or replace function public.deals_enqueue_won_welcome()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stage_code text;
  v_email text;
  v_name text;
begin
  -- Only when the deal sits in the accounting 'new' stage.
  select code into v_stage_code from public.pipeline_stages where id = new.accounting_stage_id;
  if v_stage_code is distinct from 'new' then
    return new;
  end if;

  -- Respect the dept_accounting + won_welcome toggles.
  if not public.email_automation_enabled('won_welcome') then
    return new;
  end if;

  select lower(btrim(c.email)), c.name into v_email, v_name
    from public.clients c where c.id = new.client_id;
  if v_email is null or v_email = '' or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return new;
  end if;

  -- Once-per-client: never a 2nd won_welcome to the same address (covers the lead
  -- path, prior sends, and re-entry into 'new').
  if exists (select 1 from public.email_log
              where template_key = 'won_welcome' and status = 'sent'
                and lower(btrim(to_email)) = v_email)
     or exists (select 1 from public.email_outbox
                 where template_key = 'won_welcome' and status in ('pending','sending','sent')
                   and lower(btrim(to_email)) = v_email) then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, 'won_welcome',
          jsonb_build_object('name', coalesce(v_name, ''), 'code', coalesce(new.code, '')),
          'won_welcome:deal:' || new.id::text);
  return new;
end $function$;

drop trigger if exists deals_enqueue_won_welcome on public.deals;
create trigger deals_enqueue_won_welcome
after insert or update of accounting_stage_id on public.deals
for each row
execute function public.deals_enqueue_won_welcome();

-- ============================================================================
-- REVERT:
--   drop trigger if exists deals_enqueue_won_welcome on public.deals;
--   drop function if exists public.deals_enqueue_won_welcome();
--   -- restore enqueue_lead_email to the version without the won_welcome recipient
--   -- dedup (see migration history / git blame for the prior body).
-- ============================================================================
