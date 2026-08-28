-- 2026-08-28: webseo_gsc_access v3 — same content as v2 (20260828200000) but
-- formatted the way the owner's reference screenshots show: bold phrases,
-- "## " section headings, a "- " bullet list, clickable URL + mailto links.
-- Requires the send-email edge function that renders markdown-lite markup
-- (supabase/functions/_shared/emailMarkup.ts) to be DEPLOYED FIRST — with
-- the old function the ** / ## markers would ship raw.
--
-- Backup: appends the current row to email_templates_backup_20260828
-- (created by 20260828200000; locked down, RLS on).
--
-- LIVE DRIFT CHECK: pending — record pre/post md5(body) here when applied.

insert into public.email_templates_backup_20260828
  select now(), t.* from public.email_templates t where t.key = 'webseo_gsc_access';

update public.email_templates
   set body = $body$Καλησπέρα σας,

Για να ξεκινήσουμε τις **τεχνικές βελτιώσεις και τις απαραίτητες ρυθμίσεις στην ιστοσελίδα σας**, θα χρειαστούμε τις παρακάτω προσβάσεις:

## 1. Πρόσβαση στη διαχείριση της ιστοσελίδας

Παρακαλούμε να μας αποστείλετε τα στοιχεία πρόσβασης στο διαχειριστικό περιβάλλον της ιστοσελίδας σας, είτε αυτή λειτουργεί σε **WordPress, OpenCart** είτε σε κάποια άλλη αντίστοιχη πλατφόρμα.

Θα χρειαστούμε:

- **Όνομα χρήστη**
- **Κωδικό πρόσβασης**
- Ιδανικά, **πλήρη δικαιώματα διαχειριστή (Administrator)**

Με αυτόν τον τρόπο θα μπορέσουμε να προχωρήσουμε άμεσα στις απαραίτητες τεχνικές ενέργειες.

Εάν δεν γνωρίζετε τα στοιχεία πρόσβασης ή την πλατφόρμα στην οποία έχει κατασκευαστεί η ιστοσελίδα σας, πιθανότατα τα διαχειρίζεται ο developer ή η εταιρεία που ανέλαβε την κατασκευή της. Σε αυτή την περίπτωση, μπορείτε να απευθυνθείτε σε αυτούς για τα σχετικά στοιχεία.

## 2. Πρόσβαση στο Google Search Console

Μπορείτε να ακολουθήσετε τα απαραίτητα βήματα μέσω του παρακάτω βίντεο:

https://shorturl.at/OqTid

Εναλλακτικά, ακολουθήστε τις παρακάτω οδηγίες:

**Βήμα 1 – Είσοδος**
Συνδεθείτε στον λογαριασμό σας στο **Google Search Console**.

**Βήμα 2 – Επιλογή ιδιοκτησίας**
Από το πτυσσόμενο μενού επάνω αριστερά, επιλέξτε την ιστοσελίδα στην οποία θέλετε να παραχωρήσετε πρόσβαση.

**Βήμα 3 – Ρυθμίσεις**
Κάντε κλικ στην επιλογή **«Ρυθμίσεις»**, στο κάτω μέρος της αριστερής στήλης.

**Βήμα 4 – Χρήστες και δικαιώματα**
Επιλέξτε την ενότητα **«Χρήστες και δικαιώματα»**.

**Βήμα 5 – Προσθήκη χρήστη**
Κάντε κλικ στο κουμπί **«Προσθήκη χρήστη»**, επάνω δεξιά.

**Βήμα 6 – Καταχώριση email**
Καταχωρίστε το email:

**info@itdev.gr**

Επιλέξτε **«Πλήρης άδεια»** και στη συνέχεια πατήστε **«Προσθήκη»**.

## Δεν διαθέτετε Google Search Console;

Εάν δεν διαθέτετε λογαριασμό ή ιδιοκτησία στο Google Search Console, ενημερώστε μας.

Μπορούμε να αναλάβουμε τη **δημιουργία και τη σωστή ρύθμισή του**, εφόσον διαθέτουμε πρόσβαση στη διαχείριση της ιστοσελίδας σας.

## Έναρξη εργασιών

Μόλις λάβουμε τις παραπάνω προσβάσεις, θα προχωρήσουμε άμεσα στις **τεχνικές ρυθμίσεις και τις απαραίτητες βελτιστοποιήσεις** της ιστοσελίδας.

## Χρειάζεστε βοήθεια;

Εάν αντιμετωπίσετε οποιαδήποτε δυσκολία κατά τη διαδικασία, μπορείτε να επικοινωνήσετε με τον υπεύθυνο Web SEO, **κ. Παύλο Ευσταθιάδη**:

**Email:** pefstathiadis@itdev.gr
**Τηλέφωνο:** 210 260 3414, εσωτερικό 104

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.$body$,
       updated_at = now()
 where key = 'webseo_gsc_access';

-- ROLLBACK:
-- update public.email_templates t
--    set body = b.body, updated_at = now()
--   from (select body from public.email_templates_backup_20260828
--          where key = 'webseo_gsc_access' order by backed_up_at desc limit 1) b
--  where t.key = 'webseo_gsc_access';
