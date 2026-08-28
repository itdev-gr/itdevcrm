-- =============================================================================
-- 2026-08-28: Offer-email composer templates.
-- These rows are COMPOSER SOURCES: the frontend (OfferEmailDialog) assembles
-- the offer email from them client-side and sends it via the salesperson's
-- Gmail as templateKey 'custom' — send-email never renders these keys, so no
-- email_automation_settings gates and no outbox wiring are needed.
--   * offer_email_intro : its subject IS the email subject; body = greeting.
--   * offer_svc_<type>  : its subject is the service block HEADING; body =
--                         short Greek description of the service, NO prices
--                         (prices live in the attached offer PDF).
--   * offer_email_outro : call-to-action + sign-off.
-- Placeholder copy — the owner will refine the texts in /admin/email-automations
-- (they appear there automatically; the page lists every email_templates row).
-- =============================================================================

insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('offer_email_intro',
 'Offer composer — εισαγωγή. Το subject είναι το θέμα του email. Συντάσσεται στον composer προσφοράς (δεν στέλνεται αυτόματα).',
 'Η προσφορά μας για εσάς — {{offer_number}}',
 E'Αγαπητέ/ή {{name}},\n\nΣας ευχαριστούμε θερμά για το ενδιαφέρον σας και για τον χρόνο που μας διαθέσατε. Θα βρείτε συνημμένη την αναλυτική προσφορά μας ({{offer_number}}) με τις τιμές των υπηρεσιών. Η προσφορά ισχύει για {{validity_days}} ημέρες.\n\nΠαρακάτω θα βρείτε μια σύντομη περιγραφή των υπηρεσιών που περιλαμβάνει:',
 'name, offer_number, validity_days', true),

('offer_email_outro',
 'Offer composer — κατακλείδα (call to action). Το subject ΔΕΝ χρησιμοποιείται στο email.',
 '(κατακλείδα — δεν εμφανίζεται στο email)',
 E'Παραμένουμε στη διάθεσή σας για οποιαδήποτε απορία ή προσαρμογή της προσφοράς στις ανάγκες σας. Μπορείτε απλώς να απαντήσετε σε αυτό το email ή να μας καλέσετε.\n\nΜε εκτίμηση,\n{{owner_name}}',
 'owner_name', true),

('offer_svc_web_dev',
 'Offer composer — μπλοκ υπηρεσίας: Κατασκευή Ιστοσελίδας. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Κατασκευή Ιστοσελίδας',
 E'Σχεδιάζουμε και κατασκευάζουμε σύγχρονες, γρήγορες και πλήρως λειτουργικές ιστοσελίδες, προσαρμοσμένες στην εικόνα και τις ανάγκες της επιχείρησής σας.\n\nΗ κατασκευή περιλαμβάνει σχεδιασμό, υλοποίηση και βασική βελτιστοποίηση, ώστε η ιστοσελίδα σας να είναι έτοιμη να υποδεχθεί πελάτες από την πρώτη μέρα.',
 '', true),

('offer_svc_web_seo',
 'Offer composer — μπλοκ υπηρεσίας: Web SEO. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Προώθηση Ιστοσελίδας (Web SEO)',
 E'Βελτιστοποιούμε την ιστοσελίδα σας ώστε να εμφανίζεται ψηλότερα στα αποτελέσματα της Google για τις αναζητήσεις που ενδιαφέρουν τους πελάτες σας.\n\nΗ υπηρεσία περιλαμβάνει τεχνικό έλεγχο, βελτιστοποίηση περιεχομένου και συνεχή παρακολούθηση της πορείας των λέξεων-κλειδιών.',
 '', true),

