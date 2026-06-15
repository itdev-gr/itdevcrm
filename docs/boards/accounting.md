# Accounting

Accounting owns everything money: turning a won deal into an invoiced,
collected, and (when paid) **released** engagement, then tracking recurring
revenue, expenses, and the bottom line. It's the bridge between Sales and the
technical teams — **nothing reaches a tech board until accounting releases it.**

## Where it lives

| Page | Route | Who |
| --- | --- | --- |
| **Accounting Clients** | `/accounting/clients` | accounting + admin |
| **Onboarding** (board) | `/accounting/onboarding` | accounting + admin |
| **Recurring** | `/accounting/recurring` | accounting + admin |
| **Report** (P&L / MRR) | `/accounting/report` | **admin only** |
| **Expenses** | `/accounting/expenses` | **admin only** |

## The onboarding board

Cards are **won deals** moving through billing. A lead dropped on **Won** in the
sales pipeline converts to a client + deal and opens here in **New**.

| #   | Stage                  | Greek                 | What it means / what accounting does                                                                                                                                                  |
| --- | ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New**                | Νέο                   | Just won. Review the deal: services, amounts, VAT, client details.                                                                                                                    |
| 2   | **Documents Verified** | Έγγραφα Επιβεβαιωμένα | Client documents (VAT number, company data) checked and correct.                                                                                                                     |
| 3   | **Invoice Issued**     | Τιμολόγιο Εκδόθηκε     | The invoice went out. Payment rows are tracked on the deal's **Payment** tab (net / VAT / gross per service and period).                                                              |
| 4   | **Awaiting Payment**   | Αναμονή Πληρωμής       | Invoice outstanding. Reminder emails go out automatically (due soon → due today → overdue); the board hints to chase before the due date.                                            |
| 5   | **Partial Payment** ⚙️ | Μερική Πληρωμή        | First money in. **Side effect:** one job per sold service spawns on the tech boards — 🔒 _blocked_ for every service **except Web Dev**, which starts immediately (build can begin on the deposit; recurring services wait for full payment). |
| 6   | **Paid In Full** ✅    | Πλήρως Εξοφλημένο     | Terminal (outcome **paid**). Marks accounting complete on the deal and **unblocks all of the deal's jobs**. If Partial Payment was skipped, jobs spawn here directly, unblocked.       |
| 7   | **On Hold**            | Σε Αναμονή            | Billing paused (dispute, client request, missing data). Nothing spawns or unblocks from here.                                                                                         |
| 8   | **Refunded**           | Επιστροφή Χρημάτων     | Terminal (outcome cancelled). Money returned; the engagement ends.                                                                                                                    |

**Rules**

- **Partial Payment → job spawn is idempotent**: re-entering the stage never
  duplicates jobs (one job per deal + service).
- Jobs spawn into each board's **first column**, assigned to the service group's
  team lead when one is configured.
- **Web Dev is the exception** — it spawns unblocked on partial payment so build
  work can start on the deposit; every other service stays blocked until paid in
  full.

## Payments & invoicing

There's no separate "invoice" object — the invoice **is** the set of payment
rows on a deal's **Payment** tab. Each row is one service for one period:

- **Amounts**: you enter **net** and a **VAT rate** (e.g. 24% Greece, 0% for
  some other countries); **VAT** and **gross** are calculated for you. A row
  whose VAT rate doesn't match the client's country is flagged.
- **Period**: a **start** and **end** date (the service term being billed).
- **Status**: **pending → paid** (toggle marks it paid and stamps when); the
  daily job flips an unpaid row to **overdue** once its due date passes.
- **Invoice number**: an optional reference you can record per row.
- **Billing type**: one-time, recurring monthly, or recurring yearly.

A deal's payment state — shown on its onboarding card — is derived from the rows:
**pending** (nothing paid), **partial** (some paid), **paid in full** (all paid).
That's what gates the job release described above.

## Recurring billing & MRR

The **Recurring** page is the live book of subscription clients:

- **Per client**: active recurring services, **monthly** and **yearly** revenue,
  the **next due** date, and a status badge — **Active**, **Overdue** (a payment
  is due/past due), **Blocked** (the client is blocked), or **Done**.
- **Top stats**: active client count, **monthly MRR** (monthly subscriptions +
  yearly ÷ 12), overdue count, and blocked count.
- Recurring revenue comes from the client's **active recurring jobs** (created
  when the deal was paid). Recurring payment rows **auto-extend** into the next
  period as each term nears its end, so the book stays current.

## Overdue payments & reminders

- A **daily job** marks any unpaid payment row **overdue** once its due date has
  passed.
- **Automatic reminder emails** to the client step up as the date approaches:
  **due soon**, **due today**, then **overdue** (deduplicated so a client never
  gets the same reminder twice).
- Overdue clients surface on the Recurring page and feed the decision to
  **block** a client (below).

## Accounting clients

`/accounting/clients` is the **active customer book** (distinct from Sales →
Clients, which is the prospect/lead world). For each client it shows code, start
date, company + contact, email/phone (click-to-call), VAT number, **active job
count**, **monthly** and **yearly** revenue, and a status badge (**Active**,
**No Jobs**, or **Blocked**). You can search across all of those and filter to
blocked clients only.

## Blocking

Two levels of "stop work until paid":

- **Job-level block** — accounting/admin can block or unblock an individual job
  from the job page (e.g. an overdue balance mid-engagement). On the Local SEO
  board, blocked jobs gather in a dedicated **Blocked** column; on other boards
  the 🔒 badge shows in place.
- **Client-level block** — blocking a client (from the Recurring/Clients view)
  flags them everywhere and stops non-admins from moving that client's jobs or
  editing their monthly tasks. Partial-payment job blocks are cleared
  automatically when the deal reaches **Paid In Full**.

## Expenses (admin)

`/accounting/expenses` tracks money going **out**:

- Each expense has a **category** (salaries, freelancers, rent, utilities,
  software, hosting/domains, ad spend, equipment, taxes/VAT, accountant fees,
  bank fees, marketing, training, travel, other), a **vendor**, **net + VAT +
  gross**, a **date**, a **status** (pending/paid), an optional **receipt**
  upload, and a **payment method**.
- Expenses can be **one-off or recurring** (recurring ones auto-extend like
  recurring income).
- Filter by status, category, or vendor. **Creating and editing expenses is
  admin-only**; everyone in accounting can view.

## Report — P&L & MRR (admin)

`/accounting/report` is the financial summary, for any date range (this month,
last month, quarter, year, or custom), with year-to-date alongside:

- **P&L**: total **income** (paid invoices), total **expenses** (paid
  expenses), and **net profit/loss**.
- **MRR**: **contracted** (what recurring jobs should bill) vs **collected**
  (what was actually paid this period).
- **Breakdowns**: income by service type and expenses by category, drill-down.
- **Export** to CSV or PDF. Admin only.

## Who can do what

- **Accounting team**: onboarding board (view, move stages, complete accounting,
  comment, attach), payments, recurring book, and client block/unblock.
- **Admin only**: the Report and Expenses pages (and expense-category
  management).
- Accounting users never edit jobs directly — job block/unblock and the
  job-spawn on payment happen through controlled actions, so the tech boards
  always reflect the real billing state.
