# Sales pipeline (`/sales/under-development`)

The sales team's lead board. Every lead lives here from the moment it enters
the CRM until it is Won (converted to client + deal) or closed as lost. Since
**2026-09-08 this is the one and only sales pipeline** — the old
`/sales/kanban` board was retired (its address now redirects here).

Cards are **leads**. Unlike the old board, this one is **task-driven**: each
stage runs an automation chain (cadence) that opens call tasks for the
salesperson and sends the follow-up emails on schedule, exactly per the
owner's ΡΟΗ_ΝΕΟΥ_LEAD flow document.

## Stages

| #   | Stage              | Greek              | What it means / what happens automatically |
| --- | ------------------ | ------------------ | ------------------------------------------ |
| 1   | **Parking**        | Parking            | Shelved leads — no automation runs here, no tasks open. Park a lead to silence its chain without losing it; moving it out starts the destination stage's chain. |
| 2   | **New Lead**       | Νέος Πελάτης       | Entry column — every new lead lands here. The **welcome email** goes out immediately, then a **«1η Κλήση» task** opens for the salesperson. «Δεν απάντησε» → «2η Κλήση» task +4 hours. When the calls are exhausted, the CRM suggests **No Answer**. |
| 3   | **No Answer**      | Δεν Απαντά         | The no-answer chase: email → callback task (T+2) → second email → callback (T+4) → «Τελευταία Προσπάθεια» email → last callback (T+7). Exhausted → suggests **Not Found**. |
| 4   | **Offer Sent**     | Προσφορά Στάλθηκε  | Leads move here **automatically when an offer is created**. Chain: check-in email (T+3) → follow-up call task (T+4) → follow-up email → tasks at T+6/T+8 → «Τελευταία επικοινωνία» email. Exhausted → suggests **Not Interested**. |
| 5   | **Scheduled**      | Προγραμματισμένο   | A meeting is booked — moving here requires a date & time. The client gets a confirmation email, a reminder the day before, and the owner is notified the morning after a possible no-show («Δεν απάντησε» button sends the no-show email). |
| 6   | **Won**            | Κερδισμένο         | **Terminal.** Dropping a lead here opens the conversion dialog: client + deal are created (with services & amounts) and the deal locks for accounting. |
| 7   | **Not Interested** | Μη Ενδιαφέρον      | **Terminal (lost).** The client said no. The 90-day re-engagement is handled by lead intake recycling, not by emails from this board. |
| 8   | **Not Found**      | Δεν Βρέθηκε        | **Terminal (lost).** Never managed to reach them (the No Answer chain ran dry). |
| 9   | **Dead End**       | Αδιέξοδο           | **Terminal (lost).** Wrong number, out of business, no fit — a lead with nowhere to go. |

## Rules worth knowing

- **Reply pauses the chain.** An inbound email or call from the lead
  auto-pauses the automation — nothing embarrassing goes out after the client
  has already answered.
- **Nothing survives a stage move.** Moving a card stops the old stage's run
  and closes its open task; the new stage starts its own chain. Terminal
  stages start nothing.
- **Company schedule.** Call tasks only open Mon–Fri 09:00–17:30
  (Europe/Athens); a step landing outside that window opens the next business
  day at 09:00. Emails fire on their exact delays.
- **Archive stops everything**; unarchiving does NOT restart a chain — the
  salesperson decides by moving the stage.
- **Non-admins see their own leads** (also enforced server-side); admins see
  the whole board and can filter by owner.
- Sorting, search and saved filters live in the toolbar; the chosen sort also
  drives «Next in stage» on the lead page.

## Where to configure it

- **Timing & steps** (delays per step, enable/disable, thresholds):
  `/sales-automations` (admin).
- **Email texts**: `/admin/email-automations` — the database rows are
  authoritative.

## The retired classic board

The old sales kanban (`board='sales'`: New Lead → … → Won/Not Interested/Dead
End) was decommissioned on 2026-09-08: its stages are archived, its email
sequences (no-answer chase, 90-day re-engage, offer follow-ups) were deleted,
and its leads had already been migrated here on 2026-08-31. One invisible
remnant stays by design: every **deal** carries the old board's `won` stage
internally — reports join on it. See `docs/tech/sales/kanban.md` for the
technical history.
