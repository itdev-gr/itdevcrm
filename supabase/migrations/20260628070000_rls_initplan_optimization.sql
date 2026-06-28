-- =============================================================================
-- Audit PERF (auth_rls_initplan, 27 policies): wrap bare auth.uid()/role()/jwt()/
-- email() calls in RLS policy expressions in a scalar subselect so Postgres
-- evaluates them ONCE per query (initplan) instead of once PER ROW. Semantically
-- identical — (select auth.uid()) returns the same value as auth.uid(). Matters
-- here because RLS helper re-evaluation has already caused statement timeouts
-- (see global_search perf fix). Idempotent: the guard skips already-wrapped policies.
-- =============================================================================

do $$
declare r record;
begin
  for r in
    select format(
      'alter policy %I on public.%I%s%s',
      policyname, tablename,
      case when qual is not null
           then ' using (' || regexp_replace(qual, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g') || ')'
           else '' end,
      case when with_check is not null
           then ' with check (' || regexp_replace(with_check, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g') || ')'
           else '' end
    ) as stmt
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') ~ 'auth\.(uid|role|jwt|email)\(\)'
        or coalesce(with_check,'') ~ 'auth\.(uid|role|jwt|email)\(\)')
      and coalesce(qual,'') !~ '\(\s*select auth\.'
      and coalesce(with_check,'') !~ '\(\s*select auth\.'
  loop
    execute r.stmt;
  end loop;
end $$;

-- ROLLBACK: behaviour is identical, so no functional rollback needed. To restore
-- the literal text, re-run each policy's original definition (the bare auth.uid()
-- form) — see git history of the affected tables' policy migrations.
-- =============================================================================
