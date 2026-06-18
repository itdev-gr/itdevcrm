-- Accounting staff have accounting_onboarding/comment (and /view) granted, but the
-- comments policies only honoured sales/clients perms — so accounting users (e.g.
-- stavroula@itdev.gr) could not post comments on deals/clients. Honour the
-- accounting permission in both INSERT (post) and SELECT (read) policies.

alter policy comments_insert_self on public.comments
  with check (
    auth.uid() = author_id and (
      public.current_user_is_admin()
      or public.current_user_can('sales', 'comment')
      or public.current_user_can('clients', 'comment')
      or public.current_user_can('accounting_onboarding', 'comment')
    )
  );

alter policy comments_select on public.comments
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  );

-- ROLLBACK:
-- alter policy comments_insert_self on public.comments with check (
--   auth.uid() = author_id and (
--     public.current_user_is_admin()
--     or public.current_user_can('sales','comment')
--     or public.current_user_can('clients','comment')));
-- alter policy comments_select on public.comments using (
--   public.current_user_is_admin()
--   or public.current_user_can('clients','view')
--   or public.current_user_can('sales','view'));
