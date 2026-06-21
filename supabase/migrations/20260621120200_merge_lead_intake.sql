-- Admin-only: append an intake row's info onto an existing pipeline lead and
-- mark the row 'merged'. Never overwrites any existing lead field.
create or replace function public.merge_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_block text;
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

  -- Safety: target must be one of this row's matched *leads*.
  select exists (
    select 1 from jsonb_array_elements(r.matches) m
    where m->>'match_type' = 'lead'
      and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_not_a_match'));
  end if;

  if not exists (select 1 from public.leads where id = p_target_lead_id) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_lead_missing'));
  end if;

  v_block := public.format_intake_merge_block(r);

  update public.leads
     set intake_log = case
           when coalesce(intake_log, '') = '' then v_block
           else intake_log || E'\n' || v_block
         end,
         updated_at = now()
   where id = p_target_lead_id;

  update public.lead_intake
     set status = 'merged',
         merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end;
$$;

grant execute on function public.merge_lead_intake(uuid, uuid) to authenticated;
