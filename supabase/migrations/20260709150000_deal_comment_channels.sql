-- =============================================================================
-- Deal comment channels: General / Dev / SEO.
-- New parent_type values 'deal_dev' / 'deal_seo' (parent_id = deal id) — same
-- pattern as adding 'lead' (20260502000031). Old job comments are backed up
-- then reparented: web_dev job threads -> deal_dev, web/local/ai SEO job
-- threads -> deal_seo. Orphan comments (job deleted) are left untouched.
--
-- Trigger note: comments_set_updated_at would stamp updated_at (falsely marking
-- rows as edited) and comments_activity would spam ~102 rows into client
-- Activity feeds, so both are disabled around the reparent UPDATEs.
--
-- ROLLBACK (manual):
--   update public.comments c set parent_type=b.parent_type, parent_id=b.parent_id
--     from public.comments_reparent_backup_20260709 b where c.id=b.id;
--   re-apply 20260502000032 (previous fanout_mention_notifications body);
--   alter table public.comments drop constraint comments_parent_type_check;
--   alter table public.comments add constraint comments_parent_type_check
--     check (parent_type in ('client','deal','job','lead'));
--   (keep the backup table until the owner confirms stability)
-- =============================================================================

-- 1) Allow the new parent types.
alter table public.comments drop constraint if exists comments_parent_type_check;
alter table public.comments add constraint comments_parent_type_check
  check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo'));

-- 2) Mention notification labels for channel threads.
create or replace function public.fanout_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  author_name text;
  parent_label text;
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
  elsif new.parent_type = 'job' then
    select j.service_type into parent_label from public.jobs j where j.id = new.parent_id;
  end if;

  foreach uid in array new.mentioned_user_ids loop
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
    );
  end loop;
  return new;
end $$;

-- 3) Backup the rows we are about to move (revert path).
create table if not exists public.comments_reparent_backup_20260709 as
  select c.id, c.parent_type, c.parent_id
  from public.comments c
  join public.jobs j on j.id = c.parent_id
  where c.parent_type = 'job'
    and j.service_type in ('web_dev','web_seo','local_seo','ai_seo');

-- 4) Reparent job threads into the deal channels (triggers paused: see header).
alter table public.comments disable trigger comments_set_updated_at;
alter table public.comments disable trigger comments_activity;

update public.comments c
   set parent_type = 'deal_dev', parent_id = j.deal_id
  from public.jobs j
 where c.parent_type = 'job' and c.parent_id = j.id
   and j.service_type = 'web_dev';

update public.comments c
   set parent_type = 'deal_seo', parent_id = j.deal_id
  from public.jobs j
 where c.parent_type = 'job' and c.parent_id = j.id
   and j.service_type in ('web_seo','local_seo','ai_seo');

alter table public.comments enable trigger comments_set_updated_at;
alter table public.comments enable trigger comments_activity;
