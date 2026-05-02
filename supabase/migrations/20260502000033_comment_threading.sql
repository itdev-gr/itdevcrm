-- =============================================================================
-- Add reply_to_id to comments to support threaded replies. UPDATE / DELETE
-- policies already allow author or admin, so edit / archive / delete are
-- already wired correctly at the RLS layer.
-- =============================================================================
alter table public.comments
  add column if not exists reply_to_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_reply_to on public.comments (reply_to_id)
  where archived = false and reply_to_id is not null;
