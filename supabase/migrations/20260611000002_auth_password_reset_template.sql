-- =============================================================================
-- Password reset email template (auth_password_reset).
--
-- Sent by the auth-email edge function when Supabase Auth fires the
-- "send email" hook for a password-recovery request. Staff-facing, so
-- client_facing = false (no unsubscribe footer). The send path appends a
-- styled CTA button; {{reset_url}} in the body is the copy-paste fallback.
--
-- Rollback:
--   delete from public.email_templates where key = 'auth_password_reset';
-- =============================================================================

insert into public.email_templates (key, description, subject, body, variables, client_facing)
values (
  'auth_password_reset',
  'Επαναφορά κωδικού — στέλνεται όταν χρήστης ζητήσει reset από τη σελίδα σύνδεσης',
  'Επαναφορά κωδικού ITDEV CRM / ITDEV CRM password reset',
  E'Γεια σας,\n\nΛάβαμε αίτημα επαναφοράς του κωδικού σας στο ITDEV CRM. Πατήστε το κουμπί παρακάτω για να ορίσετε νέο κωδικό. Ο σύνδεσμος ισχύει για 1 ώρα και μπορεί να χρησιμοποιηθεί μία φορά.\n\nΑν δεν ζητήσατε εσείς την επαναφορά, αγνοήστε αυτό το email.\n\nΑν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο: {{reset_url}}\n\n---\n\nHello,\n\nWe received a request to reset your ITDEV CRM password. Click the button below to set a new password. The link is valid for 1 hour and can be used once.\n\nIf you didn''t request this, you can safely ignore this email.\n\nIf the button doesn''t work, copy this link: {{reset_url}}',
  'reset_url',
  false
)
on conflict (key) do nothing;
