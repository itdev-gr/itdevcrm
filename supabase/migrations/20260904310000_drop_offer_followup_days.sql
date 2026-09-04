-- =============================================================================
-- 2026-09-04 (owner): retire `profiles.offer_followup_days` entirely.
--
-- The setting wrote leads.scheduled_for = now() + N days as a calendar reminder
-- for the salesperson. But scheduled_for means "appointment booked with the
-- client", and that overload emailed four clients an «Επιβεβαίωση Ραντεβού» for
-- meetings nobody had booked (fixed defensively in 20260904300000; this
-- migration removes the cause).
--
-- It is not merely a bug — it is redundant. On the Under Development board the
-- ud_offer_followup cadence already creates real follow-up TASKS for the rep at
-- T+4 / T+6 / T+8, clamped to Mon-Fri 09:00-17:30 via ud_business_due, plus the
-- ud_offer_followup_1/2 chase emails to the client (20260826150000 seeds,
-- reordered by 20260828230000). The old setting's only extra output was one
-- calendar row that CalendarPage and SalesKanbanCard both had to re-label as
-- "Follow-up" so it would not read as a meeting.
--
-- EXPLICITLY UNTOUCHED (the names are dangerously similar):
--   * ud_offer_followup cadence + its steps + ud_offer_followup_1/2 templates
--     — this is the system the owner is keeping.
--   * offer_followup_day2/5/10 — the classic board's dormant sequence.
--   * The stage move to Offer Sent on offer insert — documented, wanted
--     behaviour (docs/boards/sales.md).
--   * offers.created_by — still needed by the offer-view auto-comment.
--   * The 20260904300000 guards — kept as defence in depth for any future
--     trigger that writes scheduled_for.
--
-- Base body: LIVE md5 7c9a004750fbcb7aa040623688db754e, regenerated
-- programmatically so the stage-move logic is byte-identical.
-- All values were already zeroed before this migration, so dropping the column
-- loses nothing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.offers_after_insert_set_offer_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lead_row record;
  current_stage record;
  offer_sent record;
begin
  if new.lead_id is null then
    return new;
  end if;

  select * into lead_row from public.leads where id = new.lead_id;
  if lead_row is null then
    return new;
  end if;

  select id, code, board, position, is_terminal into current_stage
    from public.pipeline_stages
   where id = lead_row.stage_id;

  -- The lead's own board decides which Offer Sent it moves to.
  select id, position into offer_sent
    from public.pipeline_stages
   where board = coalesce(current_stage.board, 'sales')
     and code = case when current_stage.board = 'under_development'
                     then 'ud_offer_sent' else 'offer_sent' end
     and archived = false
   limit 1;

  -- Stage move only. This handler no longer writes the appointment field:
  -- putting an offer follow-up date there emailed four clients a confirmation
  -- for a meeting nobody had booked (2026-09-04). Follow-up scheduling is the
  -- ud_offer_followup cadence's job.
  update public.leads
     set stage_id = case
           when offer_sent.id is not null
                and not coalesce(current_stage.is_terminal, false)
                and (current_stage.position is null
                     or current_stage.position < offer_sent.position)
             then offer_sent.id
           else stage_id
         end
   where id = new.lead_id;

  return new;
end $function$;

alter table public.profiles drop column if exists offer_followup_days;

-- ROLLBACK:
--   alter table public.profiles
--     add column offer_followup_days int not null default 0
--     check (offer_followup_days >= 0);
--   -- then re-apply the offers_after_insert_set_offer_sent body with md5
--   -- 7c9a004750fbcb7aa040623688db754e (the 20260826230000 emission).
