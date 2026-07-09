-- 2026-07-09: record the OAuth scopes granted per Google connection.
-- The connect flow now also requests gmail.readonly (to read client email for
-- CRM conversation logging). Storing the granted scope string from Google's
-- token response lets us verify a user actually approved read access
-- (send-only vs send+readonly) without decrypting their refresh token.

alter table public.user_google_accounts
  add column if not exists scopes text;

-- ROLLBACK: alter table public.user_google_accounts drop column if exists scopes;
