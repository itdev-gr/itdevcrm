-- Release now carries campaign data into the lead, fill-blank:
--   notes        = existing intake contact_info, else the formatted form+Q&A block
--   company_name = existing intake company_name, else source_data 'όνομα_εταιρείας'
-- Everything else is identical to 20260622120100 / 20260622140000.

create or replace function public.release_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_lead_id uuid;
  v_unique_stage uuid;
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

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'sales' and code = 'unique_lead'
   limit 1;

  perform set_config('app.intake_release', 'on', true);

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, notes, stage_id
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website,
    coalesce(nullif(btrim(r.company_name), ''), nullif(btrim(r.source_data->>'όνομα_εταιρείας'), '')),
    coalesce(nullif(btrim(r.contact_info), ''), nullif(public.build_lead_info_block(r.source_data, r.title), '')),
    v_unique_stage
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

create or replace function public.bulk_release_intake(p_limit int default 100)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
      email, phone, website, company_name, notes, stage_id
    ) values (
      r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
      r.email, r.phone, r.website,
      coalesce(nullif(btrim(r.company_name), ''), nullif(btrim(r.source_data->>'όνομα_εταιρείας'), '')),
      coalesce(nullif(btrim(r.contact_info), ''), nullif(public.build_lead_info_block(r.source_data, r.title), '')),
      v_unique_stage
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
$$;
grant execute on function public.bulk_release_intake(int) to authenticated;

-- ROLLBACK: re-apply 20260622120100_release_intake_notes_to_lead_info.sql
--           and 20260622140000_bulk_release_intake.sql to restore prior bodies.
