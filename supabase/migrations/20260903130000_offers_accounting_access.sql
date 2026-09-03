-- =============================================================================
-- 2026-09-03 (owner): offers are built by admins, the WHOLE Accounting
-- department and Sales. The technical boards are deliberately NOT included.
--
-- Before this, `offers_insert` demanded sales:create / sales:edit, which only
-- the `sales` group holds (seed 20260502000006:15-16). Accounting could already
-- READ every offer and UPDATE its status (offers_select / offers_update both
-- name accounting_onboarding) but could never create one — the accounting user
-- got a bare RLS violation, and the only UI entry point lived inside a lead,
-- which accounting cannot reach at all (leads_select is owner-scoped and
-- /sales/* is behind RequireGroup(['sales'])).
--
-- Also widens offers_select: the offer creator always sees their own offer.
-- Without it an offer filed on a plain client — no lead, no deal, which is
-- exactly the accounting/upsell shape — was invisible to everyone but admins
-- and accounting, including the person who had just built it.
--
-- Base bodies: 20260504000007_offers_table.sql:51-86 and :106-117 plus
-- 20260504000008_offers_polish.sql:28-35 (no later migration redefines them).
-- Run the drift check in the deploy script before applying.
-- =============================================================================

-- 1. INSERT — accounting joins sales -----------------------------------------
drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers for insert to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'create')
    or public.current_user_can('accounting_onboarding', 'edit')
  );

-- 2. SELECT — the creator always sees their own offer -------------------------
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or offers.created_by = (select auth.uid())
    or exists (
      select 1 from public.leads l
       where l.id = offers.lead_id
         and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
    )
    or exists (
      select 1 from public.deals d
       where d.id = offers.deal_id
         and (d.owner_user_id = auth.uid() or d.won_by_user_id = auth.uid())
    )
  );

-- 3. offer-pdfs bucket — the policies must not claim sales-only ---------------
-- api/offer-pdf.ts writes with the service-role client, so these gate only
-- direct client-side storage access; keeping them honest avoids a future
-- "why does this 403" hunt.
drop policy if exists storage_offer_pdfs_select on storage.objects;
create policy storage_offer_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  ));

drop policy if exists storage_offer_pdfs_insert on storage.objects;
create policy storage_offer_pdfs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  ));

drop policy if exists storage_offer_pdfs_update on storage.objects;
create policy storage_offer_pdfs_update on storage.objects for update to authenticated
  using (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  ))
  with check (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  ));

-- ROLLBACK: restore the pre-2026-09-03 bodies verbatim.
--   drop policy if exists offers_insert on public.offers;
--   create policy offers_insert on public.offers for insert to authenticated
--     with check (
--       public.current_user_is_admin()
--       or public.current_user_can('sales', 'create')
--       or public.current_user_can('sales', 'edit')
--     );
--   drop policy if exists offers_select on public.offers;
--   create policy offers_select on public.offers for select to authenticated
--     using (
--       public.current_user_is_admin()
--       or public.current_user_can('accounting_onboarding', 'view')
--       or public.current_user_can('accounting_recurring', 'view')
--       or exists (select 1 from public.leads l
--                   where l.id = offers.lead_id
--                     and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid()))
--       or exists (select 1 from public.deals d
--                   where d.id = offers.deal_id
--                     and (d.owner_user_id = auth.uid() or d.won_by_user_id = auth.uid()))
--     );
--   drop policy if exists storage_offer_pdfs_insert on storage.objects;
--   create policy storage_offer_pdfs_insert on storage.objects for insert to authenticated
--     with check (bucket_id = 'offer-pdfs' and (
--       public.current_user_is_admin() or public.current_user_can('sales', 'edit')));
--   drop policy if exists storage_offer_pdfs_update on storage.objects;
--   create policy storage_offer_pdfs_update on storage.objects for update to authenticated
--     using (bucket_id = 'offer-pdfs' and (
--       public.current_user_is_admin() or public.current_user_can('sales', 'edit')))
--     with check (bucket_id = 'offer-pdfs' and (
--       public.current_user_is_admin() or public.current_user_can('sales', 'edit')));
--   (storage_offer_pdfs_select is unchanged by this migration.)
