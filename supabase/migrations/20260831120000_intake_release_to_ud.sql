-- 2026-08-31: New leads land on the Under Development board (owner go-live
-- decision, same session as the full classic→UD lead migration).
--
-- Every path that releases an intake row into `leads` — manual release, bulk
-- release, the auto-release trigger — now resolves its landing stage as
-- under_development/ud_new_lead instead of sales/unique_lead, so a fresh lead
-- immediately gets the UD first-call cadence (welcome email step currently
-- disabled by owner; only the «1η Κλήση» task opens, assigned to the rotation
-- owner picked by leads_auto_distribute).
--
-- The re-engage merge paths follow: a re-inquiry bumps the existing lead to
-- ud_new_lead (chain restarts — fresh interest, fresh call task). Their
-- "already a customer" guards learn 'ud_won', because the 611 converted Won
-- leads moved to that stage earlier today and must NOT be auto-reengaged.
--
-- The app.intake_release GUC lines stay: harmless for ud_new_lead (no insert
-- restriction there) and still correct if anything ever lands on a restricted
-- stage again.
--
-- LIVE DRIFT CHECK 2026-08-31 (md5(pg_get_functiondef)), bodies below are the
-- live definitions with only the changes described:
--   release_lead_intake          pre cad7895fbe94e44442eb530474812370
--   bulk_release_intake          pre 2d09253f90d9380f1f3d96e7ef37f9a3
--   lead_intake_auto_release     pre c70a18ce93d95b268847ce55bf90e347
--   apply_intake_reengage_merge  pre 87d5187bafe0a60f045cf998a82fbe5c
--   reengage_lead_intake         pre a41e8e00fc555622a8e15f848f0043f7
--   lead_intake_auto_merge       pre 7f6eb7bb5acb1ae9695f634004d7ce97

-- 1. Manual release --------------------------------------------------------

create or replace function public.release_lead_intake(p_id uuid, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.lead_intake;
  v_lead_id uuid;
  v_unique_stage uuid;
  v_live int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || r.status));
  end if;

  -- Defense-in-depth: re-evaluate duplicates NOW (excluding self), refresh flags.
  select count(*) into v_live
    from public.find_lead_duplicates(r.email, r.phone) x
   where not (x.match_type = 'queued' and x.record_id = r.id);

  if v_live > 0 then
    update public.lead_intake li set
      matches = coalesce((
        select jsonb_agg(to_jsonb(x)) from public.find_lead_duplicates(r.email, r.phone) x
        where not (x.match_type = 'queued' and x.record_id = r.id)), '[]'::jsonb),
      matched_on = coalesce((
        select array_agg(distinct x.matched_field) from public.find_lead_duplicates(r.email, r.phone) x
        where not (x.match_type = 'queued' and x.record_id = r.id)), '{}')
    where li.id = r.id;

    if not p_force then
      return jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array('has_duplicates'),
        'duplicate_count', v_live
      );
    end if;
  end if;

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'under_development' and code = 'ud_new_lead'
   limit 1;

  perform set_config('app.intake_release', 'on', true);

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, notes, stage_id, budget, region
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info, v_unique_stage,
    r.source_data->>'crm_budget', r.source_data->>'crm_region'
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$function$;

-- 2. Bulk release ----------------------------------------------------------

create or replace function public.bulk_release_intake(p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.lead_intake;
  v_lead_id uuid;
  v_unique_stage uuid;
  v_released int := 0;
  v_remaining int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'under_development' and code = 'ud_new_lead'
   limit 1;

  perform set_config('app.intake_release', 'on', true);

  for r in
    select * from public.lead_intake
     where status = 'pending' and jsonb_array_length(matches) = 0
     order by created_at
     limit greatest(coalesce(p_limit, 100), 1)
  loop
    insert into public.leads (
      source, source_data, title, contact_first_name, contact_last_name,
      email, phone, website, company_name, notes, stage_id, budget, region
    ) values (
      r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
      r.email, r.phone, r.website,
      coalesce(nullif(btrim(r.company_name), ''), nullif(btrim(r.source_data->>'όνομα_εταιρείας'), '')),
      coalesce(nullif(btrim(r.contact_info), ''), nullif(public.build_lead_info_block(r.source_data, r.title), '')),
      v_unique_stage, r.source_data->>'crm_budget', r.source_data->>'crm_region'
    )
    returning id into v_lead_id;

    update public.lead_intake
       set status = 'released', released_lead_id = v_lead_id,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = r.id;
    v_released := v_released + 1;
  end loop;

  select count(*) into v_remaining
    from public.lead_intake
   where status = 'pending' and jsonb_array_length(matches) = 0;

  return jsonb_build_object('ok', true, 'released', v_released, 'remaining', v_remaining);
end;
$function$;

-- 3. Auto-release trigger --------------------------------------------------

create or replace function public.lead_intake_auto_release()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  enabled boolean;
  v_unique_stage uuid;
  v_lead_id uuid;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  if jsonb_array_length(coalesce(NEW.matches, '[]'::jsonb)) <> 0 then
    return NEW;
  end if;

  select auto_release_enabled into enabled
    from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then
    return NEW;
  end if;

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'under_development' and code = 'ud_new_lead'
   limit 1;
  if v_unique_stage is null then
    return NEW;
  end if;

  perform set_config('app.intake_release', 'on', true);

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, notes, stage_id, budget, region
  ) values (
    NEW.source, NEW.source_data, NEW.title, NEW.contact_first_name, NEW.contact_last_name,
    NEW.email, NEW.phone, NEW.website, NEW.company_name, NEW.contact_info, v_unique_stage,
    NEW.source_data->>'crm_budget', NEW.source_data->>'crm_region'
  )
  returning id into v_lead_id;

  NEW.status := 'released';
  NEW.released_lead_id := v_lead_id;
  NEW.reviewed_at := now();
  return NEW;
