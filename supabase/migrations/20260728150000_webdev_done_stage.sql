-- 2026-07-28 (owner request): Web Dev board gains a "Done" column right after
-- Live (position 115, between live=110 and closed=120). Terminal/completed like
-- its neighbours — a delivered project's resting column distinct from Closed.
--
-- Notes checked before adding:
--   * Kanban columns render dynamically from pipeline_stages — no code change.
--   * closeTargets.ts (deal-close lane choice for web_dev: closed|live) untouched.
--   * end_job already skips jobs sitting in code 'done' (20260622220000).
--   * jobs_stamp_done_at (20260727120000) will stamp done_at on entry — harmless
--     for web_dev; the Done->Renewal pull is web_seo/local_seo-scoped.
--   * APPLIED LIVE 2026-07-28 via Mgmt API (idempotent guard below).
--
-- ROLLBACK: update pipeline_stages set archived = true
--           where board='web_dev' and code='done';

insert into pipeline_stages (board, code, display_names, position, color, is_terminal, terminal_outcome)
select 'web_dev', 'done',
       jsonb_build_object('en','Done','el','Ολοκληρώθηκε'),
       115,
       (select color from pipeline_stages where board='web_dev' and code='live' and not archived limit 1),
       true, 'completed'
 where not exists (select 1 from pipeline_stages
                    where board='web_dev' and code='done' and not archived);
