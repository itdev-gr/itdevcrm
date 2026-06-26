# Ads board (`/tech/ads`)

Cards are **jobs** for paid-advertising management (Google Ads, Meta Ads).

## How cards arrive

A deal containing an Ads service reaches **Partial Payment** → the job
spawns in **Onboarding**, 🔒 blocked until **Paid In Full**. Auto-assigned
to the Ads team lead when set.

## Stages

| #   | Stage            | Greek                | Meaning                                                                                            |
| --- | ---------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Onboarding       | Ενσωμάτωση           | Entry column. Ad account access, billing setup, pixels/conversion tracking, goals and budgets.     |
| 2   | Audit & Strategy | Έλεγχος & Στρατηγική | Account/competitor audit, campaign structure, keyword & audience plan.                             |
| 3   | Renewal          | Ανανέωση             | An existing client whose subscription renewed. **Cards land here automatically every time the client pays** — review last period and restart the cycle. |
| 4   | Active           | Ενεργό               | Campaigns live: optimization, budget pacing, reporting. Monthly task checklists track each period. |
| 5   | Done             | Ολοκληρώθηκε         | **A monthly rest, not the end.** "This period's work is finished, waiting for renewal." The next payment restarts the job in **Renewal**. |
| 6   | On Hold          | Σε Αναμονή           | Campaigns paused (budget pause, seasonality, client request).                                      |
| 7   | Cancelled        | Ακυρωμένο            | Terminal (outcome cancelled). Engagement ended.                                                    |

## Automations & rules

- **Paid → Renewal:** every time the client pays, the job automatically moves to
  **Renewal** to start the new cycle — from wherever it was (Active, Done, or
  blocked).
- **Done = monthly rest:** Done is "finished for this period, waiting for
  renewal," not the end of the job.
- **On Hold = work paused for non-payment:** if the client doesn't pay by the due
  date, accounting's deal goes On Hold and this job is **blocked** (🔒). Jobs
  already in **Done** are left alone; the client's website and hosting are never
  blocked.
- **Deal Closed → Closed:** when accounting closes the deal, all its jobs move to
  the board's Closed/terminal lane — the permanent end of the work.
- Blocked jobs show the 🔒 badge in place.
- Monthly amounts feed Accounting → Recurring and MRR.
