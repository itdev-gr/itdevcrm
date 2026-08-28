-- 2026-08-28: New Web SEO onboarding email (template webseo_gsc_access).
-- The email that fires when a web_seo job (incl. the AI SEO web child) lands
-- in `new_project` now asks for BOTH the website admin access (WordPress /
-- OpenCart / other) AND Google Search Console access, and tells the client we
-- can create the GSC property ourselves when they don't have one.
-- Text supplied by the owner verbatim (only blank-line spacing normalised).
--
-- Subject unchanged ("{{code}} - Πρόσβαση στο Google Search Console — ITDev").
-- Body is plain text: send-email escapes it, auto-linkifies URLs and turns
-- newlines into <br> (renderDbTemplate in supabase/functions/send-email).
--
-- The live row is admin-editable (email-templates UI), so the pre-change row
-- is backed up first (house rule: *_backup_<date>, locked down like
-- 20260806190000_lock_down_backup_tables.sql).
--
-- LIVE DRIFT CHECK 2026-08-28 (md5(body)), APPLIED same day via Management API:
--   webseo_gsc_access  pre  fae10de5be3f573d04b7e06a63479845 (1175 chars, = 20260624080000 seed,
--                           last updated 2026-06-24 — never edited in the UI)
--                      post 26a8fda61bebe0538775f964ded5c893 (2209 chars)
--   backup: email_templates_backup_20260828 = 1 row; test send enqueued to the owner.

-- 1. Backup the current row -------------------------------------------------
create table if not exists public.email_templates_backup_20260828 as
  select now() as backed_up_at, t.* from public.email_templates t where false;

insert into public.email_templates_backup_20260828
  select now(), t.* from public.email_templates t where t.key = 'webseo_gsc_access';

alter table public.email_templates_backup_20260828 enable row level security;
revoke all on table public.email_templates_backup_20260828 from authenticated, anon;

-- 2. New body ---------------------------------------------------------------
update public.email_templates
   set description = 'Web SEO onboarding — website admin + Google Search Console access request (sent when a web_seo job lands in new_project)',
       body = $body$Καλησπέρα σας,
Για να ξεκινήσουμε τις τεχνικές βελτιώσεις και τις απαραίτητες ρυθμίσεις στην ιστοσελίδα σας, θα χρειαστούμε τις παρακάτω προσβάσεις.

ΠΡΟΣΒΑΣΗ ΣΤΗ ΔΙΑΧΕΙΡΙΣΗ ΤΗΣ ΙΣΤΟΣΕΛΙΔΑΣ

Θα θέλαμε να μας αποστείλετε τα στοιχεία πρόσβασης στο διαχειριστικό περιβάλλον της ιστοσελίδας σας, είτε αυτή λειτουργεί σε WordPress, OpenCart είτε σε κάποια άλλη αντίστοιχη πλατφόρμα.
Χρειαζόμαστε το όνομα χρήστη και τον κωδικό πρόσβασης, ιδανικά με πλήρη δικαιώματα διαχειριστή, ώστε να μπορούμε να προχωρήσουμε άμεσα στις απαραίτητες ενέργειες.
Εάν δεν γνωρίζετε τα στοιχεία πρόσβασης ή την πλατφόρμα στην οποία έχει κατασκευαστεί η ιστοσελίδα σας, πιθανότατα τα διαχειρίζεται ο developer ή η εταιρεία που ανέλαβε την κατασκευή της. Σε αυτή την περίπτωση, μπορείτε να απευθυνθείτε σε αυτούς.

ΠΡΟΣΒΑΣΗ ΣΤΟ GOOGLE SEARCH CONSOLE

Μπορείτε να παρακολουθήσετε τα απαραίτητα βήματα στο παρακάτω βίντεο:
https://shorturl.at/OqTid

Εναλλακτικά, μπορείτε να ακολουθήσετε τις παρακάτω γραπτές οδηγίες:

Βήμα 1: Είσοδος
Συνδεθείτε στον λογαριασμό σας στο Google Search Console.

Βήμα 2: Επιλογή ιδιοκτησίας
Από το πτυσσόμενο μενού επάνω αριστερά, επιλέξτε την ιστοσελίδα στην οποία θέλετε να παραχωρήσετε πρόσβαση.

Βήμα 3: Ρυθμίσεις
Κάντε κλικ στην επιλογή «Ρυθμίσεις», στο κάτω μέρος της αριστερής στήλης.

Βήμα 4: Χρήστες και δικαιώματα
Επιλέξτε την ενότητα «Χρήστες και δικαιώματα».

Βήμα 5: Προσθήκη χρήστη
Κάντε κλικ στο κουμπί «Προσθήκη χρήστη», επάνω δεξιά.

Βήμα 6: Καταχώριση email
Καταχωρίστε το email info@itdev.gr, επιλέξτε «Πλήρης άδεια» και πατήστε «Προσθήκη».

ΔΕΝ ΔΙΑΘΕΤΕΤΕ GOOGLE SEARCH CONSOLE;

Εάν δεν διαθέτετε λογαριασμό ή ιδιοκτησία στο Google Search Console, ενημερώστε μας. Μπορούμε να αναλάβουμε τη δημιουργία και τη σωστή ρύθμισή του, εφόσον διαθέτουμε πρόσβαση στη διαχείριση της ιστοσελίδας.

ΕΝΑΡΞΗ ΕΡΓΑΣΙΩΝ

Μόλις λάβουμε τις παραπάνω προσβάσεις, θα ξεκινήσουμε άμεσα τις τεχνικές ρυθμίσεις και τις απαραίτητες βελτιστοποιήσεις.

ΧΡΕΙΑΖΕΣΤΕ ΒΟΗΘΕΙΑ;

Εάν αντιμετωπίσετε οποιαδήποτε δυσκολία, μπορείτε να επικοινωνήσετε με τον υπεύθυνο Web SEO, κ. Παύλο Ευσταθιάδη:
Email: pefstathiadis@itdev.gr
Τηλέφωνο: 210 260 3414, εσωτερικό 104

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.$body$,
       updated_at = now()
 where key = 'webseo_gsc_access';

-- ROLLBACK:
-- update public.email_templates t
--    set description = b.description, body = b.body, updated_at = now()
--   from public.email_templates_backup_20260828 b
--  where b.key = t.key and t.key = 'webseo_gsc_access';
-- drop table if exists public.email_templates_backup_20260828;
