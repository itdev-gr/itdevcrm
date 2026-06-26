-- Add a "Renewal" lane to the ads + social_media boards and route those jobs there on
-- payment (like the SEO boards). Now release_deal_jobs sends web_seo/local_seo/social_media/ads
-- -> 'renewal'; the AI SEO billing parent has no board so it is only unblocked (its
-- web/local children renew). Adding the stage row auto-creates the board column.

insert into public.pipeline_stages (id, board, code, display_names, position, is_terminal, color, archived)
select gen_random_uuid(), b, 'renewal', '{"en":"Renewal","el":"Ανανέωση"}'::jsonb, 15, false,
       (select color from public.pipeline_stages where board='web_seo' and code='renewal' limit 1), false
  from (values ('ads'),('social_media')) as t(b)
 where not exists (select 1 from public.pipeline_stages ps where ps.board = t.b and ps.code = 'renewal');

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j record; v_target uuid;
begin
  for j in
    select id, service_type from public.jobs
     where deal_id = p_deal_id and is_blocked and blocked_reason = 'account_on_hold' and not archived
  loop
    v_target := null;
    if j.service_type in ('web_seo','local_seo','social_media','ads') then
      select ps.id into v_target from public.pipeline_stages ps
       where ps.board = j.service_type and ps.code = 'renewal' and not ps.archived
       limit 1;
    end if;
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
           stage_id = coalesce(v_target, stage_id)
     where id = j.id;
  end loop;
end $$;

-- ROLLBACK:
--   delete from public.pipeline_stages where board in ('ads','social_media') and code='renewal';
--   -- and restore release_deal_jobs from 20260626000010 (social/ads -> 'active').
