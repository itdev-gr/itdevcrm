-- Notifications now persist in the side column until the user removes them (the
-- X button or "Clear all") — opening one only marks it read, it no longer
-- disappears. Removal is a real delete, so allow users to delete their own.
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (auth.uid() = user_id);

-- ROLLBACK:
-- drop policy if exists notifications_delete_own on public.notifications;
