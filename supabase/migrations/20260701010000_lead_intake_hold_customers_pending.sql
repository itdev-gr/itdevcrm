-- Follow-up to 20260701000000_lead_intake_reengage_merge.sql.
--
-- Change: any intake row that matches an existing customer (match_type
-- 'deal_client', or a lead-table match whose target is in the Won/converted
-- stage) is now HELD as pending in /sales/lead-intake — not merged, not
-- discarded. Admin will build a dedicated workflow later; for now the queue
-- is the review surface.
--
-- BEFORE: deal_client matches were auto-discarded. Historical 333 rows on
-- prod are left as-is (they were correctly categorised under the prior rule).
-- AFTER: same match keeps the row pending so it's visible in the intake
-- queue.

create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_matches jsonb;
  target uuid;
  target_stage_code text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  if exists (
    select 1 from jsonb_array_elements(NEW.matches) m
     where m->>'match_type' = 'deal_client'
  ) then
    return NEW;  -- existing customer → hold pending for admin
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into lead_matches
    from jsonb_array_elements(NEW.matches) m
   where m->>'match_type' = 'lead';
  if jsonb_array_length(lead_matches) <> 1 then
    return NEW;
  end if;

  target := (lead_matches->0->>'record_id')::uuid;

  select ps.code into target_stage_code
    from public.leads l
    join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = target and not l.archived;

  if target_stage_code is null then
    return NEW;
  end if;
  if target_stage_code in ('won', 'converted') then
    return NEW;  -- already a customer → hold pending for admin
  end if;

  perform public.apply_intake_reengage_merge(target, NEW);
  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end $$;

-- ROLLBACK: restore the 20260701000000 body (auto-discards deal_client matches).
