-- Replace the due-date reminder (payment_due_today) copy with the new
-- client-facing version (outstanding-payment tone, full payment instructions).
-- [ΠΟΣΟ] maps to the existing {{amount_gross}} variable. Subject kept as-is.
update public.email_templates
   set body = $body$Καλησπέρα σας,

Ελπίζουμε να είστε καλά.

Θα θέλαμε να σας ενημερώσουμε ότι υπάρχει εκκρεμότητα σχετικά με την προγραμματισμένη πληρωμή της μεταξύ μας συνεργασίας.

Παρακαλούμε όπως μεριμνήσετε για την τακτοποίηση του ποσού το συντομότερο δυνατό, ώστε να συνεχιστεί ομαλά και απρόσκοπτα η παροχή των υπηρεσιών μας.

Ποσό πληρωμής: {{amount_gross}}€

Παρακάτω θα βρείτε τους διαθέσιμους τρόπους πληρωμής:

Τράπεζα Εθνικής

IBAN: GR4401101670000091004687462
SWIFT/BIC: ETHNGRAA
Δικαιούχος: IT DEV EE
Τράπεζα: Εθνική Τράπεζα Ελλάδος (NBG)

Τράπεζα Πειραιώς

IBAN: GR31 0172 1470 0051 4711 0472 667
SWIFT/BIC: PIRBGRAA
Δικαιούχος: IT DEV E.E. / IT DEV S.P.
Α.Φ.Μ.: 802223278

Viva Wallet

Άμεσος σύνδεσμος πληρωμής:
https://pay.vivawallet.com/it-dev

Σε περίπτωση που η πληρωμή έχει ήδη πραγματοποιηθεί, παρακαλούμε αγνοήστε το παρόν μήνυμα και αποστείλετέ μας το σχετικό αποδεικτικό, ώστε να ενημερώσουμε το αρχείο μας.

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση ή απορία.$body$,
       variables = 'amount_gross',
       updated_at = now()
 where key = 'payment_due_today';

-- ROLLBACK: restore the prior content
-- update public.email_templates
--    set body = $body$Αγαπητέ/ή {{client_name}},
--
-- Η πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ λήγει σήμερα {{due_date}}.
--
-- Με εκτίμηση,
-- ITDEV Λογιστήριο$body$,
--        variables = 'client_name, service_type, amount_gross, due_date'
--  where key = 'payment_due_today';
