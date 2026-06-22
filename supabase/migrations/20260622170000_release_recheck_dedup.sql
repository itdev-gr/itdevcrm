-- Durable fix for the root cause of the bulk-release duplicates:
-- The intake phone/email backfill filled contacts but did NOT recompute the duplicate
-- detection, so rows that became duplicates still showed matches=[] ("clean") and were
-- released — creating duplicate leads. Two-part fix:
--   (a) recompute matches for ALL pending intake rows from current contact data
--       (excluding a row's own queued self-match);
--   (b) bulk_release_intake re-checks duplicates at release time, so a stale "clean"
--       flag can never leak a duplicate again (re-flags the row and skips it).

-- (a) Refresh stale dedup flags on every pending row.
update public.lead_intake li set
  matches = coalesce((
    select jsonb_agg(to_jsonb(x))
    from public.find_lead_duplicates(li.email, li.phone) x
    where not (x.match_type = 'queued' and x.record_id = li.id)
  ), '[]'::jsonb),
  matched_on = coalesce((
    select array_agg(distinct x.matched_field)
    from public.find_lead_duplicates(li.email, li.phone) x
    where not (x.match_type = 'queued' and x.record_id = li.id)
  ), '{}')
where li.status = 'pending';

-- (b) Re-check at release time.
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
  v_live int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select id into v_unique_stage
    from public.pipeline_stages where board = 'sales' and code = 'unique_lead' limit 1;

  perform set_config('app.intake_release', 'on', true);

  for r in
    select * from public.lead_intake
     where status = 'pending' and jsonb_array_length(matches) = 0
     order by created_at
     limit greatest(coalesce(p_limit, 100), 1)
  loop
    -- Defense-in-depth: re-evaluate duplicates NOW (excluding self). If it now matches
    -- anything, re-flag the row and skip — never release a duplicate as clean.
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
      continue;
    end if;

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
    from public.lead_intake where status = 'pending' and jsonb_array_length(matches) = 0;
  return jsonb_build_object('ok', true, 'released', v_released, 'remaining', v_remaining);
end;
$$;
grant execute on function public.bulk_release_intake(int) to authenticated;
