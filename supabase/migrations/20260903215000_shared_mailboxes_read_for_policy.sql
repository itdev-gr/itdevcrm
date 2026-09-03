-- The 20260903210000 unfiled-visibility branch checks the capturing shared
-- mailbox's department via an EXISTS on shared_mailboxes — but that table's
-- only select policy is admin-only (20260710170000), so the branch silently
-- failed for non-admins (caught by the rolled-back visibility probe on
-- apply day: a sales rep saw 0 sales@-captured unfiled rows instead of 1).
-- The registry holds four company addresses + departments — not sensitive;
-- open reads to authenticated so policy subqueries evaluate for everyone.
drop policy if exists shared_mailboxes_read_all on public.shared_mailboxes;
create policy shared_mailboxes_read_all on public.shared_mailboxes
  for select to authenticated using (true);

-- ROLLBACK: drop policy if exists shared_mailboxes_read_all on public.shared_mailboxes;
