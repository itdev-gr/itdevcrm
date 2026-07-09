-- =============================================================================
-- Task auto-comments: a linked task posts 📋 on create and ✅ on resolve into
-- its thread (deal General / deal_dev / deal_seo channel, job, client, lead).
-- comments.task_key back-references the task so the UI can open it on click.
-- security definer (comments INSERT RLS requires auth.uid()=author_id; the
-- definer owner bypasses it, same as fanout_mention_notifications).
-- No mention fanout (mentioned_user_ids='{}').
-- ROLLBACK: drop the 4 triggers + functions; optionally
--   alter table public.comments drop column task_key;
-- =============================================================================

alter table public.comments add column if not exists task_key text;

-- ---- user_tasks: create ----
create or replace function public.user_tasks_comment_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_assignee text;
begin
  if new.client_id is not null then v_type := 'client'; v_id := new.client_id;
  elsif new.lead_id is not null then v_type := 'lead'; v_id := new.lead_id;
  else return new; end if;
  select coalesce(nullif(p.full_name,''), p.email) into v_assignee
    from public.profiles p where p.user_id = new.user_id;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.created_by, new.user_id),
    format('📋 New task: "%s" — for %s, due %s · %s',
           new.title, coalesce(v_assignee, '—'),
           coalesce(to_char(new.due_at at time zone 'Europe/Athens', 'DD Mon'), '—'),
           new.importance),
    '{}', 'user:' || new.id);
  return new;
end $$;
create trigger user_tasks_comment_on_insert after insert on public.user_tasks
  for each row execute function public.user_tasks_comment_on_insert();

-- ---- user_tasks: resolve (each open -> completed transition) ----
create or replace function public.user_tasks_comment_on_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid;
begin
  if new.client_id is not null then v_type := 'client'; v_id := new.client_id;
  elsif new.lead_id is not null then v_type := 'lead'; v_id := new.lead_id;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(auth.uid(), new.user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'user:' || new.id);
  return new;
end $$;
create trigger user_tasks_comment_on_resolve after update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.user_tasks_comment_on_resolve();

-- ---- assigned_tasks: create ----
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
create trigger assigned_tasks_comment_on_insert after insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_comment_on_insert();

-- ---- assigned_tasks: resolve ----
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
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.resolved_by_user_id, auth.uid(), new.assignee_user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'assigned:' || new.id);
  return new;
end $$;
create trigger assigned_tasks_comment_on_resolve after update on public.assigned_tasks
  for each row when (old.status = 'open' and new.status = 'resolved')
  execute function public.assigned_tasks_comment_on_resolve();
