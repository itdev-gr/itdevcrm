-- Shared rule: is a lead currently in a written-off sales stage?
create or replace function public.lead_is_dead_end(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    join public.pipeline_stages ps on ps.id = l.stage_id
    where l.id = p_lead_id and ps.board = 'sales'
      and ps.code in ('dead_end','not_interested')
  );
$$;

-- merge_lead_intake: if the target is dead-end, remove the new lead instead of merging.
create or replace function public.merge_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
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

  -- Dead-end target → remove the new lead, do not merge.
  if public.lead_is_dead_end(p_target_lead_id) then
    update public.lead_intake
       set status = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_id;
    return jsonb_build_object('ok', true, 'dropped_dead_end', true);
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
     set status = 'merged', merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end;
$$;

-- lead_intake_auto_merge: same dead-end guard before the auto-append.
create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  enabled boolean;
  lead_matches jsonb;
  target uuid;
  v_block text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  select auto_merge_enabled into enabled
    from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then
    return NEW;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb)
    into lead_matches
    from jsonb_array_elements(NEW.matches) m
   where m->>'match_type' = 'lead';

  if jsonb_array_length(lead_matches) <> 1 then
    return NEW;
  end if;

  target := (lead_matches->0->>'record_id')::uuid;
  if not exists (select 1 from public.leads where id = target) then
    return NEW;
  end if;

  -- Dead-end target → remove the new lead instead of merging.
  if public.lead_is_dead_end(target) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

  v_block := public.format_intake_merge_block(NEW);
  update public.leads
     set intake_log = case
           when coalesce(intake_log, '') = '' then v_block
           else intake_log || E'\n' || v_block
         end,
         updated_at = now()
   where id = target;

  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end;
$$;
