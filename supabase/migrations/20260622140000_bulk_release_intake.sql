-- Bulk release: release all CLEAN (no-duplicate) pending intake rows to Unique Lead in
-- one click. Rows with any match (lead / deal_client / queued) are excluded — lead matches
-- go through Bulk merge, queued duplicates would create dup leads. Batched (8s timeout):
-- returns how many remain so the client loops.

create or replace function public.bulk_release_intake_preview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_clean int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;
  select count(*) into v_clean
    from public.lead_intake
   where status = 'pending' and jsonb_array_length(matches) = 0;
  return jsonb_build_object('ok', true, 'releasable', coalesce(v_clean, 0));
end;
$$;
grant execute on function public.bulk_release_intake_preview() to authenticated;

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
      r.email, r.phone, r.website, r.company_name, r.contact_info, v_unique_stage
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
