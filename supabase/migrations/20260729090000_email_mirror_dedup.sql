-- =============================================================================
-- 2026-07-29: Merge mirror+capture duplicate email rows (dup Mail-tab bug,
-- spec docs/superpowers/specs/2026-07-29-email-mirror-dedup-design.md).
-- Every automated Resend send wrote a mirror row (message_id 'resend:<id>')
-- AND was captured from the dept-CC'd shared mailbox under the real RFC822
-- Message-ID — two rows for one email. Keep the captured row (it has the
-- Gmail thread + html body), fold in the mirror's bcc/cc, delete the mirror.
-- Pairing is 1:1 (a capture absorbs at most one mirror) so a mirror whose
-- capture failed is never deleted via someone else's twin.
-- =============================================================================
begin;

create temp table _mirror_pairs on commit drop as
with cand as (
  select m.id as mirror_id, c.id as kept_id,
         abs(extract(epoch from (m.sent_at - c.sent_at))) as delta
  from public.email_messages m
  join public.email_messages c
    on  c.to_email = m.to_email
    and c.subject is not distinct from m.subject
    and c.direction = 'outbound'
    and c.deal_id  is not distinct from m.deal_id
    and c.lead_id  is not distinct from m.lead_id
    and c.message_id not like 'resend:%'
    and c.message_id not like '<crm-%'
    and abs(extract(epoch from (m.sent_at - c.sent_at))) <= 1800
  where m.message_id like 'resend:%'
    and m.direction = 'outbound'
),
mirror_best as (  -- each mirror's nearest capture
  select distinct on (mirror_id) mirror_id, kept_id, delta
  from cand order by mirror_id, delta
)
-- each capture keeps only its nearest claiming mirror (1:1)
select distinct on (kept_id) mirror_id, kept_id
from mirror_best order by kept_id, delta;

-- Backup: full mirror rows + which twin absorbed them + their bcc payload.
create table if not exists public.email_mirror_dedup_backup_20260729 as
select m.*, p.kept_id as kept_twin_id, b.bcc_emails as mirror_bcc
from _mirror_pairs p
join public.email_messages m on m.id = p.mirror_id
left join public.email_message_bcc b on b.message_pk = m.id;

-- Fold the mirror's admin-only bcc into the kept twin (union, never clobber).
insert into public.email_message_bcc (message_pk, bcc_emails)
select p.kept_id, mb.bcc_emails
from _mirror_pairs p
join public.email_message_bcc mb on mb.message_pk = p.mirror_id
on conflict (message_pk) do update
  set bcc_emails = (
    select string_agg(distinct x, ',')
    from unnest(string_to_array(
      email_message_bcc.bcc_emails || ',' || excluded.bcc_emails, ',')) as x
  );

-- Keep the dept CC when the captured copy's headers lacked one.
update public.email_messages c
set cc_emails = m.cc_emails
from _mirror_pairs p
join public.email_messages m on m.id = p.mirror_id
where c.id = p.kept_id and c.cc_emails is null and m.cc_emails is not null;

-- Drop the mirrors (email_message_bcc children cascade).
delete from public.email_messages m
using _mirror_pairs p
where m.id = p.mirror_id;

commit;

-- Verification (run after):
--   select count(*) from public.email_mirror_dedup_backup_20260729;   -- ≈ pairs merged
--   select count(*) from public.email_messages where message_id like 'resend:%';
--     -- remaining = mirrors with no captured twin (sole record of a send): kept.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   insert into public.email_messages
--     (id, message_id, gmail_id, thread_id, direction, from_email, from_name,
--      to_email, subject, body_text, body_html, snippet, sent_at, client_id,
--      deal_id, job_id, department, staff_user_id, captured_from_user_id,
--      created_at, cc_emails, lead_id)
--   select id, message_id, gmail_id, thread_id, direction, from_email,
--      from_name, to_email, subject, body_text, body_html, snippet, sent_at,
--      client_id, deal_id, job_id, department, staff_user_id,
--      captured_from_user_id, created_at, cc_emails, lead_id
--   from public.email_mirror_dedup_backup_20260729
--   on conflict (id) do nothing;
--   insert into public.email_message_bcc (message_pk, bcc_emails)
--   select id, mirror_bcc from public.email_mirror_dedup_backup_20260729
--   where mirror_bcc is not null
--   on conflict (message_pk) do nothing;
-- ---------------------------------------------------------------------------
