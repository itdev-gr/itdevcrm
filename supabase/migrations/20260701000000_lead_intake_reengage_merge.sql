-- =============================================================================
-- Robust auto-merge at the intake page.
--
-- BEFORE: an intake row matching one existing lead only auto-merged when the
-- 'auto_merge_enabled' toggle was ON (default OFF on prod), only appended info
-- to the target lead, and DID NOT move the target back to Unique Lead. Meta+cold
-- matches were left pending for the admin to reengage manually; dead_end
-- matches were discarded outright. Result: duplicates like 005490 + 005496
-- (Andreas Pitsikoulakis, same email/phone, two different forms 22 minutes
-- apart) landed as SEPARATE leads.
--
-- AFTER: any intake row matching exactly one existing lead auto-merges:
--   1. Fills blanks + adds different email/phone as an additional contact
--      (unchanged behaviour of apply_intake_merge).
--   2. Moves the target lead's stage back to Unique Lead (bypassing the
--      restricted-stage guard via the same app.intake_release GUC that
--      release_lead_intake / reengage_lead_intake already use).
--   3. Enqueues a re-engage welcome email idempotently (only if the standard
--      welcome was already SENT for this lead — matches the reengage RPC).
--   4. Skips (leaves pending) when the target is WON or CONVERTED — those are
--      customers, admin decides what to do.
--   5. Skips when the target is archived — same reason.
--
-- The toggle 'auto_merge_enabled' is now set to TRUE and no longer gates the
-- trigger's core behaviour — the trigger always runs. The column stays for
-- backwards compatibility but has no runtime effect.
-- =============================================================================

