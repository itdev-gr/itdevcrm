-- =============================================================================
-- Service attachments for Ads + Social: extend the svc_* RLS gating
-- (20260624140000) with kind 'svc_ads' -> ads group and
-- kind 'svc_social' -> social_media group. Both kinds are added to the
-- gated-kinds list so non-department staff cannot write them.
-- attachments.kind has no CHECK constraint — policies are the only DB surface.
--
-- ROLLBACK (manual): re-run the two policy definitions from
-- 20260624140000_service_attachment_rls.sql (verified identical to live
-- pre-change on 2026-07-16). Any svc_ads/svc_social rows keep existing but
-- stop being uploadable.
-- =============================================================================

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (
    auth.uid() = uploaded_by
    and (
      kind is null
      or kind not in ('svc_local','svc_web','svc_webdev','svc_ads','svc_social')
      or public.current_user_is_admin()
      or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
      or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
      or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
      or (kind = 'svc_ads'    and public.current_user_in_group('ads'))
      or (kind = 'svc_social' and public.current_user_in_group('social_media'))
    )
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete using (
    public.current_user_is_admin()
    or auth.uid() = uploaded_by
    or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
    or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
    or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
    or (kind = 'svc_ads'    and public.current_user_in_group('ads'))
    or (kind = 'svc_social' and public.current_user_in_group('social_media'))
  );

-- Post-asserts — fail loudly if anything is off.
do $$
declare ins text; del text;
begin
  select pg_get_expr(polwithcheck, polrelid) into ins from pg_policy
    where polrelid = 'public.attachments'::regclass and polname = 'attachments_insert';
  select pg_get_expr(polqual, polrelid) into del from pg_policy
    where polrelid = 'public.attachments'::regclass and polname = 'attachments_delete';
  if ins is null or ins not like '%svc_ads%' or ins not like '%svc_social%' then
    raise exception 'attachments_insert missing svc_ads/svc_social';
  end if;
  if del is null or del not like '%svc_ads%' or del not like '%svc_social%' then
    raise exception 'attachments_delete missing svc_ads/svc_social';
  end if;
end $$;
