-- =============================================================================
-- Brand: email signatures say ITDEV (all caps), not ITDev.
-- Updates every seeded/edited template row; the edge-function from-names and
-- footers change in the same commit.
--
-- Rollback: not meaningful (cosmetic, and admin-edited texts would be lost);
-- re-edit texts via Settings → Email automations if needed.
-- =============================================================================

update public.email_templates
   set subject = replace(subject, 'ITDev', 'ITDEV'),
       body    = replace(body, 'ITDev', 'ITDEV')
 where subject like '%ITDev%' or body like '%ITDev%';
