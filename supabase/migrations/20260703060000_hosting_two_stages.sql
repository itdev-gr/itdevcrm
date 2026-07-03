-- 2026-07-03: Reduce the Hosting board to two stages — Active + Done — so it can
-- be managed as a simple list. KEEP the terminal stage's code='closed' (deal-close
-- / end-job target it) and only relabel its display to "Done".
begin;

-- Active stays first.
update public.pipeline_stages set position = 10, updated_at = now()
 where board = 'hosting' and code = 'active';

-- Relabel the terminal 'closed' lane to "Done" (code unchanged), make it second.
update public.pipeline_stages
   set display_names = '{"en":"Done","el":"Ολοκληρωμένο"}'::jsonb, position = 20, updated_at = now()
 where board = 'hosting' and code = 'closed';

-- Move every non-archived hosting job off the lanes we are about to retire:
--   setup + on_hold  -> active ;   cancelled -> closed (Done).
update public.jobs set stage_id = (select id from public.pipeline_stages where board='hosting' and code='active'),
       updated_at = now()
 where service_type = 'hosting' and not archived
   and stage_id in (select id from public.pipeline_stages where board='hosting' and code in ('setup','on_hold'));

update public.jobs set stage_id = (select id from public.pipeline_stages where board='hosting' and code='closed'),
       updated_at = now()
 where service_type = 'hosting' and not archived
   and stage_id in (select id from public.pipeline_stages where board='hosting' and code='cancelled');

-- Retire the extra lanes (archive, not delete — preserves history + FKs).
update public.pipeline_stages set archived = true, updated_at = now()
 where board = 'hosting' and code in ('setup','on_hold','cancelled');

commit;

-- ROLLBACK:
--   update public.pipeline_stages set archived=false where board='hosting' and code in ('setup','on_hold','cancelled');
--   update public.pipeline_stages set display_names='{"en":"Closed","el":"Κλειστό"}'::jsonb, position=50 where board='hosting' and code='closed';
--   (job stage moves are left in place; harmless.)
