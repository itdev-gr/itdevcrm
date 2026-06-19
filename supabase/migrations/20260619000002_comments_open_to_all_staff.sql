-- Open the comments area to all logged-in staff.
-- Previously posting/reading required admin or a board-scoped comment/view
-- permission on sales/clients/accounting_onboarding, which locked out service
-- teams (web_seo, local_seo, …). Now any authenticated user can read every
-- comment and post as themselves. Edit/delete remain self-or-admin (unchanged).

alter policy comments_insert_self on public.comments
  with check (auth.uid() = author_id);

alter policy comments_select on public.comments
  using (true);

-- ROLLBACK (restore the board-scoped gating):
--   alter policy comments_insert_self on public.comments
--     with check (
--       (auth.uid() = author_id) and (
--         current_user_is_admin()
--         or current_user_can('sales','comment')
--         or current_user_can('clients','comment')
--         or current_user_can('accounting_onboarding','comment')));
--   alter policy comments_select on public.comments
--     using (
--       current_user_is_admin()
--       or current_user_can('clients','view')
--       or current_user_can('sales','view')
--       or current_user_can('accounting_onboarding','view'));
