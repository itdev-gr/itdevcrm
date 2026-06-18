-- Web SEO gets its own "Closed" terminal lane (added last, after "Done"). When
-- accounting closes a deal, its web_seo jobs land here instead of "Done" — see
-- closeTargetCode() in src/features/accounting/closeTargets.ts.
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome)
values ('web_seo', 'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb, 170, true, 'completed')
on conflict (board, code) do nothing;

-- Move the web_seo jobs already under accounting-"Closed" deals from Done → Closed.
update public.jobs j
   set stage_id = ws_closed.id
  from public.pipeline_stages ws_closed,
       public.pipeline_stages ws_done,
       public.deals d,
       public.pipeline_stages acs
 where ws_closed.board = 'web_seo' and ws_closed.code = 'closed'
   and ws_done.board = 'web_seo' and ws_done.code = 'done'
   and d.id = j.deal_id
   and acs.id = d.accounting_stage_id and acs.code = 'closed'
   and j.stage_id = ws_done.id
   and not d.archived and not j.archived;

-- ROLLBACK:
-- update public.jobs j set stage_id = ws_done.id
--   from public.pipeline_stages ws_closed, public.pipeline_stages ws_done
--  where ws_closed.board='web_seo' and ws_closed.code='closed'
--    and ws_done.board='web_seo' and ws_done.code='done' and j.stage_id = ws_closed.id;
-- delete from public.pipeline_stages where board='web_seo' and code='closed';
