-- =============================================================================
-- Public `avatars` bucket: per-user profile photos shown in the personal email
-- signature (spec 2026-07-13-profile-photo-signature-design.md).
-- Public read (mail clients fetch images anonymously via /object/public/…).
-- Writes: each authenticated user may touch ONLY their own fixed key
-- `<user_id>.png` — upsert needs insert + update; remove needs delete.
-- =============================================================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.png')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop policy if exists "avatars_insert_own" on storage.objects;
--   drop policy if exists "avatars_update_own" on storage.objects;
--   drop policy if exists "avatars_delete_own" on storage.objects;
--   delete from storage.objects where bucket_id = 'avatars';
--   delete from storage.buckets where id = 'avatars';
-- ---------------------------------------------------------------------------
