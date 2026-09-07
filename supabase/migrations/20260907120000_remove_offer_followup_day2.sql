-- =============================================================================
-- 2026-09-07 (owner): delete the classic offer follow-up email
-- «{{code}} - Έχετε απορίες για την προσφορά σας;» (offer_followup_day2).
--
-- Reported on lead 006341 (xigiaresidence@gmail.com), whose history shows the
-- duplication plainly:
--   29/08 09:30  offer_followup_day2    ← this one, the classic sequence
--   03/09 15:50  ud_offer_checkin       ← the UD cadence, same purpose
--   07/09 09:42  ud_offer_followup_1    ← the UD cadence again
-- The client was chased about the same offer by two independent systems. The
-- UD cadence is the one being kept (owner decision 2026-09-04), so the classic
-- step goes.
--
-- Safe to delete now: the offer_sent sequence has 0 active runs and 0 pending
-- outbox rows for this key. The 157 historical email_log rows are NOT touched —
-- email_log has no FK to email_templates, so the record of what was actually
-- sent stays intact, and src/features/activity/format.ts keeps its label so
-- those rows still render properly in the activity feed.
--
-- Order matters: email_sequence_steps.template_key has an FK to
-- email_templates.key, so the step must go first.
--
-- NOT removed, deliberately: offer_followup_day5 and offer_followup_day10 are
-- still seeded steps of the same classic sequence. The owner named only this
-- one. They are equally superseded by the UD cadence, and with position 1 gone
-- a lead landing in the classic offer_sent stage would now start at day+5 —
-- flagged to the owner rather than decided here.
-- =============================================================================

delete from public.email_sequence_steps st
 using public.email_sequences s
 where st.sequence_id = s.id
   and s.key = 'offer_sent'
   and st.template_key = 'offer_followup_day2';

delete from public.email_templates where key = 'offer_followup_day2';

-- ROLLBACK: re-seed from 20260610000006_email_automations_schema.sql:186-190
-- (template) and :287 (step: sequence 'offer_sent', position 1, day_offset 2).
