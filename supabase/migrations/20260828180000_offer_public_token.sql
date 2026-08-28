-- =============================================================================
-- 2026-08-28: Public offer link.
-- The offer email now sends the client a permanent no-login URL
-- (https://www.itdevcrm.com/o/<public_token>) instead of attaching the PDF.
-- The anonymous client NEVER touches the offers table or the offer-pdfs bucket
-- directly — the only ingress is the Vercel function api/offer-view.ts, which
-- looks the offer up by token with the service-role key and streams the PDF.
-- Same security model as the client intake form (20260714150000): NO anon
-- policies, NO anon grants.
-- =============================================================================

alter table public.offers
  add column public_token uuid not null unique default gen_random_uuid();

-- Belt and braces: nothing anonymous ever reads offers via PostgREST.
revoke all on public.offers from anon;

-- The offer email intro now points at the link instead of the attachment.
update public.email_templates
   set body = E'Αγαπητέ/ή {{name}},\n\nΣας ευχαριστούμε θερμά για το ενδιαφέρον σας και για τον χρόνο που μας διαθέσατε. Θα βρείτε την αναλυτική προσφορά μας ({{offer_number}}) με τις τιμές των υπηρεσιών στον παρακάτω σύνδεσμο:\n{{offer_url}}\n\nΗ προσφορά ισχύει για {{validity_days}} ημέρες.\n\nΠαρακάτω θα βρείτε μια σύντομη περιγραφή των υπηρεσιών που περιλαμβάνει:',
       variables = 'name, offer_number, validity_days, offer_url',
       updated_at = now()
 where key = 'offer_email_intro';

-- ROLLBACK:
--   alter table public.offers drop column public_token;
--   restore the 20260828150000 intro body («Θα βρείτε συνημμένη την αναλυτική
--   προσφορά μας…», variables 'name, offer_number, validity_days').
