-- Bug #1: single-row Release must re-check duplicates at release time, like
-- bulk_release_intake (20260622170000) already does. Change of signature
-- (added p_force) means we must DROP the old (uuid) overload first.
--
-- Behaviour:
--   * Re-evaluate find_lead_duplicates(email, phone) NOW, excluding the row itself.
--   * Always refresh the stored matches/matched_on so the UI shows current flags.
--   * If duplicates exist and p_force is false -> refuse with 'has_duplicates'
--     (+ duplicate_count). The client confirms, then retries with p_force = true.
--   * Otherwise insert into leads (Unique Lead) and mark the intake row released.
drop function if exists public.release_lead_intake(uuid);

create or replace function public.release_lead_intake(p_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    email, phone, website, company_name, notes, stage_id
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

grant execute on function public.release_lead_intake(uuid, boolean) to authenticated, service_role;

-- ROLLBACK:
--   drop function if exists public.release_lead_intake(uuid, boolean);
--   then re-apply the body from 20260622120100_release_intake_notes_to_lead_info.sql
--   (single-arg release_lead_intake(uuid), no re-check).
