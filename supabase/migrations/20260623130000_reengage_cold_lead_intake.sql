-- 20260623130000_reengage_cold_lead_intake.sql
-- =============================================================================
-- Re-engage an existing COLD lead from a Meta intake duplicate, instead of
-- creating a new lead. Moves the cold lead to Unique Lead, appends the new
-- submission to its intake_log, resolves the intake row. Adds no accounting.
-- =============================================================================

-- Which of the given lead ids are currently in a COLD stage (4 stages).
create or replace function public.lead_cold_ids(p_ids uuid[])
returns table(id uuid)
language sql stable security definer set search_path = public as $$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and ps.board = 'sales'
    and ps.code in ('dead_end', 'not_interested', 'no_answer', 'constant_na');
$$;

create or replace function public.reengage_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.lead_intake;
  v_unique uuid;
begin
  select * into r from public.lead_intake where id = p_id;
  if r is null then return jsonb_build_object('ok', false, 'errors', array['not_found']); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'errors', array['not_pending']); end if;

  -- target must be one of this row's LEAD matches
  if not exists (
    select 1 from jsonb_array_elements(r.matches) m
    where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) then
    return jsonb_build_object('ok', false, 'errors', array['not_a_match']);
  end if;

  -- target must currently be in a cold stage
  if not exists (select 1 from public.lead_cold_ids(array[p_target_lead_id])) then
    return jsonb_build_object('ok', false, 'errors', array['not_cold']);
  end if;

  select id into v_unique from public.pipeline_stages where board = 'sales' and code = 'unique_lead' limit 1;

  -- bypass the restricted-stage trigger (same mechanism as release_lead_intake)
  perform set_config('app.intake_release', 'on', true);
  update public.leads
     set stage_id = v_unique,
         intake_log = case
           when coalesce(intake_log, '') = '' then public.format_intake_merge_block(r)
           else intake_log || E'\n' || public.format_intake_merge_block(r)
         end,
         updated_at = now()
   where id = p_target_lead_id;

  -- Welcome: the stage move auto-enqueues lead_welcome:<id> (deduped if already
  -- sent). To honour "resend" for an already-welcomed lead, enqueue once more with
  -- a re-engage key, but ONLY when the standard welcome was already SENT — so a
  -- never-welcomed lead still gets exactly one (from the stage move).
  if exists (
    select 1 from public.email_log where dedupe_key = 'lead_welcome:' || p_target_lead_id and status = 'sent'
  ) then
    perform public.enqueue_lead_email(
      p_target_lead_id, 'lead_welcome',
      'lead_welcome:' || p_target_lead_id || ':reengage:' || r.id);
  end if;

  update public.lead_intake
     set status = 'released', released_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end $$;

-- Auto-merge guard: keep Meta rows matching a cold lead PENDING (so the admin can
-- re-engage on Release), even if auto-merge is turned on. Full body re-stated with
-- the one new guard inserted after the single-target existence check.
create or replace function public.lead_intake_auto_merge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  enabled boolean;
  lead_matches jsonb;
  target uuid;
begin
  if NEW.status <> 'pending' then return NEW; end if;

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

  -- Meta re-submission matching a cold lead is handled by manual re-engage on
  -- Release; leave it pending so the admin sees it.
  if NEW.source = 'meta' and exists (select 1 from public.lead_cold_ids(array[target])) then
    return NEW;
  end if;

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
end $$;

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop function if exists public.reengage_lead_intake(uuid, uuid);
--   drop function if exists public.lead_cold_ids(uuid[]);
--   -- restore the previous lead_intake_auto_merge body (without the Meta/cold guard):
--   create or replace function public.lead_intake_auto_merge() returns trigger
--   language plpgsql security definer set search_path = public as $$
--   declare enabled boolean; lead_matches jsonb; target uuid;
--   begin
--     if NEW.status <> 'pending' then return NEW; end if;
--     if exists (select 1 from jsonb_array_elements(NEW.matches) m where m->>'match_type'='deal_client')
--       then NEW.status:='discarded'; NEW.reviewed_at:=now(); return NEW; end if;
--     select auto_merge_enabled into enabled from public.lead_distribution_state where id=true;
--     if not coalesce(enabled,false) then return NEW; end if;
--     select coalesce(jsonb_agg(m),'[]'::jsonb) into lead_matches
--       from jsonb_array_elements(NEW.matches) m where m->>'match_type'='lead';
--     if jsonb_array_length(lead_matches)<>1 then return NEW; end if;
--     target := (lead_matches->0->>'record_id')::uuid;
--     if not exists (select 1 from public.leads where id=target) then return NEW; end if;
--     if public.lead_is_dead_end(target) then NEW.status:='discarded'; NEW.reviewed_at:=now(); return NEW; end if;
--     perform public.apply_intake_merge(target, NEW);
--     NEW.status:='merged'; NEW.merged_into_lead_id:=target; NEW.reviewed_at:=now(); return NEW;
--   end $$;
-- ---------------------------------------------------------------------------