-- ── 1. New helper: apply_intake_reengage_merge -------------------------------
create or replace function public.apply_intake_reengage_merge(
  p_lead_id uuid,
  r public.lead_intake
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unique_stage uuid;
begin
  -- (a) Blank-fill + intake_log append + extra-contacts, unchanged.
  perform public.apply_intake_merge(p_lead_id, r);

  -- (b) Stage move to Unique Lead. Bypass the mkifokeris-only restriction
  --     the same way release_lead_intake / reengage_lead_intake do.
  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'sales' and code = 'unique_lead'
   limit 1;

  if v_unique_stage is not null then
    perform set_config('app.intake_release', 'on', true);
    update public.leads
       set stage_id = v_unique_stage,
           updated_at = now()
     where id = p_lead_id
       and stage_id is distinct from v_unique_stage;
  end if;

  -- (c) Re-engage welcome email: only when the standard welcome was already
  --     SENT for this lead (mirrors reengage_lead_intake exactly).
  if exists (
    select 1 from public.email_log
     where dedupe_key = 'lead_welcome:' || p_lead_id and status = 'sent'
  ) then
    perform public.enqueue_lead_email(
      p_lead_id,
      'lead_welcome',
      'lead_welcome:' || p_lead_id || ':reengage:' || r.id
    );
  end if;
end $$;

grant execute on function public.apply_intake_reengage_merge(uuid, public.lead_intake)
  to authenticated;

-- ── 2. Rewrite the auto-merge trigger to always run + reengage ---------------
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

  -- Existing rule: if the row matches an existing DEAL client, discard —
  -- the person is already a customer; a fresh lead card would be noise.
  if exists (
    select 1 from jsonb_array_elements(NEW.matches) m
     where m->>'match_type' = 'deal_client'
  ) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

  -- Isolate LEAD matches; only auto-act on the exactly-one case.
  select coalesce(jsonb_agg(m), '[]'::jsonb) into lead_matches
    from jsonb_array_elements(NEW.matches) m
   where m->>'match_type' = 'lead';
  if jsonb_array_length(lead_matches) <> 1 then
    return NEW;  -- 0 matches → auto_release handles it; 2+ → admin decides
  end if;

  target := (lead_matches->0->>'record_id')::uuid;

  -- Target must exist AND not be archived AND not already a customer.
  select ps.code into target_stage_code
    from public.leads l
    join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = target and not l.archived;

  if target_stage_code is null then
    return NEW;  -- archived or missing → leave pending for admin
  end if;
  if target_stage_code in ('won', 'converted') then
    return NEW;  -- already a customer → admin reviews manually
  end if;

  -- Everything else (unique_lead, working_on_it, scheduled, offer_sent,
  -- no_answer, not_interested, dead_end, constant_na, …) → merge + reengage.
  perform public.apply_intake_reengage_merge(target, NEW);
  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end $$;

-- Trigger already exists (defined in 20260621120300); the CREATE OR REPLACE
-- above swapped the function body. No trigger DDL needed here.

-- ── 3. Route manual merge (admin button) through the reengage helper too ----
-- merge_lead_intake previously just called apply_intake_merge. Now it also
-- reengages so manual and auto behave identically.
create or replace function public.merge_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_target_stage_code text;
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
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_pending'));
  end if;

  select exists (
    select 1 from jsonb_array_elements(r.matches) m
     where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_a_match'));
  end if;

  select ps.code into v_target_stage_code
    from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = p_target_lead_id and not l.archived;
  if v_target_stage_code is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_missing_or_archived'));
  end if;

  -- Won/converted: still merge the info in (admin explicitly chose this) but
  -- do NOT move the stage; the customer stays where they are.
  if v_target_stage_code in ('won', 'converted') then
    perform public.apply_intake_merge(p_target_lead_id, r);
  else
    perform public.apply_intake_reengage_merge(p_target_lead_id, r);
  end if;

  update public.lead_intake
     set status = 'merged',
         merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end $$;

-- ── 4. Reengage RPC is now a thin wrapper for backwards compatibility -------
-- The frontend "Reengage cold lead" button still calls this. Route it through
-- the shared helper for consistency; the target-must-be-cold guard is now
-- moot (any non-customer stage reengages), so it's dropped.
create or replace function public.reengage_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_target_stage_code text;
  v_is_lead_match boolean;
begin
  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['not_found']);
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', array['not_pending']);
  end if;

  select exists (
    select 1 from jsonb_array_elements(r.matches) m
     where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', array['not_a_match']);
  end if;

  select ps.code into v_target_stage_code
    from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
   where l.id = p_target_lead_id and not l.archived;
  if v_target_stage_code is null then
    return jsonb_build_object('ok', false, 'errors', array['target_missing_or_archived']);
  end if;
  if v_target_stage_code in ('won', 'converted') then
    return jsonb_build_object('ok', false, 'errors', array['target_is_customer']);
  end if;

  perform public.apply_intake_reengage_merge(p_target_lead_id, r);

  update public.lead_intake
     set status = 'merged',
         merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end $$;

-- ── 5. Turn on the (now legacy) toggle so any old code path that still checks
-- it also permits the behaviour. The trigger no longer consults it, but we
-- flip the flag defensively.
update public.lead_distribution_state
   set auto_merge_enabled = true,
       updated_at = now()
 where id = true;

-- ── 6. One-shot fix for the concrete 005490 / 005496 pair. -------------------
-- Move 005496's info into 005490, archive 005496.
do $$
declare
  v_target uuid := '125acb4e-8a04-4651-8f40-b28793e09419'::uuid;  -- 005490
  v_source uuid := '24bffc76-ff8e-4261-983b-00f6576b9d3d'::uuid;  -- 005496
  v_source_intake_id uuid;
  r public.lead_intake;
begin
  -- Find the intake row that released to 005496 (Social Media form).
  select id into v_source_intake_id
    from public.lead_intake
   where released_lead_id = v_source
   limit 1;

  if v_source_intake_id is not null then
    select * into r from public.lead_intake where id = v_source_intake_id;
    -- Merge the intake's info into 005490 and reengage.
    perform public.apply_intake_reengage_merge(v_target, r);
    -- Retag the intake row so it points to 005490.
    update public.lead_intake
       set status = 'merged',
           merged_into_lead_id = v_target,
           released_lead_id = null
     where id = v_source_intake_id;
  end if;

  -- Archive 005496 as a duplicate of 005490.
  update public.leads
     set archived = true,
         archived_at = now(),
         archived_reason = 'duplicate_merge_20260701'
   where id = v_source
     and archived = false;
end $$;

-- =============================================================================
-- CHANGES / REVERT
--   + public.apply_intake_reengage_merge(uuid, public.lead_intake) NEW
--   ~ public.lead_intake_auto_merge() body rewritten (always on, reengages)
--   ~ public.merge_lead_intake(uuid, uuid) routes non-customer targets through
--     reengage helper
--   ~ public.reengage_lead_intake(uuid, uuid) drops cold-only guard; any
--     non-customer non-archived match reengages
--   ~ lead_distribution_state.auto_merge_enabled = true (defensive)
--   ~ leads 005496 archived_reason=duplicate_merge_20260701; its intake row
--     retagged merged→005490
--
-- ROLLBACK:
--   -- Restore prior function bodies:
--   --   lead_intake_auto_merge  → body from 20260623130000 (Meta/cold guard version)
--   --   merge_lead_intake        → body from 20260622110000 (calls apply_intake_merge)
--   --   reengage_lead_intake     → body from 20260623130000 (cold-only)
--   drop function if exists public.apply_intake_reengage_merge(uuid, public.lead_intake);
--   update public.lead_distribution_state set auto_merge_enabled = false where id = true;
--   -- Un-archive 005496:
--   update public.leads set archived=false, archived_at=null, archived_reason=null
--    where id = '24bffc76-ff8e-4261-983b-00f6576b9d3d';
--   -- The intake_log append on 005490 stays (idempotent-ish; no easy revert).
-- =============================================================================
