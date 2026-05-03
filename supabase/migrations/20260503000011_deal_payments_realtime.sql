-- Surface deal_payments through the realtime channel the accounting kanban
-- already listens on, so an invoice update or status flip refreshes other
-- open tabs immediately.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deal_payments'
  ) then
    execute 'alter publication supabase_realtime add table public.deal_payments';
  end if;
end $$;
