-- =============================================================================
-- Ads + Social comment channels & per-user thread read state.
-- New parent_type values 'deal_ads' / 'deal_social' (parent_id = deal id) —
-- same pattern as deal_dev/deal_seo (20260709150000). Verified 2026-07-16:
-- prod has 21 ads + 21 social_media jobs with ZERO job comments, so unlike
-- 07-09 there is NO reparenting and NO backup table.
-- comment_thread_reads: one row per (user, thread); a channel tab shows an
-- unread dot when the thread's newest non-own comment is newer than the
-- user's last_seen_at.
--
-- ROLLBACK (manual):
--   drop table if exists public.comment_thread_reads;
--   -- re-narrow the CHECK (first handle any deal_ads/deal_social comment rows:
--   -- reparent to the deal's matching job thread, or delete — owner decision):
--   alter table public.comments drop constraint comments_parent_type_check;
--   alter table public.comments add constraint comments_parent_type_check
--     check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo'));
--   -- restore the three function bodies from 20260709150000 (fanout) and
--   -- 20260709170000 (assigned_tasks_*) — live bodies matched those files
--   -- exactly before this migration.
-- =============================================================================

-- 1) Allow the new parent types.
alter table public.comments drop constraint if exists comments_parent_type_check;
alter table public.comments add constraint comments_parent_type_check
  check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo','deal_ads','deal_social'));

-- 2) Mention notification labels for the new channels.
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
  elsif new.parent_type = 'deal_ads' then
    select d.title || ' — Ads' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_social' then
    select d.title || ' — Social' into parent_label from public.deals d where d.id = new.parent_id;
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

-- 3) Task auto-comments: route ads / social_media job tasks into the new channels.
create or replace function public.assigned_tasks_comment_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_assignee text; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    elsif v_st = 'ads' then v_type := 'deal_ads'; v_id := v_deal;
    elsif v_st = 'social_media' then v_type := 'deal_social'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  select coalesce(nullif(p.full_name,''), p.email) into v_assignee
    from public.profiles p where p.user_id = new.assignee_user_id;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, new.created_by_user_id,
    format('📋 New task: "%s" — for %s · %s', new.title, coalesce(v_assignee, '—'), new.importance),
    '{}', 'assigned:' || new.id);
  return new;
end $$;

create or replace function public.assigned_tasks_comment_on_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    elsif v_st = 'ads' then v_type := 'deal_ads'; v_id := v_deal;
    elsif v_st = 'social_media' then v_type := 'deal_social'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.resolved_by_user_id, auth.uid(), new.assignee_user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'assigned:' || new.id);
  return new;
end $$;

-- 4) Per-user thread read state.
create table public.comment_thread_reads (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  parent_type text not null,
  parent_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, parent_type, parent_id)
);

alter table public.comment_thread_reads enable row level security;

create policy comment_thread_reads_select on public.comment_thread_reads
  for select to authenticated using (user_id = auth.uid());
create policy comment_thread_reads_insert on public.comment_thread_reads
  for insert to authenticated with check (user_id = auth.uid());
create policy comment_thread_reads_update on public.comment_thread_reads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.comment_thread_reads from anon;
grant select, insert, update on public.comment_thread_reads to authenticated;

-- 5) Post-asserts — fail the migration loudly if anything is off.
do $$
declare n int;
begin
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conname = 'comments_parent_type_check') not like '%deal_ads%' then
    raise exception 'comments_parent_type_check missing deal_ads';
  end if;
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosrc like '%deal_ads%'
      and p.proname in ('fanout_mention_notifications',
                        'assigned_tasks_comment_on_insert',
                        'assigned_tasks_comment_on_resolve');
  if n <> 3 then
    raise exception 'expected 3 functions routing deal_ads, found %', n;
  end if;
  if not exists (select 1 from pg_tables
                 where schemaname = 'public' and tablename = 'comment_thread_reads') then
    raise exception 'comment_thread_reads missing';
  end if;
  select count(*) into n from pg_policies
    where schemaname = 'public' and tablename = 'comment_thread_reads';
  if n < 3 then
    raise exception 'comment_thread_reads expected >=3 policies, found %', n;
  end if;
end $$;
