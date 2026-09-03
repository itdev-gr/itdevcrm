-- =============================================================================
-- 2026-09-03 (owner: «τι είναι αυτό το [cid:…]»): captured mail lost every
-- attachment.
--
-- gmail-sync's collectBody (_shared/google.ts) only ever walked the text/plain
-- and text/html parts, so anything sent as a file — a pasted screenshot, a PDF
-- invoice, a signed contract — was never downloaded. What the Emails tab showed
-- instead was Outlook's plain-text stand-in for an inline image, verbatim:
--   [cid:c6d66a74-5814-479f-a240-2043dc480389]
-- 101 inbound messages carry such a token today (6→13→18→20→40 per month, Apr→Aug),
-- and 3 of them have NO other content: the reply is the image.
--
-- This adds the storage side. `email_attachments` rows are written only by the
-- service role (gmail-sync); readers inherit email_messages' own visibility,
-- since the policy's EXISTS re-runs email_messages_select for the caller.
--
-- `attachments_scanned_at` is the backfill cursor: null = never looked at.
-- gmail-sync stamps it after a message's parts are stored, and spends whatever
-- sweep budget is left walking the null ones newest-first.
-- =============================================================================

alter table public.email_messages
  add column if not exists attachments_scanned_at timestamptz;

create index if not exists email_messages_attachments_unscanned
  on public.email_messages (sent_at desc)
  where attachments_scanned_at is null and gmail_id is not null;

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  message_pk uuid not null references public.email_messages(id) on delete cascade,
  -- Gmail's opaque per-message handle. Kept for provenance/re-fetch; NOT indexed
  -- (it can run to ~1 KB, past the btree limit) — idempotency comes from the
  -- message's attachments_scanned_at stamp instead.
  gmail_attachment_id text,
  -- Content-ID without the angle brackets, when the part is referenced from the
  -- body as <img src="cid:…"> / [cid:…]. Null for a plain attachment.
  content_id text,
  file_name text not null,
  mime_type text,
  file_size int,
  is_inline boolean not null default false,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists email_attachments_message
  on public.email_attachments (message_pk);

alter table public.email_attachments enable row level security;

-- Visibility follows the parent message exactly: the sub-select is subject to
-- email_messages_select (20260903140000), so no rule is duplicated here and a
-- later change to email visibility carries over automatically.
drop policy if exists email_attachments_select on public.email_attachments;
create policy email_attachments_select on public.email_attachments
  for select to authenticated
  using (exists (select 1 from public.email_messages m where m.id = message_pk));

-- No insert/update/delete policy: gmail-sync writes with the service role,
-- which bypasses RLS. Rows die with their message (on delete cascade).

-- -----------------------------------------------------------------------------
-- Storage bucket
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('email-attachments', 'email-attachments', false, 26214400)  -- 25 MB
  on conflict (id) do nothing;

drop policy if exists "email_attachments_read" on storage.objects;
create policy "email_attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'email-attachments'
    and exists (
      select 1 from public.email_attachments ea
       where ea.storage_path = storage.objects.name
    )
  );

-- ROLLBACK:
--   drop policy if exists "email_attachments_read" on storage.objects;
--   delete from storage.buckets where id = 'email-attachments';  -- empty it first
--   drop table if exists public.email_attachments;
--   drop index if exists public.email_messages_attachments_unscanned;
--   alter table public.email_messages drop column if exists attachments_scanned_at;
