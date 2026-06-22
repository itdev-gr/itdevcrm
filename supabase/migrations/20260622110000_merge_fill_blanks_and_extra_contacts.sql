-- On merge, besides appending the campaign/Q&A block, also pull the new lead's contact
-- info into the existing lead: fill any BLANK primary field (name/email/phone/website/
-- company) from the duplicate (never overwriting), and if the new phone/email DIFFERS from
-- the primary's, keep it as an Additional contact instead of losing it.
-- Shared helper so manual merge, auto-merge, and bulk merge behave identically.
create or replace function public.apply_intake_merge(p_lead_id uuid, r public.lead_intake)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  lead public.leads;
  v_block text;
  v_full_name text;
  v_fphone text;   -- primary phone after blank-fill
  v_femail text;   -- primary email after blank-fill
  v_phone_extra boolean;
  v_email_extra boolean;
  v_add boolean := false;
begin
  select * into lead from public.leads where id = p_lead_id;
  if not found then return; end if;

  v_block := public.format_intake_merge_block(r);
  v_full_name := nullif(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')), '');

  v_fphone := case when coalesce(trim(lead.phone),'') = '' then nullif(trim(r.phone),'') else lead.phone end;
  v_femail := case when coalesce(trim(lead.email),'') = '' then nullif(trim(r.email),'') else lead.email end;

  -- Does the new contact carry a phone/email not represented on the (post-fill) primary?
  v_phone_extra := coalesce(trim(r.phone),'') <> ''
    and regexp_replace(r.phone, '[^0-9]', '', 'g') <> coalesce(regexp_replace(v_fphone, '[^0-9]', '', 'g'), '');
  v_email_extra := coalesce(trim(r.email),'') <> ''
    and lower(trim(r.email)) <> lower(coalesce(trim(v_femail), ''));

  if v_phone_extra or v_email_extra then
    -- skip if this phone/email is already among the lead's additional contacts
    if not exists (
      select 1 from jsonb_array_elements(coalesce(lead.additional_contacts, '[]'::jsonb)) c
      where (coalesce(trim(r.phone),'') <> '' and regexp_replace(coalesce(c->>'phone',''), '[^0-9]', '', 'g') = regexp_replace(r.phone, '[^0-9]', '', 'g'))
         or (coalesce(trim(r.email),'') <> '' and lower(trim(coalesce(c->>'email',''))) = lower(trim(r.email)))
    ) then
      v_add := true;
    end if;
  end if;

  update public.leads l set
    contact_first_name  = coalesce(nullif(trim(l.contact_first_name),''), nullif(trim(r.contact_first_name),''), l.contact_first_name),
    contact_last_name   = coalesce(nullif(trim(l.contact_last_name),''),  nullif(trim(r.contact_last_name),''),  l.contact_last_name),
    email               = coalesce(nullif(trim(l.email),''),              nullif(trim(r.email),''),              l.email),
    phone               = coalesce(nullif(trim(l.phone),''),              nullif(trim(r.phone),''),              l.phone),
    website             = coalesce(nullif(trim(l.website),''),            nullif(trim(r.website),''),            l.website),
    company_name        = coalesce(nullif(trim(l.company_name),''),       nullif(trim(r.company_name),''),       l.company_name),
    additional_contacts = case when v_add then
        coalesce(l.additional_contacts, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'full_name', coalesce(v_full_name, ''),
          'email', coalesce(r.email, ''),
          'phone', coalesce(r.phone, ''),
          'info', coalesce(r.contact_info, '')
        ))
      else l.additional_contacts end,
    intake_log = case when coalesce(l.intake_log,'') = '' then v_block else l.intake_log || E'\n' || v_block end,
    updated_at = now()
  where l.id = p_lead_id;
end;
$$;

-- Route all three merge paths through the shared helper.
create or replace function public.merge_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.lead_intake;
  v_is_lead_match boolean;
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
  select exists (
    select 1 from jsonb_array_elements(r.matches) m
    where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_not_a_match'));
  end if;
  if not exists (select 1 from public.leads where id = p_target_lead_id) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_lead_missing'));
  end if;
  if public.lead_is_dead_end(p_target_lead_id) then
    update public.lead_intake
       set status = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_id;
    return jsonb_build_object('ok', true, 'dropped_dead_end', true);
  end if;

  perform public.apply_intake_merge(p_target_lead_id, r);

  update public.lead_intake
     set status = 'merged', merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end;
$$;

create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  enabled boolean;
  lead_matches jsonb;
  target uuid;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  select auto_merge_enabled into enabled from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then return NEW; end if;
  select coalesce(jsonb_agg(m), '[]'::jsonb) into lead_matches
    from jsonb_array_elements(NEW.matches) m where m->>'match_type' = 'lead';
  if jsonb_array_length(lead_matches) <> 1 then return NEW; end if;
  target := (lead_matches->0->>'record_id')::uuid;
  if not exists (select 1 from public.leads where id = target) then return NEW; end if;
  if public.lead_is_dead_end(target) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

  perform public.apply_intake_merge(target, NEW);

  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end;
$$;

create or replace function public.bulk_merge_intake(p_limit int default 200)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_merged int := 0;
  v_dropped int := 0;
  v_remaining int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;
  for r in
    select li as row,
           li.id as intake_id,
           (select (m->>'record_id')::uuid from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead' limit 1) as target
    from public.lead_intake li
    where li.status = 'pending'
      and (select count(*) from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead') = 1
    order by li.created_at
    limit greatest(coalesce(p_limit, 200), 1)
  loop
    if not exists (select 1 from public.leads where id = r.target) then
      continue;
    end if;
    if public.lead_is_dead_end(r.target) then
      update public.lead_intake
         set status = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
       where id = r.intake_id;
      v_dropped := v_dropped + 1;
    else
      perform public.apply_intake_merge(r.target, r.row);
      update public.lead_intake
         set status = 'merged', merged_into_lead_id = r.target,
             reviewed_by = auth.uid(), reviewed_at = now()
       where id = r.intake_id;
      v_merged := v_merged + 1;
    end if;
  end loop;
  with pend as (
    select
      (select count(*) from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead') as lead_cnt,
      (select (m->>'record_id')::uuid from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead' limit 1) as target
    from public.lead_intake li where li.status = 'pending'
  )
  select count(*) into v_remaining
  from pend p
  where p.lead_cnt = 1 and exists (select 1 from public.leads l where l.id = p.target);
  return jsonb_build_object('ok', true, 'merged', v_merged, 'dropped', v_dropped, 'remaining', v_remaining);
end;
$$;
