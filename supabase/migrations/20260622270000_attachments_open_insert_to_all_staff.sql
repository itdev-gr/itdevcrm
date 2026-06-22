-- Open attachment uploads to all logged-in staff.
-- The attachments_insert policy only honoured sales/clients attach_file (or admin),
-- but every group has attach_file scoped to its OWN board (accounting_onboarding,
-- web_dev, web_seo, local_seo, social_media, sales). No group except sales has
-- sales/clients attach_file, so only sales members + admins could ever upload.
-- Accounting users (emarketaki@, stavroula@) and the service teams therefore hit
-- "new row violates row-level security policy for table attachments" on upload.
-- Mirror the comments_insert policy: any authenticated user may upload, as themselves.
-- SELECT (admin / clients.view / sales.view) and DELETE (self-or-admin) are unchanged.

alter policy attachments_insert on public.attachments
  with check (auth.uid() = uploaded_by);

-- ROLLBACK (restore the board-scoped gating):
--   alter policy attachments_insert on public.attachments
--     with check (
--       (auth.uid() = uploaded_by) and (
--         current_user_is_admin()
--         or current_user_can('sales','attach_file')
--         or current_user_can('clients','attach_file')));
