-- =============================================================================
-- Fix: deleting an attachment orphaned its storage file. The storage delete
-- policy was owner-only, so admins and (with the new service-attachments) group
-- teammates could delete the DB row but not the underlying file. Broaden it to
-- owner OR admin OR the owning group of a svc_* file (mirrors the public.attachments
-- delete rule). useDeleteAttachment also now surfaces the storage error.
-- =============================================================================
drop policy if exists attachments_delete_own on storage.objects;
create policy attachments_delete_own on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (
      owner = auth.uid()
      or public.current_user_is_admin()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = storage.objects.name
          and a.parent_type = 'job'
          and (
            (a.kind = 'svc_local'  and public.current_user_in_group('local_seo'))
            or (a.kind = 'svc_web'    and public.current_user_in_group('web_seo'))
            or (a.kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
          )
      )
    )
  );

-- Rollback:
-- drop policy if exists attachments_delete_own on storage.objects;
-- create policy attachments_delete_own on storage.objects
--   for delete using ((bucket_id = 'attachments') and (owner = auth.uid()));
