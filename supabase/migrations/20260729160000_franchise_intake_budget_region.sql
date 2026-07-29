-- =============================================================================

-- 2026-07-29: Released franchise-form intake leads carry budget/region.

-- The meta-lead endpoint stores crm_budget/crm_region in source_data for

-- franchise-form submissions (source='franchise'); all three release paths

-- forward them into the new leads.budget/leads.region columns.

-- Bodies are the LIVE prod definitions (pulled 2026-07-29) + the two fields.

-- =============================================================================

CREATE OR REPLACE FUNCTION public.release_lead_intake(p_id uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where board = 'sales' and code = 'unique_lead'
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
$function$
;

CREATE OR REPLACE FUNCTION public.lead_intake_auto_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where board = 'sales' and code = 'unique_lead'
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
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_release_intake(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where board = 'sales' and code = 'unique_lead'
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
$function$
;
