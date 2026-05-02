-- =============================================================================
-- Add core tables to the supabase_realtime publication so the kanban /
-- dashboard hooks receive INSERT / UPDATE / DELETE events and TanStack Query
-- can invalidate caches in real time.
-- Idempotent: only adds a table if it isn't already in the publication.
-- =============================================================================
do $$
declare
  t text;
  needed text[] := array[
    'leads',
    'deals',
    'jobs',
    'clients',
    'client_blocks',
    'notifications',
    'comments',
    'attachments',
    'service_packages'
  ];
begin
  foreach t in array needed loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
