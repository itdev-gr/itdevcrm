-- =============================================================================
-- Service attachments: gate svc_* attachment writes to the owning group.
-- kind 'svc_local' -> local_seo group, 'svc_web' -> web_seo, 'svc_webdev' -> web_dev.
-- Non-service attachments (contract/invoice/other) keep the prior open behavior.
-- =============================================================================
create or replace function public.current_user_in_group(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where g.code = p_code and ug.user_id = auth.uid()
  );
$$;
grant execute on function public.current_user_in_group(text) to authenticated;

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (
    auth.uid() = uploaded_by
    and (
      kind is null
      or kind not in ('svc_local','svc_web','svc_webdev')
      or public.current_user_is_admin()
      or (kind = 'svc_local'  and public.current_user_in_group('local_seo'))
      or (kind = 'svc_web'    and public.current_user_in_group('web_seo'))
      or (kind = 'svc_webdev' and public.current_user_in_group('web_dev'))
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
  );

-- Rollback:
-- drop policy if exists attachments_insert on public.attachments;
-- create policy attachments_insert on public.attachments
--   for insert with check (auth.uid() = uploaded_by);
-- drop policy if exists attachments_delete on public.attachments;
-- create policy attachments_delete on public.attachments
--   for delete using ((auth.uid() = uploaded_by) or current_user_is_admin());
-- drop function if exists public.current_user_in_group(text);
