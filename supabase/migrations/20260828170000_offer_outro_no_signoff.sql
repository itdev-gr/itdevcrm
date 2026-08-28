-- =============================================================================
-- 2026-08-28: offer_email_outro loses the «Με εκτίμηση, {{owner_name}}»
-- sign-off — personal-Gmail sends append the salesperson's signature
-- automatically, so the name appeared twice in the received email.
-- The CTA sentence stays; only the sign-off goes.
-- =============================================================================

update public.email_templates
   set body = 'Παραμένουμε στη διάθεσή σας για οποιαδήποτε απορία ή προσαρμογή της προσφοράς στις ανάγκες σας. Μπορείτε απλώς να απαντήσετε σε αυτό το email ή να μας καλέσετε.',
       variables = '',
       description = 'Offer composer — κατακλείδα (call to action). Η υπογραφή μπαίνει αυτόματα από το Gmail — ΜΗΝ προσθέσετε «Με εκτίμηση» εδώ.',
       updated_at = now()
 where key = 'offer_email_outro';

-- ROLLBACK: update public.email_templates set
--   body = E'Παραμένουμε στη διάθεσή σας για οποιαδήποτε απορία ή προσαρμογή της προσφοράς στις ανάγκες σας. Μπορείτε απλώς να απαντήσετε σε αυτό το email ή να μας καλέσετε.\n\nΜε εκτίμηση,\n{{owner_name}}',
--   variables = 'owner_name' where key = 'offer_email_outro';
