-- 1) Bulk import leads into the intake queue (admin-only). Each row is duplicate-
--    checked (same rule as Meta leads) and stored as source='import'.
-- 2) Release now lands the lead in the Unique Lead column instead of New Lead. That
--    column is restricted to mkifokeris by leads_enforce_stage_restriction, so the
--    release path sets a transaction-local GUC the trigger honours — the column
--    stays locked against manual drag-and-drop by other admins.

-- ---- import RPC -------------------------------------------------------------
create or replace function public.import_leads_to_intake(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_full text; v_first text; v_last text; v_email text; v_phone text;
  v_company text; v_website text; v_notes text; v_src jsonb;
  v_phone_norm text; v_matches jsonb; v_matched_on text[];
  v_imported int := 0; v_flagged int := 0;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  for rec in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_full    := nullif(btrim(coalesce(rec->>'full_name','')), '');
    v_email   := nullif(btrim(coalesce(rec->>'email','')), '');
    v_phone   := nullif(btrim(coalesce(rec->>'phone','')), '');
    v_company := nullif(btrim(coalesce(rec->>'company','')), '');
    v_website := nullif(btrim(coalesce(rec->>'website','')), '');
    v_notes   := nullif(btrim(coalesce(rec->>'notes','')), '');
    v_src     := coalesce(rec->'source_data', '{}'::jsonb);

    if v_full is null and v_email is null and v_phone is null then
      continue;
    end if;

    if v_full is not null then
      v_first := nullif(split_part(v_full, ' ', 1), '');
      v_last  := nullif(btrim(regexp_replace(v_full, '^\S+\s*', '')), '');
    else
      v_first := null; v_last := null;
    end if;

    v_phone_norm := case
      when length(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g')) >= 10
        then right(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g'), 10)
      else null
    end;

    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb),
           coalesce(array_agg(distinct d.matched_field), '{}'::text[])
      into v_matches, v_matched_on
      from public.find_lead_duplicates(v_email, v_phone) d;

    insert into public.lead_intake (
      source, source_data, title, contact_first_name, contact_last_name,
      email, phone, phone_normalized, website, company_name, contact_info,
      matched_on, matches
    ) values (
      'import', v_src, coalesce(v_company, v_full, 'Imported lead'),
      v_first, v_last, v_email, v_phone, v_phone_norm, v_website, v_company, v_notes,
      v_matched_on, v_matches
    );

    v_imported := v_imported + 1;
    if jsonb_array_length(v_matches) > 0 then v_flagged := v_flagged + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'imported', v_imported, 'flagged', v_flagged);
end;
$$;

grant execute on function public.import_leads_to_intake(jsonb) to authenticated;

-- ---- enforce-restriction trigger: honour the reviewed-release bypass ---------
create or replace function public.leads_enforce_stage_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  restricted uuid;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if new.stage_id is null then
    return new;
  end if;

  -- The reviewed-release path (release_lead_intake) sets this GUC so a vetted lead
  -- can be placed into an otherwise-restricted stage (Unique Lead).
  if coalesce(current_setting('app.intake_release', true), '') = 'on' then
    return new;
  end if;

  select restricted_to_user_id into restricted
    from public.pipeline_stages
   where id = new.stage_id;

  -- auth.uid() is null ⇒ service role (Zapier webhook) ⇒ allowed.
  if restricted is not null
     and auth.uid() is not null
     and auth.uid() is distinct from restricted then
    raise exception 'Only the assigned user may move leads into this stage'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---- release now lands in Unique Lead --------------------------------------
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
    email, phone, website, company_name, contact_info, stage_id
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info, v_unique_stage
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

grant execute on function public.release_lead_intake(uuid) to authenticated;

-- ROLLBACK:
-- drop function if exists public.import_leads_to_intake(jsonb);
-- restore release_lead_intake body from 20260619170000 (stage_id = new_lead, no GUC);
-- restore leads_enforce_stage_restriction body from 20260615000008 (without the GUC branch).