('offer_svc_local_seo',
 'Offer composer — μπλοκ υπηρεσίας: Local SEO. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Τοπική Προώθηση (Local SEO)',
 E'Ενισχύουμε την παρουσία της επιχείρησής σας στις τοπικές αναζητήσεις και στον χάρτη της Google (Google Business Profile), ώστε να σας βρίσκουν πελάτες της περιοχής σας τη στιγμή που σας χρειάζονται.\n\nΗ υπηρεσία περιλαμβάνει βελτιστοποίηση του προφίλ σας, διαχείριση αξιολογήσεων και συνεχή παρακολούθηση της κατάταξης.',
 '', true),

('offer_svc_social_media',
 'Offer composer — μπλοκ υπηρεσίας: Social Media. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Διαχείριση Social Media',
 E'Αναλαμβάνουμε την παρουσία της επιχείρησής σας στα μέσα κοινωνικής δικτύωσης με στοχευμένο περιεχόμενο που χτίζει το κοινό σας και αναδεικνύει τη δουλειά σας.\n\nΗ υπηρεσία περιλαμβάνει πλάνο περιεχομένου, δημιουργικά και τακτικές δημοσιεύσεις.',
 '', true),

('offer_svc_ai_seo',
 'Offer composer — μπλοκ υπηρεσίας: AI SEO. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'AI SEO',
 E'Συνδυαστικό πρόγραμμα προώθησης που καλύπτει ταυτόχρονα την ιστοσελίδα σας (Web SEO) και την τοπική σας παρουσία (Local SEO), με αξιοποίηση εργαλείων τεχνητής νοημοσύνης για ταχύτερα και μετρήσιμα αποτελέσματα.',
 '', true),

('offer_svc_hosting',
 'Offer composer — μπλοκ υπηρεσίας: Φιλοξενία. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Φιλοξενία Ιστοσελίδας (Hosting)',
 E'Ασφαλής και γρήγορη φιλοξενία της ιστοσελίδας σας σε σύγχρονη υποδομή, με τακτικά αντίγραφα ασφαλείας και τεχνική εποπτεία ώστε να είναι πάντα διαθέσιμη στους πελάτες σας.',
 '', true),

('offer_svc_ads',
 'Offer composer — μπλοκ υπηρεσίας: Διαφημίσεις. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Διαφημιστικές Καμπάνιες (Ads)',
 E'Σχεδιάζουμε και διαχειριζόμαστε στοχευμένες διαφημιστικές καμπάνιες (Google / Meta) που φέρνουν την επιχείρησή σας μπροστά στο σωστό κοινό, με συνεχή βελτιστοποίηση για το καλύτερο δυνατό αποτέλεσμα από το διαφημιστικό σας budget.',
 '', true),

('offer_svc_maintenance',
 'Offer composer — μπλοκ υπηρεσίας: Υποστήριξη/Συντήρηση. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Τεχνική Υποστήριξη & Συντήρηση',
 E'Φροντίζουμε την ιστοσελίδα σας σε συνεχή βάση: ενημερώσεις, ασφάλεια, μικροαλλαγές περιεχομένου και άμεση τεχνική υποστήριξη όποτε τη χρειαστείτε.',
 '', true),

('offer_svc_franchise',
 'Offer composer — μπλοκ υπηρεσίας: Franchise. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Πρόγραμμα Franchise',
 E'Ολοκληρωμένη ψηφιακή υποστήριξη για δίκτυα franchise: ενιαία εικόνα, τοπική προβολή κάθε καταστήματος και κεντρικός συντονισμός της προώθησης.',
 '', true),

('offer_svc_domains',
 'Offer composer — μπλοκ υπηρεσίας: Domains. Το subject είναι η επικεφαλίδα του μπλοκ.',
 'Κατοχύρωση & Διαχείριση Domain',
 E'Κατοχύρωση, ανανέωση και διαχείριση των domain της επιχείρησής σας, ώστε τα ονόματά σας στο διαδίκτυο να είναι πάντα ασφαλή και ενημερωμένα.',
 '', true)

on conflict (key) do nothing;

-- ROLLBACK: delete from public.email_templates where key like 'offer_svc_%'
--           or key in ('offer_email_intro','offer_email_outro');
