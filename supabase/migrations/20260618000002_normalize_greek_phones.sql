-- One-time cleanup: normalize Greek phone numbers to the 10-digit national form
-- (strip +30 / 0030 / spaces / dashes), e.g. "+30 697 474 2308" -> "6974742308".
-- Only touches numbers matching the Greek pattern (10 digits starting 6 or 2,
-- optionally prefixed by 30/0030); foreign numbers (e.g. Cyprus +357) are left
-- untouched. phone_normalized is a GENERATED column and auto-recomputes from phone
-- (used by the PBX caller-ID lookup find_contact_by_phone).
update public.leads set phone = regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^(0030|30)','')
where regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^(0030|30)?[62][0-9]{9}$'
  and phone is distinct from regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^(0030|30)','');

update public.clients set phone = regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^(0030|30)','')
where regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^(0030|30)?[62][0-9]{9}$'
  and phone is distinct from regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^(0030|30)','');

-- ROLLBACK: none — irreversible data cleanup (original formats not retained).
