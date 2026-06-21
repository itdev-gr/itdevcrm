-- The pending backlog is large (thousands of single-match rows). The `authenticated`
-- role has statement_timeout=8s, so merging all of them in one transaction would time
-- out and roll back. Make bulk_merge_intake process a bounded batch and report how many
-- mergeable rows remain, so the client can loop batches until done.
drop function if exists public.bulk_merge_intake();

create or replace function public.bulk_merge_intake(p_limit int default 200)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_block text;
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
      continue;  -- no valid target; leave for manual handling (excluded from remaining)
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

  -- Remaining processable rows: pending, single-lead-match, target still exists.
  with pend as (
    select
      (select count(*) from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead') as lead_cnt,
      (select (m->>'record_id')::uuid from jsonb_array_elements(li.matches) m where m->>'match_type' = 'lead' limit 1) as target
    from public.lead_intake li
    where li.status = 'pending'
  )
  select count(*) into v_remaining
  from pend p
  where p.lead_cnt = 1 and exists (select 1 from public.leads l where l.id = p.target);

  return jsonb_build_object('ok', true, 'merged', v_merged, 'dropped', v_dropped, 'remaining', v_remaining);
end;
$$;
grant execute on function public.bulk_merge_intake(int) to authenticated;
