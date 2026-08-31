-- Lead titles become «Contact name (Form)» (owner request 2026-08-31; new
-- leads: api/_lead-title.ts). One-off backfill for existing form leads and
-- pending intake rows. Guards:
--   * meta/franchise sources only (manual leads keep their free-text titles);
--   * a contact name must exist;
--   * franchise rows ALWAYS get the literal «Name (Franchise)» label (matches
--     api/_lead-title.ts) — the raw franchise-form title is noisy and never
--     kept, even when it isn't exactly the person's name;
--   * meta rows keep their old title inside the parentheses (or fall back to
--     "Meta lead" when blank);
--   * a row qualifies only when its title does NOT already contain the full
--     contact name (first + last), UNLESS the title is the franchise
--     auto-title (title == full name) — that's the one case where a franchise
--     title legitimately contains the name and still needs the label added.
--     A hand-edited franchise title that merely CONTAINS but doesn't equal
--     the name (e.g. «Νίκος Χ. - Αθήνα») is deliberately left untouched.
-- Idempotent: every rewritten title contains the full contact name, so a
-- second run finds nothing left to rewrite (the containment check skips it).
-- Lossy by design: the old title survives inside the parentheses (meta rows
-- only — franchise rows always get the literal label, never the old title).

update public.leads l
   set title = left(
     nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), '')
       || ' (' ||
     case
       when l.source = 'franchise' then 'Franchise'
       else coalesce(nullif(trim(l.title), ''), 'Meta lead')
     end || ')', 200)
 where l.source in ('meta','franchise')
   and not l.archived
   and nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), '') is not null
   and (
     (l.source = 'franchise'
      and trim(coalesce(l.title,'')) = trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')))
     or position(lower(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,''))) in lower(coalesce(l.title,''))) = 0
   );

update public.lead_intake r
   set title = left(
     nullif(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')), '')
       || ' (' ||
     case
       when r.source = 'franchise' then 'Franchise'
       else coalesce(nullif(trim(r.title), ''), 'Meta lead')
     end || ')', 200)
 where r.source in ('meta','franchise')
   and r.status = 'pending'
   and nullif(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')), '') is not null
   and (
     (r.source = 'franchise'
      and trim(coalesce(r.title,'')) = trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')))
     or position(lower(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,''))) in lower(coalesce(r.title,''))) = 0
   );

-- ROLLBACK: lossy — the pre-backfill title survives only inside the trailing
-- parentheses (meta rows only); there is no automated undo. Restore from a
-- pre-apply snapshot if ever needed.
