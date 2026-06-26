-- "Done" = monthly rest, NOT terminal. Make existing Done non-terminal (web/local SEO) and
-- add a Done lane to ads + social_media (after Active, pos 35).
update public.pipeline_stages set is_terminal = false
 where board in ('web_seo','local_seo') and code = 'done';

insert into public.pipeline_stages (id, board, code, display_names, position, is_terminal, color, archived)
select gen_random_uuid(), b, 'done', '{"en":"Done","el":"Ολοκληρώθηκε"}'::jsonb, 35, false,
       (select color from public.pipeline_stages where board='web_seo' and code='done' limit 1), false
  from (values ('ads'),('social_media')) as t(b)
 where not exists (select 1 from public.pipeline_stages ps where ps.board=t.b and ps.code='done');

-- ROLLBACK: update pipeline_stages set is_terminal=true where board in ('web_seo','local_seo') and code='done';
--   delete from pipeline_stages where board in ('ads','social_media') and code='done';
