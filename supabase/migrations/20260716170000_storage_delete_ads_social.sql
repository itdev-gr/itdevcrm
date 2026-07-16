-- =============================================================================
-- Follow-up to 20260716150000 (svc_ads/svc_social attachment RLS): the STORAGE
-- delete policy (20260624160000) mirrors the kind->group mapping and was missed,
-- so a non-uploader ads/social teammate deleting a colleague's service file
-- failed at the storage step (fail-safe: useDeleteAttachment deletes storage
-- FIRST, so no orphan was possible — the delete was just blocked). Add the two
-- new branches. Live policy verified to match 20260624160000 before this change.
--
-- ROLLBACK (manual): re-run the policy definition from 20260624160000.
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
            or (a.kind = 'svc_ads'    and public.current_user_in_group('ads'))
            or (a.kind = 'svc_social' and public.current_user_in_group('social_media'))
          )
      )
    )
  );

-- Post-assert.
do $$
declare q text;
begin
  select pg_get_expr(polqual, polrelid) into q
    from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'attachments_delete_own';
  if q is null or q not like '%svc_ads%' or q not like '%svc_social%' then
    raise exception 'storage attachments_delete_own missing svc_ads/svc_social';
  end if;
end $$;
