-- Social Media board tweaks (owner request 2026-07-29):
-- 1) Rename "Content Plan" -> "Working" / "Σε Εξέλιξη" (code stays content_plan,
--    matching the sales board's working_on_it label convention)
-- 2) Move Done so it sits right before Closed (position 35 -> 55, i.e. after Cancelled)

update public.pipeline_stages
set display_names = '{"en": "Working", "el": "Σε Εξέλιξη"}'::jsonb
where board = 'social_media' and code = 'content_plan';

update public.pipeline_stages
set position = 55
where board = 'social_media' and code = 'done';

-- ROLLBACK:
-- update public.pipeline_stages set display_names = '{"en": "Content Plan", "el": "Πλάνο Περιεχομένου"}'::jsonb where board = 'social_media' and code = 'content_plan';
-- update public.pipeline_stages set position = 35 where board = 'social_media' and code = 'done';
