-- 20260723120000_comment_attachments.sql
-- Spec: docs/superpowers/specs/2026-07-23-comment-attachments-design.md
-- Files attached to a comment. Links to EITHER a general comment or a task
-- comment (XOR). RLS mirrors the parent's visibility exactly: general-comment
-- files are visible to all staff (comments SELECT is open); task-comment files
-- are parties-only (is_task_party) so private task files never leak. Also relax
-- the task_comments non-empty-body CHECK so an attachment-only message is valid.
--
-- ROLLBACK:
--   drop table if exists public.comment_attachments;
--   alter table public.task_comments
--     add constraint task_comments_body_check check (length(btrim(body)) > 0);
--   (this migration only DROPS the prior task_comments_body_check — re-add it verbatim above)

create table if not exists public.comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid references public.comments(id) on delete cascade,
  task_comment_id uuid references public.task_comments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size int,
  mime_type text,
  uploaded_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  constraint comment_attachments_one_parent
    check ((comment_id is not null) <> (task_comment_id is not null))
);

create index if not exists comment_attachments_comment_id_idx on public.comment_attachments(comment_id);
create index if not exists comment_attachments_task_comment_id_idx on public.comment_attachments(task_comment_id);

alter table public.comment_attachments enable row level security;

-- A row's visibility mirrors its parent comment.
create policy comment_attachments_select on public.comment_attachments
  for select to authenticated
  using (
    comment_id is not null  -- general comments are visible to all staff
    or exists (
      select 1 from public.task_comments tc
       where tc.id = comment_attachments.task_comment_id
         and public.is_task_party(tc.user_task_id, tc.assigned_task_id)));

create policy comment_attachments_insert on public.comment_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      comment_id is not null
      or exists (
        select 1 from public.task_comments tc
         where tc.id = comment_attachments.task_comment_id
           and public.is_task_party(tc.user_task_id, tc.assigned_task_id))));

create policy comment_attachments_delete on public.comment_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.current_user_is_admin());

grant select, insert, delete on public.comment_attachments to authenticated;

-- Relax the task_comments non-empty-body CHECK (attachment-only messages).
-- The composer still blocks a truly empty message (no text AND no file);
-- the DB just no longer requires non-empty text.
do $$
declare cn text;
begin
  select conname into cn from pg_constraint
   where conrelid = 'public.task_comments'::regclass
     and pg_get_constraintdef(oid) ilike '%body%' and contype = 'c';
  if cn is not null then execute format('alter table public.task_comments drop constraint %I', cn); end if;
end $$;
