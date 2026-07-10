-- =============================================================================
-- Add a "Sent to Dev" column to the Web SEO kanban (per user request 2026-07-10).
--
-- Position 180: after Done (160) and Closed (170), so it renders as the LAST
-- real column, right before the virtual Blocked column (which the board always
-- renders after all pipeline_stages columns). Non-terminal, no triggers_action —
-- moving a card here completes nothing and fires no automation. Applies to
-- ai_seo jobs too (they canonically live on web_seo stages).
--
-- Same idempotent pattern as 20260615000002_web_seo_kanban_clickup_stages.
-- =============================================================================

insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action)
values
  ('web_seo', 'sent_to_dev', '{"en": "Sent to Dev", "el": "Sent to Dev"}'::jsonb, 180, false, null, null)
on conflict (board, code) do update set
  display_names    = excluded.display_names,
  position         = excluded.position,
  is_terminal      = excluded.is_terminal,
  terminal_outcome = excluded.terminal_outcome,
  triggers_action  = excluded.triggers_action,
  archived         = false;

-- ---------------------------------------------------------------------------
-- ROLLBACK (archive the column off the board; remap any jobs sitting on it
-- back to 'done' first so no cards vanish):
--   update public.jobs j
--      set stage_id = (select id from public.pipeline_stages
--                       where board = 'web_seo' and code = 'done')
--    where j.stage_id = (select id from public.pipeline_stages
--                         where board = 'web_seo' and code = 'sent_to_dev');
--   update public.pipeline_stages set archived = true
--    where board = 'web_seo' and code = 'sent_to_dev';
-- ---------------------------------------------------------------------------
