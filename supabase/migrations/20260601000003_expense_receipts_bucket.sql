-- The bucket itself is created via SQL (idempotent with on-conflict).
insert into storage.buckets (id, name, public)
  values ('expense-receipts', 'expense-receipts', false)
  on conflict (id) do nothing;

drop policy if exists "expense_receipts_all" on storage.objects;

create policy "expense_receipts_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'expense-receipts' and public.current_user_is_admin())
  with check (bucket_id = 'expense-receipts' and public.current_user_is_admin());

-- ROLLBACK:
-- drop policy if exists "expense_receipts_all" on storage.objects;
-- delete from storage.buckets where id = 'expense-receipts';