end;
$function$;

-- 4. Re-engage merge: bump target to UD New Lead ---------------------------

create or replace function public.apply_intake_reengage_merge(p_lead_id uuid, r lead_intake)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_unique_stage uuid;
begin
  -- (a) Blank-fill + intake_log append + extra-contacts, unchanged.
  perform public.apply_intake_merge(p_lead_id, r);

  -- (b) Stage move to UD New Lead — the first-call cadence restarts, which is
  --     exactly what fresh interest deserves. GUC kept for restricted stages.
  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'under_development' and code = 'ud_new_lead'
   limit 1;

  if v_unique_stage is not null then
    perform set_config('app.intake_release', 'on', true);
    update public.leads
       set stage_id = v_unique_stage,
           updated_at = now()
     where id = p_lead_id
       and stage_id is distinct from v_unique_stage;
  end if;

  -- (c) Re-engage welcome email: only when the standard welcome was already
  --     SENT for this lead (mirrors reengage_lead_intake exactly).
  if exists (
    select 1 from public.email_log
     where dedupe_key = 'lead_welcome:' || p_lead_id and status = 'sent'
  ) then
    perform public.enqueue_lead_email(
      p_lead_id,
      'lead_welcome',
      'lead_welcome:' || p_lead_id || ':reengage:' || r.id
    );
  end if;
end $function$;

-- 5. Customer guards learn ud_won ------------------------------------------

create or replace function public.reengage_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.lead_intake;
  v_target_stage_code text;
  v_is_lead_match boolean;
begin
  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['not_found']);
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', array['not_pending']);
  end if;

  select exists (
    select 1 from jsonb_array_elements(r.matches) m
     where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', array['not_a_match']);
  end if;

  select ps.code into v_target_stage_code
    from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = p_target_lead_id and not l.archived;
  if v_target_stage_code is null then
    return jsonb_build_object('ok', false, 'errors', array['target_missing_or_archived']);
  end if;
  if v_target_stage_code in ('won', 'converted', 'ud_won') then
    return jsonb_build_object('ok', false, 'errors', array['target_is_customer']);
  end if;

  perform public.apply_intake_reengage_merge(p_target_lead_id, r);

  update public.lead_intake
     set status = 'merged',
         merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end $function$;

create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  lead_matches jsonb;
  target uuid;
  target_stage_code text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  -- Existing-customer signal: any match_type='deal_client' → HOLD pending
  -- (previously auto-discarded). Admin decides later.
  if exists (
    select 1 from jsonb_array_elements(NEW.matches) m
     where m->>'match_type' = 'deal_client'
  ) then
    return NEW;
  end if;

  -- Isolate LEAD matches; only auto-act on the exactly-one case.
  select coalesce(jsonb_agg(m), '[]'::jsonb) into lead_matches
    from jsonb_array_elements(NEW.matches) m
   where m->>'match_type' = 'lead';
  if jsonb_array_length(lead_matches) <> 1 then
    return NEW;  -- 0 matches → auto_release handles it; 2+ → admin decides
  end if;

  target := (lead_matches->0->>'record_id')::uuid;

  -- Target must exist AND not be archived AND not already a customer.
  select ps.code into target_stage_code
    from public.leads l
    join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = target and not l.archived;

  if target_stage_code is null then
    return NEW;  -- archived or missing → hold pending for admin
  end if;
  if target_stage_code in ('won', 'converted', 'ud_won') then
    return NEW;  -- already a customer → hold pending for admin
  end if;

  -- Everything else → merge + reengage into UD New Lead.
  perform public.apply_intake_reengage_merge(target, NEW);
  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end $function$;

-- ROLLBACK: re-emit the six bodies from
--   20260622200000 (release), 20260622170100/170000 (bulk),
--   20260630050000 (auto_release), 20260701000000 (merge trio)
-- swapping the stage lookup back to board='sales', code='unique_lead' and
-- dropping 'ud_won' from the two customer guards.
