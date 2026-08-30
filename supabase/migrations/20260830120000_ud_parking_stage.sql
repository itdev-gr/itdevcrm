-- 2026-08-30: UD board — «Parking» column, first on the board (position 5,
-- before ud_new_lead at 10). Owner request: a DEAD holding column for the
-- future classic→UD migration, so a bulk import never spawns hundreds of
-- cadence tasks at once. Leads are parked here and dripped into New Lead by
-- hand, at which point the stage-change trigger starts their chain normally.
--
-- Dead by construction, no engine changes needed:
--   * no ud_cadences row has start_stage_code='ud_parking' → entering it
--     starts nothing (ud_start_cadence_run finds no cadence);
--   * entering ANY stage stops a live run first (trg_ud_leads_cadence_upd),
--     so parking a mid-chain lead also silences it;
--   * classic email_sequences match stage CODES and none knows 'ud_parking'.
--
-- The kanban page renders columns straight from pipeline_stages by position,
-- so the column appears with no frontend change.

insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action)
values
  ('under_development', 'ud_parking',
   '{"en": "Parking", "el": "Parking"}'::jsonb, 5, false, null, null)
on conflict (board, code) do nothing;

-- ROLLBACK:
-- delete from public.pipeline_stages where board='under_development' and code='ud_parking';
-- (refuses while leads still sit in the stage — move them first)
