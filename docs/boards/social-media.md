# Social Media board (`/tech/social-media`)

Cards are **jobs** for social-media management retainers.

## How cards arrive

A deal containing a Social Media service reaches **Partial Payment** → the
job spawns in **Onboarding**, 🔒 blocked until **Paid In Full**.
Auto-assigned to the Social Media team lead when set.

## Stages

| #   | Stage        | Greek              | Meaning                                                                                                       |
| --- | ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | Onboarding   | Ενσωμάτωση         | Entry column. Account access, brand assets, tone-of-voice, goals.                                             |
| 2   | Content Plan | Πλάνο Περιεχομένου | Build the content calendar (formats, frequency, campaigns) and get client sign-off.                           |
| 3   | Renewal      | Ανανέωση           | An existing client whose retainer renewed. **Cards land here automatically every time the client pays** — review last period and restart the cycle. |
| 4   | Active       | Ενεργό             | Ongoing publishing and community management per the approved plan; monthly task checklists track each period. |
| 5   | Done         | Ολοκληρώθηκε       | **A monthly rest, not the end.** "This period's work is finished, waiting for renewal." The next payment restarts the job in **Renewal**. |
| 6   | On Hold      | Σε Αναμονή         | Paused (seasonal stop, client request).                                                                       |
| 7   | Cancelled    | Ακυρωμένο          | Terminal (outcome cancelled). Retainer ended.                                                                 |

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
