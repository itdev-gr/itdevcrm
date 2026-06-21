-- Cautious auto-merge: when the toggle is on AND a new intake row matches
-- exactly one pipeline lead, append its info to that lead and mark it merged
-- before it ever appears as 'pending'. Anything ambiguous stays pending.
create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql
security definer
set search_path = public
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
    return NEW;  -- 0 or 2+ lead matches → leave for manual review
  end if;

  target := (lead_matches->0->>'record_id')::uuid;
  if not exists (select 1 from public.leads where id = target) then
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
  NEW.reviewed_at := now();  -- reviewed_by stays NULL → "System"
  return NEW;
end;
$$;

drop trigger if exists lead_intake_auto_merge_trg on public.lead_intake;
create trigger lead_intake_auto_merge_trg
  before insert on public.lead_intake
  for each row execute function public.lead_intake_auto_merge();
