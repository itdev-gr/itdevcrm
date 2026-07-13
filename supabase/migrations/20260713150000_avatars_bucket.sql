-- =============================================================================
-- Public `avatars` bucket: per-user profile photos shown in the personal email
-- signature (spec 2026-07-13-profile-photo-signature-design.md).
-- Public read (mail clients fetch images anonymously via /object/public/…).
-- Writes: each authenticated user may touch ONLY their own fixed key
-- `<user_id>.png` — upsert needs insert + update; remove needs delete.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/png'])
  on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png'];

-- Supabase storage upsert-overwrite requires SELECT+UPDATE besides INSERT, and DELETE's WHERE needs SELECT visibility — without this, photo replacement fails and Remove silently deletes 0 rows.
drop policy if exists "avatars_select_own" on storage.objects;
create policy "avatars_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.png');

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
--   drop policy if exists "avatars_select_own" on storage.objects;
--   drop policy if exists "avatars_insert_own" on storage.objects;
--   drop policy if exists "avatars_update_own" on storage.objects;
--   drop policy if exists "avatars_delete_own" on storage.objects;
--   (bucket objects must be removed via the dashboard / storage API first —
--    protect_delete blocks SQL deletes on storage.objects), THEN:
--   delete from storage.buckets where id = 'avatars';
-- ---------------------------------------------------------------------------
