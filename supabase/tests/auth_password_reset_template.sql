-- supabase/tests/auth_password_reset_template.sql
--
-- SQL smoke test for the auth_password_reset email template seed.
--
-- HOW TO RUN:
--   PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
--     "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" \
--     -f supabase/tests/auth_password_reset_template.sql
--
-- Read-only checks inside a rolled-back transaction; no data is modified.

begin;

do $$
declare
  r public.email_templates%rowtype;
begin
  select * into r from public.email_templates where key = 'auth_password_reset';
  if r.key is null then
    raise exception 'auth_password_reset template row missing';
  end if;
  if r.client_facing then
    raise exception 'auth_password_reset must have client_facing = false (staff email, no unsubscribe footer)';
  end if;
  if position('{{reset_url}}' in r.body) = 0 then
    raise exception 'body must contain the {{reset_url}} fallback link';
  end if;
  if position('Γεια σας' in r.body) = 0 then
    raise exception 'body must contain the Greek section';
  end if;
  if position('Hello' in r.body) = 0 then
    raise exception 'body must contain the English section';
  end if;
  if r.variables <> 'reset_url' then
    raise exception 'variables must list reset_url (admin UI hint)';
  end if;
  raise notice 'auth_password_reset template OK';
end $$;

rollback;
