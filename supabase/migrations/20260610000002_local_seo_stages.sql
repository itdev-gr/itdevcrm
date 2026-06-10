-- =============================================================================
-- Local SEO board: replace the generic stages with the team's real workflow.
-- See docs/superpowers/specs/2026-06-10-local-seo-stages-design.md.
--
-- Old stages are archived (not deleted) so historical references stay valid;
-- live jobs are remapped to the closest new stage.
--
-- Rollback:
--   with old as (select code, id from public.pipeline_stages
--                where board = 'local_seo' and archived = true)
--   update public.jobs j set stage_id = old.id
--   from old, public.pipeline_stages cur
--   where j.stage_id = cur.id and cur.board = 'local_seo' and cur.archived = false
--     and old.code = case cur.code
--       when 'new_project' then 'onboarding'
--       when 'new_gbp' then 'gbp_setup'
--       when 'optimize' then 'active'
--       when 'suspended' then 'on_hold'
--       when 'done' then 'cancelled'
--       else 'onboarding' end;
--   delete from public.pipeline_stages where board = 'local_seo' and archived = false
--     and code in ('new_project','renewal','called_no_response','send_form',
--                  'optimize','rank_tracking','new_gbp','done','suspended','verification');
--   update public.pipeline_stages set archived = false
--     where board = 'local_seo'
--       and code in ('onboarding','gbp_setup','active','on_hold','cancelled');
-- =============================================================================

-- 1. New stages (Blocked is intentionally NOT a stage: the kanban renders a
--    virtual Blocked column from jobs.is_blocked).
insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action)
values
  ('local_seo', 'new_project',        '{"en": "New project",        "el": "Νέο Έργο"}'::jsonb,                 10, false, null,        null),
  ('local_seo', 'renewal',            '{"en": "Renewal",            "el": "Ανανέωση"}'::jsonb,                 20, false, null,        null),
  ('local_seo', 'called_no_response', '{"en": "Called/No response", "el": "Κλήση/Χωρίς Απάντηση"}'::jsonb,     30, false, null,        null),
  ('local_seo', 'send_form',          '{"en": "Send form",          "el": "Αποστολή Φόρμας"}'::jsonb,          40, false, null,        null),
  ('local_seo', 'optimize',           '{"en": "Optimize",           "el": "Βελτιστοποίηση"}'::jsonb,           50, false, null,        null),
  ('local_seo', 'rank_tracking',      '{"en": "Rank tracking",      "el": "Παρακολούθηση Κατάταξης"}'::jsonb,  60, false, null,        null),
  ('local_seo', 'new_gbp',            '{"en": "New GBP",            "el": "Νέο GBP"}'::jsonb,                  70, false, null,        null),
  ('local_seo', 'done',               '{"en": "Done",               "el": "Ολοκληρωμένο"}'::jsonb,             80, true,  'completed', null),
  ('local_seo', 'suspended',          '{"en": "Suspended",          "el": "Σε Αναστολή"}'::jsonb,              90, false, null,        null),
  ('local_seo', 'verification',       '{"en": "Verification",       "el": "Επαλήθευση"}'::jsonb,              100, false, null,        null);

-- 2. Remap live jobs old → new.
with mapping(old_code, new_code) as (
  values ('onboarding', 'new_project'),
         ('gbp_setup',  'new_gbp'),
         ('active',     'optimize'),
         ('on_hold',    'suspended'),
         ('cancelled',  'done')
)
update public.jobs j
set stage_id = new_stage.id
from public.pipeline_stages old_stage
join mapping on mapping.old_code = old_stage.code
join public.pipeline_stages new_stage
  on new_stage.board = 'local_seo' and new_stage.code = mapping.new_code and new_stage.archived = false
where j.stage_id = old_stage.id
  and old_stage.board = 'local_seo'
  and old_stage.archived = false;

-- 3. Archive the old stages.
update public.pipeline_stages
set archived = true
where board = 'local_seo'
  and code in ('onboarding', 'gbp_setup', 'active', 'on_hold', 'cancelled');
