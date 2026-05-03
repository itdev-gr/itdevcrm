-- =============================================================================
-- Tighten deals_select RLS so non-admin / non-accounting users only see
-- deals they actually have a stake in (owner or won_by). Previously the
-- policy granted every authenticated user with `sales view` (group seed)
-- visibility into every deal in the database — sales people across teams
-- could see one another's deals.
--
-- Visibility rules after this migration:
--   - admin                                       -> all deals
--   - accounting_onboarding view                  -> all deals (org-wide job)
--   - accounting_recurring view                   -> all deals (org-wide job)
--   - sales view AND user is owner / won_by       -> the deal
--   - clients view AND user is owner / won_by     -> the deal
-- =============================================================================

drop policy if exists deals_select on public.deals;

create policy deals_select
  on public.deals for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or (
      (
        public.current_user_can('sales', 'view')
        or public.current_user_can('clients', 'view')
      )
      and (owner_user_id = auth.uid() or won_by_user_id = auth.uid())
    )
  );
