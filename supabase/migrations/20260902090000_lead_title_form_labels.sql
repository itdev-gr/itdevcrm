-- Lead titles: normalize the form label inside the parentheses (owner request
-- 2026-09-02, follow-up to 20260831250000). Raw Meta form names are noisy
-- («📍 LOCAL SEO LEAD FORM — ITDEV») — known service keywords collapse to the
-- clean labels the owner named: Local SEO / Web SEO / AI SEO / Website.
-- Keep in sync with normalizeFormLabel() in api/_lead-title.ts (new leads).
--
-- Guards: meta only (franchise already carries the literal «Franchise»);
-- ONLY titles that are exactly our generated shape «<full contact name> (<form>)»
-- are touched — hand-written titles that merely contain a keyword never match
-- the exact-reconstruction check. Idempotent: already-clean labels are skipped.
-- lead_intake is not touched (0 pending rows at apply time; new intake rows
-- get the normalized title from the API).

with cand as (
  select l.id,
         nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), '') as name,
         substring(l.title from '\((.*)\)$') as form
    from public.leads l
   where l.source = 'meta' and not l.archived
)
update public.leads l
   set title = left(c.name || ' (' ||
     case
       when c.form ~* 'local[ _-]*seo' then 'Local SEO'
       when c.form ~* 'web[ _-]*seo'   then 'Web SEO'
       when c.form ~* 'ai[ _-]*seo'    then 'AI SEO'
       when c.form ~* 'website'        then 'Website'
     end || ')', 200)
  from cand c
 where c.id = l.id
   and c.name is not null
   and c.form is not null
   and l.title = c.name || ' (' || c.form || ')'
   and c.form ~* '(local[ _-]*seo|web[ _-]*seo|ai[ _-]*seo|website)'
   and c.form not in ('Local SEO', 'Web SEO', 'AI SEO', 'Website');

-- ROLLBACK: lossy for the parenthesized part (the raw form name is replaced by
-- the clean label; it still exists in leads.source_data). No automated undo.
