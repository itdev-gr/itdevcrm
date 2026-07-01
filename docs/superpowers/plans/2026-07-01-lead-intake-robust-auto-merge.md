# Robust Lead Intake Auto-Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a new Meta / CSV / imported lead arrives at `/sales/lead-intake` and matches an existing lead by email or phone, automatically (1) append the new form's info to the existing lead's `intake_log` and blank fields, and (2) move the existing lead back to the **Unique Lead** stage — except when the existing lead is already a customer (won / converted / archived), in which case the intake stays pending for admin review.

**Architecture:** DB-only. One new SQL helper (`apply_intake_reengage_merge`) that combines the existing `apply_intake_merge` behavior with a stage move to Unique Lead + welcome-email idempotency. Rewrite the existing `lead_intake_auto_merge` trigger to call the helper on any 1-match case, drop the `auto_merge_enabled` toggle gate (always on), and unify the special cases (Meta+cold, dead_end, non-meta) into one code path. No frontend change — the `/sales/lead-intake` page already surfaces `pending`, `merged`, `discarded` rows; auto-merged rows land in `merged` immediately.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, no application-tier change.

**Reference:** concrete example — leads `005490` (Website form) and `005496` (Social Media form) on prod, both for Andreas Pitsikoulakis (`apitsikoulakis@welcome-home.gr` / `306932414119`), created 15 seconds apart on 2026-06-30 (both released as separate leads because `auto_merge_enabled=false` on prod).

---

## File map

- **Create:** `supabase/migrations/20260701000000_lead_intake_reengage_merge.sql` — new helper `apply_intake_reengage_merge()` + rewrite trigger `lead_intake_auto_merge` + rewrite RPCs `merge_lead_intake` / `reengage_lead_intake` to route through helper + flip `auto_merge_enabled=true` + one-shot fix for 005490/005496.
- **No frontend changes.** The intake page (`src/features/leads/LeadIntakePage.tsx`) already shows merged rows in its "Merged" tab; behavior is preserved.

The whole change fits in ONE migration file so it applies atomically. No new tests can be added (the codebase has no pg-level test framework); verification is via SQL smoke queries on prod after apply.

---

## Task 1: Write and commit the migration

**Files:**
- Create: `supabase/migrations/20260701000000_lead_intake_reengage_merge.sql`

- [ ] **Step 1.1: Read the existing helpers so the new one composes correctly**

