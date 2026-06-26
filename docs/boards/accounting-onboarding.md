# Accounting onboarding (`/accounting/onboarding`)

Cards are **won deals** moving through billing. This board is the bridge
between sales and the technical teams: nothing reaches a tech board until
accounting releases it here.

## How cards arrive

A lead dropped in **Won** on the sales pipeline converts to a client + deal
and opens here in **New**.

> For the full plain-English accounting walkthrough (jobs as the billing unit,
> the deal page's Jobs & Billing panel, payments, recurring, blocking, reports),
> see **[accounting.md](accounting.md)**. This page is just the board's columns.

## Stages

Columns appear left-to-right in this order. The system uses **Awaiting Payment**
and **On Hold** automatically, which is why they sit near the front.

| #   | Stage                  | Greek                 | Meaning                                                                                                                                                                                                                                             |
| --- | ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New                    | Νέο                   | Just won. Accounting reviews the deal: services, amounts, VAT, client details. Cards start here.                                                                                                                                                    |
| 2   | Awaiting Payment       | Αναμονή Πληρωμής      | Invoice outstanding. The CRM auto-moves a deal here when its first payment row is created; the board shows a "7 days prior" hint for chasing before due dates.                                                                                       |
| 3   | On Hold                | Σε Αναμονή            | Billing paused (dispute, missing data, or overdue invoice). **Marks the client Blocked and blocks the client's open jobs** — everything **except the website (Web Dev) and hosting**, which keep running. AI SEO blocks together; jobs already in their board's Done column are left alone. Leaving On Hold (or the client paying) releases the blocks. The daily overdue job can move deals here.       |
| 4   | Documents Verified     | Έγγραφα Επιβεβαιωμένα | Client documents (VAT number, company data) checked and correct.                                                                                                                                                                                    |
| 5   | Invoice Issued         | Τιμολόγιο Εκδόθηκε    | The invoice went out. Payment rows are tracked on the deal's Payment tab (net/VAT/gross per service and period).                                                                                                                                    |
| 6   | **Partial Payment** ⚙️ | Μερική Πληρωμή        | First money in. **Side effect:** the deal's jobs are released onto the technical boards — 🔒 _blocked_ for every service except **Web Dev**, which starts immediately (build work can begin on deposit; recurring services wait for full payment).   |
| 7   | **Paid In Full** ✅    | Πλήρως Εξοφλημένο     | Marks accounting complete (✓), releases any remaining jobs, **unblocks all the deal's jobs**, and sets the client **Active**. Every renewable service (Web SEO / Local SEO / Ads / Social) also **moves to its board's Renewal column** to start the new cycle. If Partial Payment was skipped, jobs release here.       |
| 8   | **Done**               | Ολοκληρώθηκε          | Terminal. Marks the client **Done** and **archives the deal off the board** (the card leaves). Use when the engagement is finished. (This is the lane formerly labelled "Refunded".)                                                                 |
| 9   | **Closed**             | Κλειστό               | Close-out — the real end of the work. **Every one of the deal's jobs automatically moves to its board's Closed column**; the **deal stays visible** and the client status is unchanged.                                                              |

## Automations & rules

- **A payment method (Cash/Online) is required** before any stage move (except
  dropping on **Closed**, which opens the close-out dialog).
- **Partial Payment → job release** is idempotent: re-entering never duplicates
  jobs (one job per deal + service).
- Jobs land on each board's first column, assigned to the service group's team
  lead when one is configured.
- Accounting (and admins) can also **manually block/unblock** any job from the
  job page — used for overdue payments mid-engagement; on the Local SEO board
  blocked jobs collect in a dedicated Blocked column.
- Moving a deal to **On Hold** blocks the client's open jobs (everything except
  website + hosting); **Paid In Full** clears the blocks **and** moves each
  renewable service to its board's **Renewal** column for the new cycle.
- Dropping a deal on **Closed** moves **all** its jobs to their board's Closed
  column (the permanent end of the work).
- Clients are sent automatic payment-reminder emails **7 days before due, 1 day
  after, and 7 days after**; accounting can pause them per deal with the
  **"Pause payment reminders"** toggle on the deal's Payment tab.
- Recurring billing afterwards lives in Accounting → Recurring (contracted
  monthly totals, next due dates, overdue flags) and the Report (income,
  expenses, MRR).
