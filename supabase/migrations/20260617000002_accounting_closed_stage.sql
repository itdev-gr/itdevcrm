-- New visible "Closed" column on the accounting board, for customers whose
-- ClickUp list-status was "done" (delivered/closed). Distinct from the existing
-- 'done' stage (which archives the deal off the board); 'closed' keeps it visible
-- and does NOT change client status (it's not in the client-status sync trigger map).
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, archived)
select 'accounting_onboarding', 'closed', '{"en": "Closed", "el": "Κλειστό"}'::jsonb, 90, false, false
where not exists (
  select 1 from public.pipeline_stages where board = 'accounting_onboarding' and code = 'closed'
);

-- ROLLBACK:
-- delete from public.pipeline_stages where board='accounting_onboarding' and code='closed';
