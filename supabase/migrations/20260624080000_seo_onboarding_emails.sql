-- 20260624080000_seo_onboarding_emails.sql
-- =============================================================================
-- Automated onboarding emails when an SEO job is created:
--   * web_seo  job (incl. the AI SEO web child)   -> Google Search Console access
--   * local_seo job (incl. the AI SEO local child) -> Google Business Profile access
-- Sent to the deal's client email. Fires on jobs INSERT (covers every creation
-- path: release_jobs_for_deal at first "Paid In Full", accounting_mark_paid_in_full,
-- create_custom_job, and the AI SEO trio).
--
-- SAFETY: gated by email_automation_enabled() = global switch AND the per-automation
-- key. While emails are "closed" (email_automation_settings.global.enabled = false)
-- this enqueues NOTHING. Re-open by flipping `global` (and the per-key) to true.
-- =============================================================================

-- 1. Templates (editable later in the email-templates admin UI). Plain text;
--    newlines render as <br>, URLs auto-linkify in the send-email function.
insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('webseo_gsc_access',
 'Web SEO onboarding — Google Search Console access request (sent when a web_seo job is created)',
 'Πρόσβαση στο Google Search Console — ITDev',
 E'Καλησπέρα σας,\nΠαρακάτω θα βρείτε  αναλυτικές οδηγίες (βήμα προς βήμα) για το πώς μπορείτε να μας παραχωρήσετε πρόσβαση στο Google Search Console της επιχείρησής σας:\n\nΜπορείτε να δείτε τα βήματα στο παρακάτω βίντεο αλλιώς υπάρχουν και γραπτώς.\nhttps://shorturl.at/OqTid\n\n1. Είσοδος: Συνδεθείτε στον λογαριασμό σας στο Google Search Console.\n\n2. Επιλογή Ιδιότητας: Από το πτυσσόμενο μενού πάνω αριστερά, επιλέξτε την ιστοσελίδα (property) στην οποία θέλετε να δώσετε πρόσβαση.\n\n3. Ρυθμίσεις: Κάντε κλικ στην επιλογή Ρυθμίσεις (Settings) που βρίσκεται στο κάτω μέρος της αριστερής πλαϊνής στήλης.\n\n4. Χρήστες και δικαιώματα: Πατήστε στην ενότητα Χρήστες και δικαιώματα (Users and permissions).\n\n5. Προσθήκη χρήστη: Κάντε κλικ στο κουμπί Προσθήκη χρήστη (Add user) πάνω δεξιά.\n\n6. Εισαγάγετε το email: info@itdev.gr με πλήρης άδεια και πατήστε προσθήκη.\n\nΠαρακαλούμε ακολουθήστε τις παραπάνω οδηγίες, ώστε να μπορέσουμε να ξεκινήσουμε άμεσα τις εργασίες από πλευράς μας.\nΣε περίπτωση που αντιμετωπίσετε οποιαδήποτε δυσκολία, μπορείτε να επικοινωνήσετε με τον υπεύθυνο Web SEO, κ. Παύλο Ευσταθιάδη, στο email pefstathiadis@itdev.gr ή τηλεφωνικά στο 210 260 3414 (εσωτερικό 104).',
 '', true),
('localseo_gbp_access',
 'Local SEO onboarding — Google Business Profile access request (sent when a local_seo job is created)',
 'Πρόσβαση στο Google Business Profile — ITDev',
 E'Καλησπέρα σας,\nΠαρακάτω θα βρείτε έναν σύνδεσμο με αναλυτικές οδηγίες (βήμα προς βήμα) για το πώς μπορείτε να μας παραχωρήσετε πρόσβαση στο Google Business Profile της επιχείρησής σας:\n\nhttps://tutorial-local.itdev.gr/\n\nΕναλλακτικά, μπορείτε να ακολουθήσετε τα παρακάτω βήματα:\nΣυνδεθείτε στον browser με το email που είναι συνδεδεμένο με την επιχείρηση.\nΑνοίξτε νέα καρτέλα, πατήστε τις τρεις τελείες επάνω δεξιά και επιλέξτε Διαχείριση επιχειρηματικού προφίλ.\nΠατήστε ξανά τις τρεις τελείες δεξιά και επιλέξτε Ρυθμίσεις εταιρικού προφίλ.\nΕπιλέξτε Άτομα και πρόσβαση.\nΠατήστε Προσθήκη και προσκαλέστε ως διαχειριστή το email: itdevgr24@gmail.com.\nΠαρακαλούμε ακολουθήστε τις παραπάνω οδηγίες, ώστε να μπορέσουμε να ξεκινήσουμε άμεσα τις εργασίες από πλευράς μας.\nΣε περίπτωση που αντιμετωπίσετε οποιαδήποτε δυσκολία, μπορείτε να επικοινωνήσετε με τον υπεύθυνο Local SEO, κ. Δημήτρη Τζουβάρα, στο email dtzouvaras@itdev.gr ή τηλεφωνικά στο 210 260 3414 (εσωτερικό 103).',
 '', true)
on conflict (key) do nothing;

-- 2. Per-automation switches. enabled=true, but held OFF by the master `global`
--    switch (currently false). When emails are re-opened (global=true) these fire.
insert into public.email_automation_settings (key, description, enabled) values
('webseo_gsc',  'Web SEO onboarding — GSC access email when a web_seo job is created', true),
('localseo_gbp','Local SEO onboarding — GBP access email when a local_seo job is created', true)
on conflict (key) do nothing;

-- 3. Trigger: enqueue the right onboarding email on a new SEO job.
create or replace function public.jobs_seo_onboarding_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_setting_key text;
  v_template_key text;
  v_email text;
  v_dedupe text;
begin
  if new.service_type = 'web_seo' then
    v_setting_key := 'webseo_gsc';
    v_template_key := 'webseo_gsc_access';
  elsif new.service_type = 'local_seo' then
    v_setting_key := 'localseo_gbp';
    v_template_key := 'localseo_gbp_access';
  else
    return new;
  end if;

  -- Master kill switch AND per-automation switch. While emails are closed
  -- (global=false) this is false, so nothing is ever enqueued.
  if not public.email_automation_enabled(v_setting_key) then
    return new;
  end if;

  select email into v_email from public.clients where id = new.client_id;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  -- One onboarding email per deal per service type (covers an AI SEO child and
  -- a standalone job on the same deal without double-sending).
  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log where dedupe_key = v_dedupe and status = 'sent')
     or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe and status = 'pending') then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, v_template_key, '{}'::jsonb, v_dedupe);

  return new;
end $$;

drop trigger if exists jobs_seo_onboarding_email on public.jobs;
create trigger jobs_seo_onboarding_email
  after insert on public.jobs
  for each row execute function public.jobs_seo_onboarding_email();

-- ROLLBACK:
--   drop trigger if exists jobs_seo_onboarding_email on public.jobs;
--   drop function if exists public.jobs_seo_onboarding_email();
--   delete from public.email_automation_settings where key in ('webseo_gsc','localseo_gbp');
--   delete from public.email_templates where key in ('webseo_gsc_access','localseo_gbp_access');
