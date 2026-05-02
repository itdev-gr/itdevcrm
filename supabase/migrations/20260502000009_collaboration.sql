-- =============================================================================
-- Phase 3 migration: comments, attachments, notifications, saved_filters
-- =============================================================================

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('client', 'deal', 'job')),
  parent_id uuid not null,
  author_id uuid not null references public.profiles(user_id),
  body text not null,
  mentioned_user_ids uuid[] not null default '{}',
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_parent on public.comments (parent_type, parent_id) where archived = false;
create index comments_author on public.comments (author_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

create trigger comments_activity
  after insert or update or delete on public.comments
  for each row execute function public.log_activity('id');

alter table public.comments enable row level security;

create policy comments_select
  on public.comments for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
  );

create policy comments_insert_self
  on public.comments for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and (
      public.current_user_is_admin()
      or public.current_user_can('sales', 'comment')
      or public.current_user_can('clients', 'comment')
    )
  );

create policy comments_update_self_or_admin
  on public.comments for update
  to authenticated
  using (auth.uid() = author_id or public.current_user_is_admin())
  with check (auth.uid() = author_id or public.current_user_is_admin());

create policy comments_delete_self_or_admin
  on public.comments for delete
  to authenticated
  using (auth.uid() = author_id or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('client', 'deal', 'job')),
  parent_id uuid not null,
  storage_path text not null,
  file_name text not null,
  file_size int,
  mime_type text,
  uploaded_by uuid not null references public.profiles(user_id),
  kind text default 'other',
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create index attachments_parent on public.attachments (parent_type, parent_id) where archived = false;

create trigger attachments_activity
  after insert or update or delete on public.attachments
  for each row execute function public.log_activity('id');

alter table public.attachments enable row level security;

create policy attachments_select
  on public.attachments for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
  );

create policy attachments_insert
  on public.attachments for insert
  to authenticated
  with check (
    auth.uid() = uploaded_by
    and (
      public.current_user_is_admin()
      or public.current_user_can('sales', 'attach_file')
      or public.current_user_can('clients', 'attach_file')
    )
  );

create policy attachments_delete
  on public.attachments for delete
  to authenticated
  using (auth.uid() = uploaded_by or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  type text not null,
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_all on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger: when a comment is inserted with mentioned_user_ids, fan out notifications.
create or replace function public.fanout_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
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
        'preview', left(new.body, 200)
      )
    );
  end loop;
  return new;
end $$;

create trigger comments_fanout_mentions
  after insert on public.comments
  for each row execute function public.fanout_mention_notifications();

-- ---------------------------------------------------------------------------
-- saved_filters
-- ---------------------------------------------------------------------------
create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  board text not null,
  name text not null,
  filter_json jsonb not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_filters_user on public.saved_filters (user_id, board, position);

create trigger saved_filters_set_updated_at
  before update on public.saved_filters
  for each row execute function public.set_updated_at();

alter table public.saved_filters enable row level security;

create policy saved_filters_select_own
  on public.saved_filters for select
  to authenticated
  using (auth.uid() = user_id);

create policy saved_filters_mutate_own
  on public.saved_filters for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
