-- Customer duplicates: if a new incoming lead duplicates an existing CUSTOMER
-- (a client with deals — match_type 'deal_client'), we don't process it — discard
-- it. Applied at intake (toggle-independent), plus a one-time cleanup of the
-- already-queued ones. Lead-vs-lead auto-merge stays toggle-gated as before.
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

  -- Existing customer re-submission → discard (we don't care about these for now).
  if exists (
    select 1 from jsonb_array_elements(NEW.matches) m where m->>'match_type' = 'deal_client'
  ) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

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

-- One-time cleanup: discard pending rows that duplicate an existing customer.
update public.lead_intake
   set status = 'discarded', reviewed_at = now()
 where status = 'pending'
   and exists (select 1 from jsonb_array_elements(matches) m where m->>'match_type' = 'deal_client');
