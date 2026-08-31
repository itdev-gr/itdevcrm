-- =============================================================================
-- 2026-08-31: Bell mentions on deal channel threads (deal_dev/seo/ads/social)
-- land technical users on «You don't have access to this deal»: the payload
-- carries only the DEAL id, readPath() routes to /deals/<id>, and deals RLS
-- (20260503000022) admits only admin/accounting/deal-owner. The identical
-- problem was fixed for task notifications in June (20260630000000 —
-- payload.target_job_id → /jobs/<id>) but never applied to mention fanout.
--
-- Fix: the fanout resolves the deal's job matching the channel (same mapping
-- as jobCommentThread/task_target_job_id) and stores target_job_id in the
-- payload; the frontend routes technical-only recipients to /jobs/<id>, where
-- the SAME channel thread renders and jobs RLS admits them. Existing mention
-- notifications are backfilled so the already-broken bell entries heal.
--
-- Redefines fanout_mention_notifications — live base 20260716100000,
-- pre-md5 09b069078e06539ae0486c394fa2105f (pulled 2026-08-31); body verbatim
-- except the marked additions.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fanout_mention_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  author_name text;
  parent_label text;
  target_job uuid; -- 2026-08-31: deal-channel mentions carry the matching job
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;

  select coalesce(nullif(p.full_name, ''), p.email)
    into author_name
    from public.profiles p where p.user_id = new.author_id;

  if new.parent_type = 'lead' then
    select coalesce(
      nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''),
      l.company_name,
      l.title
    )
      into parent_label
      from public.leads l where l.id = new.parent_id;
  elsif new.parent_type = 'client' then
    select c.name into parent_label from public.clients c where c.id = new.parent_id;
  elsif new.parent_type = 'deal' then
    select d.title into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_dev' then
    select d.title || ' — Dev' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_seo' then
    select d.title || ' — SEO' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_ads' then
    select d.title || ' — Ads' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_social' then
    select d.title || ' — Social' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'job' then
    select j.service_type into parent_label from public.jobs j where j.id = new.parent_id;
  end if;

  foreach uid in array new.mentioned_user_ids loop
    -- 2026-08-31: resolve the channel's job on this deal PER RECIPIENT so the
    -- bell can deep-link technical users to a job page they can actually open
    -- (same shared thread, jobs RLS admits service-group members). The seo
    -- channel spans web_seo/local_seo/ai_seo — prefer a job whose
    -- service_type matches one of the recipient's own groups, else fall back
    -- to the channel's newest job (mapping of jobCommentThread /
    -- task_target_job_id).
    target_job := null;
    if new.parent_type in ('deal_dev', 'deal_seo', 'deal_ads', 'deal_social') then
      select j.id into target_job
        from public.jobs j
       where j.deal_id = new.parent_id
         and not j.archived
         and j.service_type = any (case new.parent_type
               when 'deal_dev' then array['web_dev']
               when 'deal_seo' then array['web_seo', 'local_seo', 'ai_seo']
               when 'deal_ads' then array['ads']
               else array['social_media'] end)
       order by
         (exists (select 1 from public.user_groups ug
                    join public.groups g on g.id = ug.group_id
                   where ug.user_id = uid and g.code = j.service_type)) desc,
         j.created_at desc
       limit 1;
    end if;

    insert into public.notifications (user_id, type, payload)
    values (
      uid,
      'mention',
      jsonb_build_object(
        'comment_id', new.id,
        'parent_type', new.parent_type,
        'parent_id', new.parent_id,
        'author_id', new.author_id,
        'author_name', author_name,
        'parent_label', parent_label,
        'preview', left(new.body, 200)
      )
      -- 2026-08-31: only present for deal-channel mentions with a live job.
      || case when target_job is not null
              then jsonb_build_object('target_job_id', target_job)
              else '{}'::jsonb end
    );
  end loop;
  return new;
end $function$;

-- Backfill: every existing channel-mention notification gains target_job_id
-- (read or unread — the unread ones are the broken bell entries reported by
-- the technical team; read ones heal for history clicks too). Same
-- per-recipient preference as the trigger: the seo channel spans three
-- service types, so pick a job the notification's OWNER can open when one
-- exists. Recomputes rows that already carry the key (idempotent).
update public.notifications n
   set payload = n.payload || jsonb_build_object('target_job_id', (
     select j.id
       from public.jobs j
      where j.deal_id = (n.payload ->> 'parent_id')::uuid
        and not j.archived
        and j.service_type = any (case n.payload ->> 'parent_type'
              when 'deal_dev' then array['web_dev']
              when 'deal_seo' then array['web_seo', 'local_seo', 'ai_seo']
              when 'deal_ads' then array['ads']
              else array['social_media'] end)
      order by
        (exists (select 1 from public.user_groups ug
                   join public.groups g on g.id = ug.group_id
                  where ug.user_id = n.user_id and g.code = j.service_type)) desc,
        j.created_at desc
      limit 1))
 where n.type = 'mention'
   and n.payload ->> 'parent_type' in ('deal_dev', 'deal_seo', 'deal_ads', 'deal_social')
   and exists (
     select 1 from public.jobs j
      where j.deal_id = (n.payload ->> 'parent_id')::uuid
        and not j.archived
        and j.service_type = any (case n.payload ->> 'parent_type'
              when 'deal_dev' then array['web_dev']
              when 'deal_seo' then array['web_seo', 'local_seo', 'ai_seo']
              when 'deal_ads' then array['ads']
              else array['social_media'] end)
   );

-- ROLLBACK:
--   Restore the 20260716100000 body of fanout_mention_notifications (pre-md5
--   09b069078e06539ae0486c394fa2105f). Backfill is additive (extra payload
--   key) — harmless to leave; to strip:
--   update public.notifications set payload = payload - 'target_job_id'
--    where type = 'mention' and payload ? 'target_job_id';
