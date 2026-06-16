-- Replace the pre-payment reminder (payment_due_soon) copy with the new
-- client-facing version: full payment instructions (NBG + Piraeus IBANs,
-- Viva Wallet link). [ΠΟΣΟ] maps to the existing {{amount_gross}} variable.
-- The DB email_templates row is authoritative (send-email uses renderDbTemplate
-- when a row exists), so this is the only change needed to alter the sent email.
update public.email_templates
   set subject = 'Υπενθύμιση πληρωμής — λήγει {{due_date}}',
       body = $body$Καλησπέρα σας,

Ελπίζουμε να είστε καλά.

Θα θέλαμε να σας υπενθυμίσουμε ότι πλησιάζει η ημερομηνία της προγραμματισμένης μηνιαίας πληρωμής, στο πλαίσιο της μεταξύ μας συνεργασίας.

Παρακαλούμε όπως μεριμνήσετε για την τακτοποίηση του ποσού εντός των επόμενων ημερών.

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

Παρακαλούμε, με την ολοκλήρωση της πληρωμής, να μας αποστείλετε το σχετικό αποδεικτικό.

Είμαστε στη διάθεσή σας για οποιαδήποτε διευκρίνιση ή απορία.$body$,
       variables = 'amount_gross, due_date',
       updated_at = now()
 where key = 'payment_due_soon';

-- ROLLBACK: restore the prior content
-- update public.email_templates
--    set subject = 'Υπενθύμιση πληρωμής — λήγει {{due_date}}',
--        body = $body$Αγαπητέ/ή {{client_name}},
--
-- Σας υπενθυμίζουμε ότι η πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ λήγει στις {{due_date}}.
--
-- Με εκτίμηση,
-- ITDEV Λογιστήριο$body$,
--        variables = 'client_name, service_type, amount_gross, due_date'
--  where key = 'payment_due_soon';
