-- Sales reps can reassign THEIR OWN leads to any other user.
--
-- Live symptom (2026-09-02): changing Owner on a rep's own lead failed with
-- "new row violates row-level security policy for table leads" — the live
-- WITH CHECK rejects rows whose new owner is someone else.
--
-- Desired semantics:
--   USING       — who may touch a row: admins, sales managers (sales/view_all),
--                 or the lead's current owner.
--   WITH CHECK  — what the new row may look like: any owner value, as long as
--                 the user holds a sales write capability (edit or move_stage)
--                 or is admin/manager. Row reach is already limited by USING,
--                 so a rep can only give away leads they own.
drop policy if exists leads_update on public.leads;
create policy leads_update
  on public.leads for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view_all')
    or owner_user_id = auth.uid()
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view_all')
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
  );

-- ROLLBACK:
-- drop policy if exists leads_update on public.leads;
-- (recreate the previous policy from the pg_policies snapshot printed by the
--  apply script before this migration ran)
