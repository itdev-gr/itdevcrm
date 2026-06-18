-- Local SEO gets its own "Closed" terminal lane (added last; local_seo has no
-- "Blocked" column). When accounting closes a deal, its local_seo jobs land here
-- instead of "Done" — see closeTargetCode() in src/features/accounting/closeTargets.ts.
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome)
values ('local_seo', 'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb, 110, true, 'completed')
on conflict (board, code) do nothing;

-- Move the local_seo jobs already under accounting-"Closed" deals from Done → Closed.
update public.jobs j
   set stage_id = ls_closed.id
  from public.pipeline_stages ls_closed,
       public.pipeline_stages ls_done,
       public.deals d,
       public.pipeline_stages acs
 where ls_closed.board = 'local_seo' and ls_closed.code = 'closed'
   and ls_done.board = 'local_seo' and ls_done.code = 'done'
   and d.id = j.deal_id
   and acs.id = d.accounting_stage_id and acs.code = 'closed'
   and j.stage_id = ls_done.id
   and not d.archived and not j.archived;

-- ROLLBACK:
-- update public.jobs j set stage_id = ls_done.id
--   from public.pipeline_stages ls_closed, public.pipeline_stages ls_done
--  where ls_closed.board='local_seo' and ls_closed.code='closed'
--    and ls_done.board='local_seo' and ls_done.code='done' and j.stage_id = ls_closed.id;
-- delete from public.pipeline_stages where board='local_seo' and code='closed';