Skim (don't re-read if already fresh):
- `supabase/migrations/20260622110000_merge_fill_blanks_and_extra_contacts.sql` — defines `apply_intake_merge(p_lead_id, r)` (fills blanks + adds extra contacts + appends intake_log block). This is UNCHANGED — the new helper wraps around it.
- `supabase/migrations/20260623130000_reengage_cold_lead_intake.sql` — defines `reengage_lead_intake(p_id, p_target)` and the current `lead_intake_auto_merge` trigger body.
- `supabase/migrations/20260621120200_merge_lead_intake.sql` — defines `merge_lead_intake(p_id, p_target)` (admin manual merge).

- [ ] **Step 1.2: Create the migration file with the exact content below**

Save to `supabase/migrations/20260701000000_lead_intake_reengage_merge.sql`:

```sql
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
```

- [ ] **Step 1.3: Commit the file (do NOT push or apply yet)**

```bash
git add supabase/migrations/20260701000000_lead_intake_reengage_merge.sql
git commit -m "feat(leads): auto-merge duplicate intake rows + reengage target to Unique Lead

Rewrites the lead_intake_auto_merge trigger so any incoming intake row
that matches exactly one existing lead auto-merges (append info + move to
Unique Lead), except when the target is already a customer (won/converted/
archived) which stays pending for admin review. Drops the auto_merge_enabled
toggle gate, unifies the Meta+cold and dead_end special cases into one
code path, and includes a one-shot fix for the concrete 005490/005496 case.

No frontend changes — the intake page already surfaces merged rows in its
Merged tab."
```

- [ ] **Step 1.4: Verify build is unaffected** (this migration is pure SQL, no TS impact, but sanity check)

```bash
npm run build
```

Expected: PASS.

---

## Task 2: Apply the migration to prod

Per memory `[project_job_codes]`, prod DDL is applied via the Supabase Management API (with an explicit user-shared sbp token authorizing) or via MCP. The migration is authored in one file that must apply atomically.

- [ ] **Step 2.1: Confirm the sbp token from the user**

Ask the user for a fresh `sbp_` token (they typically re-share; remind to rotate after).

- [ ] **Step 2.2: Snapshot pre-state (for after-comparison)**

```bash
export SBP_TOKEN=<token>
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select auto_merge_enabled from public.lead_distribution_state where id=true;"}'
```

Expected: `[{"auto_merge_enabled":false}]`

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select id, code, stage_id, archived from public.leads where code in ('005490','005496');"}'
```

Expected: both rows returned, both `archived=false`.

- [ ] **Step 2.3: Apply the migration in one POST**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json; print(json.dumps({'query': open('supabase/migrations/20260701000000_lead_intake_reengage_merge.sql').read()}))")
```

Expected: `[]` (empty result set on success). If the classifier blocks, message the user for explicit authorization and retry.

---

## Task 3: Verify on prod

- [ ] **Step 3.1: Confirm the new helper + trigger body**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select (select count(*) from pg_proc where proname='apply_intake_reengage_merge') as helper, (select prosrc from pg_proc where proname='lead_intake_auto_merge') ~ 'apply_intake_reengage_merge' as trigger_wired;"}'
```

Expected: `helper=1`, `trigger_wired=true`.

- [ ] **Step 3.2: Confirm the 005490/005496 fix landed**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select id, code, archived, archived_reason from public.leads where code in ('005490','005496');"}'
```

Expected:
- `005490` → `archived=false`
- `005496` → `archived=true, archived_reason=duplicate_merge_20260701`

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select id, intake_log, stage_id from public.leads where id='125acb4e-8a04-4651-8f40-b28793e09419';"}'
```

Expected: `intake_log` now contains both the Website form block AND the Social Media form block. `stage_id` = Unique Lead.

- [ ] **Step 3.3: Live-inject a synthetic duplicate to confirm the trigger fires**

Pick any active lead's `id` from prod and use its `email` in a synthetic intake insert:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"insert into public.lead_intake (source, email, phone, title, source_data, matches) values ('meta', (select email from public.leads where email is not null and not archived limit 1), null, 'synthetic-test', '{}'::jsonb, (select jsonb_build_array(jsonb_build_object('match_type','lead','record_id',id,'display_name','test','matched_field','email','matched_email',email,'matched_phone',phone,'context','Unique Lead')) from public.leads where email is not null and not archived limit 1)) returning id, status, merged_into_lead_id;"}'
```

Expected: the returned row has `status='merged'` and `merged_into_lead_id` = the target lead id. This proves the trigger fires at insert time without any admin action.

- [ ] **Step 3.4: Clean up the synthetic row**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"delete from public.lead_intake where title='synthetic-test';"}'
```

Expected: 1 row deleted.

- [ ] **Step 3.5: Reverse the intake_log append from the synthetic test**

The synthetic test appended a block to the target lead's `intake_log`. Trim it back:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"update public.leads set intake_log = regexp_replace(intake_log, E'\\n?[^\\n]*synthetic-test[^\\n]*(\\n[^\\n]+)*', '') where intake_log ilike '%synthetic-test%' returning id;"}'
```

Expected: 1 row updated.

---

## Task 4: Push and update memory

- [ ] **Step 4.1: Push the migration commit**

```bash
git push origin main
```

- [ ] **Step 4.2: Update memory `reference_lead_dedup_stranding`**

Append a short note that auto-merge is now unconditional and reengages target to Unique Lead unless the target is a customer.

- [ ] **Step 4.3: Update memory `project_meta_cold_lead_reengage`**

Note that the cold-only reengage path was generalized — any non-customer non-archived match now reengages.

- [ ] **Step 4.4: Add a new memory entry `feedback_auto_merge_always_on`**

Save the user's directive: "when we detect duplication, always add info to existing lead + move to Unique Lead. Do it robustly at intake." So future changes don't accidentally reintroduce the toggle gate.

---

## Task 5: Ask user to smoke test one real scenario

- [ ] **Step 5.1: Request user verification via the UI**

Ask user to:
1. Open `/sales/lead-intake`.
2. Confirm that any pending row that arrived with a match now auto-merges (check the Merged tab for recent rows).
3. Send themselves a test Meta lead using an email that matches an existing lead (or wait for the next real one) — confirm it auto-merges + moves target to Unique Lead.

- [ ] **Step 5.2: Remind user to rotate the sbp token**

The token is in scrollback.

---

## Self-review checklist

- [x] Every task specifies the exact file path and full SQL body (no placeholders).
- [x] The new helper `apply_intake_reengage_merge` is defined before it's called by the trigger and RPCs (same migration, order preserved).
- [x] Types + names are consistent: `apply_intake_reengage_merge(uuid, public.lead_intake)` is the same signature every task references.
- [x] Won/converted/archived target is a hard guard in ALL three entry points (trigger, merge_lead_intake, reengage_lead_intake). No entry point can move a customer back to Unique Lead.
- [x] The `auto_merge_enabled` toggle is defensively set to true (in case older frontend code still reads it), but the trigger body no longer gates on it.
- [x] Rollback SQL is included at the bottom of the migration file, with file references (e.g. "restore body from 20260623130000").
- [x] Manual verification steps are concrete and runnable, no "check the UI" without saying what to check.
- [x] The one-shot fix for 005490/005496 is scoped, idempotent (`if v_source_intake_id is not null`), and included in the same migration so it can't be forgotten.
