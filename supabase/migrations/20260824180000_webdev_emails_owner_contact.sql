-- =============================================================================
-- 2026-08-24 (follow-up to 20260824170000/171000, owner feedback):
-- 1. All three webdev client emails now tell the client who is building their
--    site — κ. Marios Kifokeris, mkifokeris@itdev.gr, 210 260 3414 (εσωτ. 102)
--    — mirroring the responsible-person line of the SEO onboarding templates.
-- 2. From/Reply-To/CC support@itdev.gr: handled in send-email/index.ts by
--    adding webdev_client_form + webdev_waiting_nudge to the support-routing
--    template list (webdev_form_followup was already there). Deployed together
--    with this migration.
--
-- Templates are UPDATEd (the seeds use on-conflict-do-nothing, so re-running
-- older migrations cannot revert this). No function redefinitions, so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

update public.email_templates set body =
E'Αγαπητέ/ή {{client_name}},\n\nΓια να ξεκινήσουμε την κατασκευή της ιστοσελίδας σας, χρειαζόμαστε λίγο υλικό από εσάς. Μπορείτε να το καταχωρίσετε στη φόρμα μέσω του παρακάτω συνδέσμου:\n\n{{link}}\n\nΚαλό είναι να έχετε πρόχειρα τα εξής:\n• Το λογότυπό σας\n• Φωτογραφίες και υλικό της επιχείρησης\n• Κείμενα για τις σελίδες\n• Στοιχεία επικοινωνίας\n• Προτίμηση για domain (όνομα ιστοσελίδας)\n\nΟ σύνδεσμος παραμένει ενεργός, οπότε μπορείτε να επιστρέψετε και να συμπληρώσετε αργότερα ό,τι λείπει. Σημειώνουμε ότι ο σύνδεσμος λήγει, οπότε καλό είναι να ολοκληρώσετε τη φόρμα εγκαίρως.\n\nΤην κατασκευή της ιστοσελίδας σας έχει αναλάβει ο κ. Marios Kifokeris. Για οποιαδήποτε απορία μπορείτε να επικοινωνείτε μαζί του στο email mkifokeris@itdev.gr ή τηλεφωνικά στο 210 260 3414 (εσωτερικό 102).'
where key = 'webdev_client_form';

update public.email_templates set body =
E'Αγαπητέ/ή {{client_name}},\n\nΘα θέλαμε να σας υπενθυμίσουμε ότι για να προχωρήσουμε στην κατασκευή της ιστοσελίδας σας, χρειαζόμαστε τα στοιχεία και το υλικό σας μέσω της παρακάτω φόρμας:\n\n{{link}}\n\nΗ συμπλήρωση διαρκεί λίγα λεπτά και μπορείτε να επιστρέψετε αργότερα για ό,τι λείπει. Όσο πιο σύντομα λάβουμε το υλικό, τόσο πιο γρήγορα θα δείτε την ιστοσελίδα σας έτοιμη.\n\nΑν αντιμετωπίζετε οποιαδήποτε δυσκολία ή έχετε απορίες, μπορείτε να επικοινωνήσετε με τον υπεύθυνο κατασκευής, κ. Marios Kifokeris, στο email mkifokeris@itdev.gr ή τηλεφωνικά στο 210 260 3414 (εσωτερικό 102).'
where key = 'webdev_form_followup';

update public.email_templates set body =
E'Αγαπητέ/ή {{client_name}},\n\nΗ κατασκευή της ιστοσελίδας σας βρίσκεται σε εξέλιξη, αυτή τη στιγμή όμως περιμένουμε κάτι από εσάς για να συνεχίσουμε (π.χ. έγκριση, υλικό ή απάντηση σε μήνυμά μας).\n\nΘα σας παρακαλούσαμε να απαντήσετε σε αυτό το email ή να επικοινωνήσετε με τον υπεύθυνο κατασκευής, κ. Marios Kifokeris, στο email mkifokeris@itdev.gr ή τηλεφωνικά στο 210 260 3414 (εσωτερικό 102), ώστε να προχωρήσουμε χωρίς άλλη καθυστέρηση.\n\nΕυχαριστούμε πολύ για τη συνεργασία!'
where key = 'webdev_waiting_nudge';

-- ROLLBACK: restore the bodies seeded in 20260714150000 (webdev_client_form),
--   20260824170000 (webdev_form_followup) and 20260824171000 (webdev_waiting_nudge),
--   and drop the two template keys from the support-routing list in send-email.
