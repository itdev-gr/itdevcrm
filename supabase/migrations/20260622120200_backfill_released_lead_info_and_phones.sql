-- One-time backfill of leads released from intake before the columnar/notes fixes:
-- (A) move the campaign/answers block from Primary Contact (contact_info) into Lead info
--     (notes), where Lead info is still empty;
-- (B) fill any blank phone (and company) from the lead's own intake source_data, reading
--     the exact phone field (Greek `αριθμός_τηλεφώνου` or columnar `COL$O`, `p:` stripped).
-- Fill-blank only — never overwrites a value a user already set.

-- (A) Lead-info placement for already-released rows.
update public.leads l
   set notes = coalesce(nullif(l.notes, ''), l.contact_info),
       contact_info = null,
       updated_at = now()
  from public.lead_intake li
 where li.released_lead_id = l.id
   and li.status = 'released'
   and coalesce(l.contact_info, '') <> ''
   and coalesce(l.notes, '') = '';

-- (B) Phone (+ company) backfill from source_data, deterministic keys, fill-blank.
update public.leads l
   set phone = nullif(regexp_replace(coalesce(li.source_data->>'αριθμός_τηλεφώνου', li.source_data->>'COL$O'), '^p:', ''), ''),
       company_name = coalesce(nullif(l.company_name, ''), nullif(li.source_data->>'όνομα_εταιρείας', '')),
       updated_at = now()
  from public.lead_intake li
 where li.released_lead_id = l.id
   and li.status = 'released'
   and coalesce(l.phone, '') = ''
   and nullif(regexp_replace(coalesce(li.source_data->>'αριθμός_τηλεφώνου', li.source_data->>'COL$O'), '^p:', ''), '') is not null;
