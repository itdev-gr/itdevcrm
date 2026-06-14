-- =============================================================================
-- Re-align the Web Dev kanban columns to the agency's ClickUp pipeline.
--
-- Old web_dev stages: awaiting_brief, discovery, wireframes, design,
--   development, internal_qa, client_review, revisions, live, maintenance.
-- New web_dev stages (this migration): new_project, client_contact,
--   no_response, get_requirements, planning, development (kept), stuck,
--   revision, redesign, waiting_client_approval, live (kept, terminal).
--
-- Strategy (non-destructive): insert/refresh the new stages, reposition the two
-- kept stages (development, live), remap any existing web_dev jobs off the
-- removed stages onto the closest new stage, then ARCHIVE the removed stages
-- (archived stages drop off the board but keep FK integrity + history).
-- =============================================================================

-- 1. Insert the new columns (idempotent: refresh + un-archive on conflict).
insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action)
values
  ('web_dev', 'new_project',             '{"en": "New Project",              "el": "Νέο Έργο"}'::jsonb,                 10, false, null, null),
  ('web_dev', 'client_contact',          '{"en": "Client Contact",           "el": "Επικοινωνία Πελάτη"}'::jsonb,        20, false, null, null),
  ('web_dev', 'no_response',             '{"en": "Called / No response",     "el": "Κλήση – Χωρίς Απάντηση"}'::jsonb,   30, false, null, null),
  ('web_dev', 'get_requirements',        '{"en": "Get requirements - Creds", "el": "Απαιτήσεις & Κωδικοί"}'::jsonb,      40, false, null, null),
  ('web_dev', 'planning',                '{"en": "Planning",                 "el": "Σχεδιασμός"}'::jsonb,               50, false, null, null),
  ('web_dev', 'stuck',                   '{"en": "Stuck",                    "el": "Κολλημένο"}'::jsonb,                70, false, null, null),
  ('web_dev', 'revision',                '{"en": "Revision",                 "el": "Διόρθωση"}'::jsonb,                 80, false, null, null),
  ('web_dev', 'redesign',                '{"en": "Redesign",                 "el": "Επανασχεδιασμός"}'::jsonb,          90, false, null, null),
  ('web_dev', 'waiting_client_approval', '{"en": "Waiting client Approval",  "el": "Αναμονή Έγκρισης Πελάτη"}'::jsonb, 100, false, null, null)
on conflict (board, code) do update set
  display_names    = excluded.display_names,
  position         = excluded.position,
  is_terminal      = excluded.is_terminal,
  terminal_outcome = excluded.terminal_outcome,
  triggers_action  = excluded.triggers_action,
  archived         = false;

-- 2. Reposition the two kept stages so they sit in the new order.
update public.pipeline_stages
   set position = 60, archived = false
 where board = 'web_dev' and code = 'development';

update public.pipeline_stages
   set position = 110, archived = false
 where board = 'web_dev' and code = 'live';

-- 3. Remap existing web_dev jobs off the removed stages onto the closest new
--    stage, so no job is left pointing at an archived (off-board) column.
with new_stage as (
  select code, id from public.pipeline_stages where board = 'web_dev'
),
old_stage as (
  select code, id from public.pipeline_stages where board = 'web_dev'
),
remap(old_code, new_code) as (
  values
    ('awaiting_brief', 'new_project'),
    ('discovery',      'get_requirements'),
    ('wireframes',     'planning'),
    ('design',         'development'),
    ('internal_qa',    'waiting_client_approval'),
    ('client_review',  'waiting_client_approval'),
    ('revisions',      'revision'),
    ('maintenance',    'live')
)
update public.jobs j
   set stage_id = ns.id
  from remap r
  join old_stage os on os.code = r.old_code
  join new_stage ns on ns.code = r.new_code
 where j.service_type = 'web_dev'
   and j.stage_id = os.id;

-- 4. Archive the removed columns (off the board, FK + history intact).
update public.pipeline_stages
   set archived = true
 where board = 'web_dev'
   and code in ('awaiting_brief', 'discovery', 'wireframes', 'design',
                'internal_qa', 'client_review', 'revisions', 'maintenance');

-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the original web_dev board; the job remap reversal is
-- best-effort — exact pre-migration stage per job is not recorded):
--   -- un-archive originals + restore their positions
--   update public.pipeline_stages set archived = false where board='web_dev'
--     and code in ('awaiting_brief','discovery','wireframes','design',
--                  'internal_qa','client_review','revisions','maintenance');
--   update public.pipeline_stages set position=10  where board='web_dev' and code='awaiting_brief';
--   update public.pipeline_stages set position=20  where board='web_dev' and code='discovery';
--   update public.pipeline_stages set position=30  where board='web_dev' and code='wireframes';
--   update public.pipeline_stages set position=40  where board='web_dev' and code='design';
--   update public.pipeline_stages set position=50  where board='web_dev' and code='development';
--   update public.pipeline_stages set position=60  where board='web_dev' and code='internal_qa';
--   update public.pipeline_stages set position=70  where board='web_dev' and code='client_review';
--   update public.pipeline_stages set position=80  where board='web_dev' and code='revisions';
--   update public.pipeline_stages set position=90  where board='web_dev' and code='live';
--   update public.pipeline_stages set position=100 where board='web_dev' and code='maintenance';
--   -- archive the columns added by this migration
--   update public.pipeline_stages set archived = true where board='web_dev'
--     and code in ('new_project','client_contact','no_response','get_requirements',
--                  'planning','stuck','revision','redesign','waiting_client_approval');
--   -- (jobs remapped to new stages stay there unless manually re-sorted)
-- ---------------------------------------------------------------------------
