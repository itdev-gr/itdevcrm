-- =============================================================================
-- Phase 3 migration: storage policies for the `attachments` bucket
-- =============================================================================
-- The bucket itself is created via the Storage API (one-shot operational step,
-- not idempotent in SQL). These policies live in the storage schema.

-- Drop any existing policies with the same name (idempotent re-run safety).
drop policy if exists "attachments_read" on storage.objects;
drop policy if exists "attachments_insert" on storage.objects;
drop policy if exists "attachments_delete_own" on storage.objects;

-- Authenticated users can read attachments in the attachments bucket.
create policy "attachments_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments');

-- Authenticated users can upload to the attachments bucket.
create policy "attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'attachments');

-- Owner can delete their own uploads.
create policy "attachments_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
