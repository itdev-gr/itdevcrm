-- =============================================================================
-- 2026-08-26: "Under Development" sales pipeline — Phase 1 (board shell).
-- New board `under_development` on pipeline_stages + 10 test leads, plus two
-- functions made board-aware so the new board works end to end:
--
--   * sales_kanban_counts gains p_board (default 'sales' — existing callers
--     keep their behaviour; the 3-arg overload is dropped so PostgREST named
--     calls stay unambiguous).
--   * convert_lead_to_client resolves the Won stage from the LEAD'S OWN board
--     (terminal_outcome = 'won'), falling back to sales/won — so converting
--     from the new board keeps the card in that board's Won column.
--
-- Stage codes are prefixed `ud_` ON PURPOSE: leads_email_automations() and
-- process_email_sequences() match stages by CODE only (board-blind), and the
-- seeded sequences bind to 'no_answer'/'offer_sent'/'scheduled'/'won'. Distinct
-- codes keep the legacy time-based engine fully silent on this board; the new
-- task-cadence engine (Phase 2) will bind to the ud_* codes instead.
--
-- Test leads: emails are itdevgr24+udNN@gmail.com (inbox we control) so no
-- automation can ever reach a stranger; phones are the reserved-looking
-- 69900000NN range; owner = the intake owner (unique_lead's restricted user)
-- so leads_auto_distribute() never round-robins them to real reps.
--
-- LIVE DRIFT CHECK 2026-08-26 (md5(pg_get_functiondef)), APPLIED same day:
--   sales_kanban_counts    pre 45093b7e93a0dee0d06aa7a13b3128b6 (= 20260618000004, 3-arg)
--                          post 1ff94f2748faf73e3d09204a3cd8f897 (4-arg, p_board)
--   convert_lead_to_client pre d715bb0ad34eec98b27ecdee8cb59d0c (= 20260710151000)
--                          post e2f6cab735fdf88d2b6136bc8b2194ce
-- =============================================================================

-- 1. The board ---------------------------------------------------------------

insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
('under_development', 'ud_new_lead',       '{"en": "New Lead",       "el": "Νέος Πελάτης"}'::jsonb,      10, false, null,   null),
('under_development', 'ud_no_answer',      '{"en": "No Answer",      "el": "Δεν Απαντά"}'::jsonb,         20, false, null,   null),
('under_development', 'ud_offer_sent',     '{"en": "Offer Sent",     "el": "Προσφορά Στάλθηκε"}'::jsonb,  30, false, null,   null),
('under_development', 'ud_scheduled',      '{"en": "Scheduled",      "el": "Προγραμματισμένο"}'::jsonb,   40, false, null,   null),
('under_development', 'ud_won',            '{"en": "Won",            "el": "Κερδισμένο"}'::jsonb,         50, true,  'won',  'lock_deal'),
('under_development', 'ud_not_interested', '{"en": "Not Interested", "el": "Μη Ενδιαφέρον"}'::jsonb,      60, true,  'lost', null),
('under_development', 'ud_not_found',      '{"en": "Not Found",      "el": "Δεν Βρέθηκε"}'::jsonb,        70, true,  'lost', null),
('under_development', 'ud_dead_end',       '{"en": "Dead End",       "el": "Αδιέξοδο"}'::jsonb,           80, true,  'lost', null)
on conflict (board, code) do nothing;

-- 2. Board-aware kanban counts ------------------------------------------------
-- Same body as 20260618000004 plus p_board; the old 3-arg overload must go
-- first or PostgREST rpc('sales_kanban_counts', {p_owner,...}) turns ambiguous.

drop function if exists public.sales_kanban_counts(uuid, text, text);

create or replace function public.sales_kanban_counts(
  p_owner uuid default null,
  p_source text default null,
  p_search text default null,
  p_board text default 'sales'
) returns table (stage_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select l.stage_id, count(*)::bigint as total
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where not l.archived
    and ps.board = coalesce(p_board, 'sales')
    and (p_owner is null or l.owner_user_id = p_owner)
    and (p_source is null or l.source = p_source)
    and (
      p_search is null or p_search = ''
      or l.title ilike '%' || p_search || '%'
      or l.company_name ilike '%' || p_search || '%'
      or l.contact_first_name ilike '%' || p_search || '%'
      or l.contact_last_name ilike '%' || p_search || '%'
      or l.email ilike '%' || p_search || '%'
      or l.phone ilike '%' || p_search || '%'
    )
  group by l.stage_id;
$$;

grant execute on function public.sales_kanban_counts(uuid, text, text, text) to authenticated;

-- 3. convert_lead_to_client: Won stage from the lead's own board ---------------
-- Base body: 20260710151000_convert_lead_email_carryover.sql. Only the
-- won_stage_id lookup changes (own-board terminal 'won', sales/won fallback).

create or replace function public.convert_lead_to_client(target_lead_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  l record; errors text[] := '{}'; service_count int;
  won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select * into l from public.leads where id = target_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'errors', array['lead_not_found']); end if;
  if l.converted_at is not null then return jsonb_build_object('ok', false, 'errors', array['already_converted']); end if;
  if l.archived then return jsonb_build_object('ok', false, 'errors', array['lead_archived']); end if;
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required'); end if;
  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then errors := array_append(errors, 'at_least_one_service_required'); end if;
  if l.email is null or l.email = '' then errors := array_append(errors, 'email_required'); end if;
  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required'); end if;
  if l.company_name is null or trim(l.company_name) = '' then errors := array_append(errors, 'company_name_required'); end if;
  if l.payment_method is null or l.payment_method = '' then errors := array_append(errors, 'payment_method_required'); end if;
  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors); end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code, start_date,
    contact_info, additional_contacts
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date,
    l.contact_info, coalesce(l.additional_contacts, '[]'::jsonb)
  ) returning id into new_client_id;

  -- Won stage of the board the lead currently sits on (under_development keeps
  -- its card in its own Won column); sales/won when the board has none.
  select ps.id into won_stage_id
    from public.pipeline_stages ps
    join public.pipeline_stages cur on cur.id = l.stage_id
   where ps.board = cur.board and ps.terminal_outcome = 'won' and not ps.archived
   order by ps.position
   limit 1;
  if won_stage_id is null then
    select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  end if;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, cash_charge_vat, sales_note,
    business_profile_url, business_profile_name
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.cash_charge_vat, l.additional_notes,
    l.business_profile_url, l.business_profile_name
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  -- Carry captured lead emails onto the new client + deal (keep lead_id as history).
  update public.email_messages set client_id = new_client_id, deal_id = new_deal_id
    where lead_id = l.id;
  update public.leads set
      converted_at = now(), converted_client_id = new_client_id, converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id), won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code));
  end if;

  return jsonb_build_object('ok', true, 'lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code);
end $function$;

grant execute on function public.convert_lead_to_client(uuid) to authenticated;

-- 4. Ten test leads ------------------------------------------------------------
-- Idempotent (skips emails already present). Owner/created_by = the intake
-- owner so auto-distribution never touches them.

do $$
declare
  v_stage uuid;
  v_owner uuid;
  i int;
begin
  select id into v_stage from public.pipeline_stages
    where board = 'under_development' and code = 'ud_new_lead';
  select restricted_to_user_id into v_owner from public.pipeline_stages
    where board = 'sales' and code = 'unique_lead';
  if v_stage is null then
    raise exception 'under_development/ud_new_lead stage missing';
  end if;

  for i in 1..10 loop
    insert into public.leads (
      title, source, contact_first_name, company_name, email, phone,
      stage_id, owner_user_id, created_by, notes
    )
    select
      format('TEST UD %s', lpad(i::text, 2, '0')),
      'manual',
      format('Test Contact %s', i),
      format('UD Test Company %s', lpad(i::text, 2, '0')),
      format('itdevgr24+ud%s@gmail.com', lpad(i::text, 2, '0')),
      format('69900000%s', lpad(i::text, 2, '0')),
      v_stage, v_owner, v_owner,
      'Δοκιμαστικό lead για το Under Development pipeline — ασφαλές για αυτοματισμούς (email σε δικό μας inbox).'
    where not exists (
      select 1 from public.leads where email = format('itdevgr24+ud%s@gmail.com', lpad(i::text, 2, '0'))
    );
  end loop;
end $$;

-- ROLLBACK:
-- delete from public.leads where email like 'itdevgr24+ud%@gmail.com' and title like 'TEST UD %';
-- (restore convert_lead_to_client to the body in 20260710151000_convert_lead_email_carryover.sql)
-- drop function if exists public.sales_kanban_counts(uuid, text, text, text);
-- (restore sales_kanban_counts to the 3-arg body in 20260618000004_sales_kanban_counts.sql)
-- delete from public.pipeline_stages where board = 'under_development';
