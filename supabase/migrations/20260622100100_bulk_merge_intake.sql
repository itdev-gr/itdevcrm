-- Count of pending rows that are single-lead-match, split by mergeable vs dead-end.
create or replace function public.bulk_merge_intake_preview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_mergeable int; v_dead int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;
  with pend as (
    select
      (select count(*) from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead') as lead_cnt,
      (select (m->>'record_id')::uuid from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead' limit 1) as target
    from public.lead_intake li
    where li.status = 'pending'
  ),
  single as (
    select
      exists (select 1 from public.leads l where l.id = p.target) as lead_exists,
      public.lead_is_dead_end(p.target) as is_dead
    from pend p
    where p.lead_cnt = 1
  )
  select
    count(*) filter (where lead_exists and not is_dead),
    count(*) filter (where lead_exists and is_dead)
  into v_mergeable, v_dead
  from single;
  return jsonb_build_object('ok', true, 'mergeable', coalesce(v_mergeable,0), 'dead_end', coalesce(v_dead,0));
end;
$$;
grant execute on function public.bulk_merge_intake_preview() to authenticated;

-- Merge every clear-cut (single-lead-match) pending row; dead-end targets are removed.
create or replace function public.bulk_merge_intake()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_block text;
  v_merged int := 0;
  v_dropped int := 0;
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
      v_block := public.format_intake_merge_block(r.row);
      update public.leads
         set intake_log = case
               when coalesce(intake_log, '') = '' then v_block
               else intake_log || E'\n' || v_block
             end,
             updated_at = now()
       where id = r.target;
      update public.lead_intake
         set status = 'merged', merged_into_lead_id = r.target,
             reviewed_by = auth.uid(), reviewed_at = now()
       where id = r.intake_id;
      v_merged := v_merged + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'merged', v_merged, 'dropped', v_dropped);
end;
$$;
grant execute on function public.bulk_merge_intake() to authenticated;
