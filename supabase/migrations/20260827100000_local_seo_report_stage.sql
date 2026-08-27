-- 2026-08-27: New "Report" column on the Local SEO kanban, right after
-- Rank Tracking (owner request). Position 65 slots between rank_tracking (60)
-- and new_gbp (70) — no repositioning of existing stages needed. Plain work
-- stage: not terminal, no triggers_action, so renewal/close logic (which keys
-- on renewal/done/closed) is untouched.

insert into public.pipeline_stages (board, code, display_names, position)
select 'local_seo', 'report', '{"el": "Αναφορά", "en": "Report"}'::jsonb, 65
where not exists (
  select 1 from public.pipeline_stages where board = 'local_seo' and code = 'report'
);

-- ROLLBACK (only while no jobs sit on it):
--   delete from public.pipeline_stages where board = 'local_seo' and code = 'report';
