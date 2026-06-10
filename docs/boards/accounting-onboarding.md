# Accounting onboarding (`/accounting/onboarding`)

Cards are **won deals** moving through billing. This board is the bridge
between sales and the technical teams: nothing reaches a tech board until
accounting releases it here.

## How cards arrive

A lead dropped in **Won** on the sales pipeline converts to a client + deal
and opens here in **New**.

## Stages

| #   | Stage                  | Greek                 | Meaning                                                                                                                                                                                                                                             |
| --- | ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New                    | Νέο                   | Just won. Accounting reviews the deal: services, amounts, VAT, client details.                                                                                                                                                                      |
| 2   | Documents Verified     | Έγγραφα Επιβεβαιωμένα | Client documents (VAT number, company data) checked and correct.                                                                                                                                                                                    |
| 3   | Invoice Issued         | Τιμολόγιο Εκδόθηκε    | The invoice went out. Payment rows are tracked on the deal's Payment tab (net/VAT/gross per service and period).                                                                                                                                    |
| 4   | Awaiting Payment       | Αναμονή Πληρωμής      | Invoice outstanding. The board shows a "7 days prior" hint for chasing before due dates; overdue invoices are flagged by a daily job.                                                                                                               |
| 5   | **Partial Payment** ⚙️ | Μερική Πληρωμή        | First money in. **Side effect:** one job per sold service spawns on the technical boards — 🔒 _blocked_ for every service except **Web Dev**, which starts immediately (build work can begin on deposit; recurring services wait for full payment). |
| 6   | **Paid In Full** ✅    | Πλήρως Εξοφλημένο     | Terminal (outcome **paid**, triggers **complete_accounting**): marks accounting complete on the deal (✓ Complete accounting) and **unblocks all the deal's jobs**. If Partial Payment was skipped, jobs spawn here directly, unblocked.             |
| 7   | On Hold                | Σε Αναμονή            | Billing paused (dispute, client request, missing data). Nothing spawns or unblocks from here.                                                                                                                                                       |
| 8   | Refunded               | Επιστροφή Χρημάτων    | Terminal (outcome cancelled). Money returned; the engagement ends.                                                                                                                                                                                  |

## Automations & rules

- **Partial Payment → job spawn** is idempotent: re-entering the stage never
  duplicates jobs (one job per deal + service).
- Jobs spawn into each board's first column, assigned to the service group's
  team lead when configured.
- Accounting (and admins) can also **manually block/unblock** any job from
  the job page — used for overdue payments mid-engagement; on the Local SEO
  board blocked jobs collect in a dedicated Blocked column.
- Recurring billing afterwards lives in Accounting → Recurring (contracted
  monthly totals, next due dates, overdue flags) and the Report (income,
  expenses, MRR).
