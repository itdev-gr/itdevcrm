-- =============================================================================
-- 2026-08-28: Service descriptions move from the offer EMAIL into the offer
-- PDF. api/offer-pdf.ts now injects each offer_svc_<type> template body into
-- the PDF's «Δυνατότητες - Υπηρεσίες» section (above the item bullets of its
-- category); the email keeps only intro (with the public link) + CTA outro.
-- The offer_svc_* rows stay in email_templates so the /admin/email-automations
-- copy editor keeps working — only their role (and descriptions) change.
-- Edits apply on the next PDF generation (composer open / staff PDF click).
-- =============================================================================

-- Email intro: stop promising a service list in the email body.
update public.email_templates
   set body = E'Αγαπητέ/ή {{name}},\n\nΣας ευχαριστούμε θερμά για το ενδιαφέρον σας και για τον χρόνο που μας διαθέσατε. Θα βρείτε την αναλυτική προσφορά μας ({{offer_number}}) με τις τιμές και την περιγραφή κάθε υπηρεσίας στον παρακάτω σύνδεσμο:\n{{offer_url}}\n\nΗ προσφορά ισχύει για {{validity_days}} ημέρες.',
       updated_at = now()
 where key = 'offer_email_intro';

-- Re-describe the service blocks: they render in the PDF now.
update public.email_templates
   set description = 'Προσφορά (PDF) — περιγραφή υπηρεσίας στην ενότητα «Δυνατότητες - Υπηρεσίες» του PDF. Το body εμφανίζεται κάτω από την μπάρα της κατηγορίας· το subject ΔΕΝ χρησιμοποιείται. Οι αλλαγές πιάνουν στο επόμενο PDF.',
       updated_at = now()
 where key like 'offer_svc_%';

-- ROLLBACK: restore the 20260828180000 intro body (with the «Παρακάτω θα
-- βρείτε…» closing line) and the «Offer composer — μπλοκ υπηρεσίας» descriptions.
