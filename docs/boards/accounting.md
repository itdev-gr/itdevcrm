# Accounting

> **Who this is for.** The accounting team (and admins). It explains, in plain
> English, everything accounting can see and do in the CRM today: turning a won
> deal into invoiced, collected work; managing the price and billing of each
> job; tracking recurring revenue; blocking work that isn't paid; and reading
> the books.
>
> **Reflects the system as of 2026-06-19.** Where this guide and the screen
> disagree, trust the screen and tell us so we can fix the guide. A deeper,
> developer-level reference lives in
> [`docs/system-analysis/`](../system-analysis/2026-06-17-accounting-and-technical-walkthrough.md)
> (note: that one predates the "jobs are the billing unit" change described below).

---

## 1. The big picture

Accounting sits between **Sales** and the **technical teams**. Nothing reaches a
technical board (Web SEO, Local SEO, Web Dev, Social Media, Hosting, Ads) until
accounting releases it. The flow, end to end:

1. **Sales wins a lead.** A salesperson drags a lead into the **Won** column of
   the sales pipeline. The CRM automatically creates a **client** and a **deal**,
   and the deal opens a card on your **Accounting Onboarding** board in the
   **New** column.
2. **The system sets up the billing.** The moment the deal is created, the CRM
   builds the **jobs** (one per sold service) and the **payment schedule** (the
   rows you'll invoice and collect). At this point the jobs exist for billing but
   are **not yet on the technical teams' boards**.
3. **Accounting verifies and invoices.** You check the client's documents, issue
   the invoice, and track the payments on the deal's **Payment** tab.
4. **Money comes in → work is released.** When you mark the deal **Partial
   Payment**, the jobs appear on the technical boards (locked for everything
   except Web Dev). When you mark it **Paid In Full**, accounting is completed
   and **every job is unlocked** and visible to the teams.
5. **Ongoing.** Recurring subscriptions renew their payment rows automatically.
   Overdue invoices are flagged daily and can push a deal **On Hold**, which
   blocks the client's open work (everything except their website and hosting)
   until they pay. Each time the client pays, their renewable services (Web SEO,
   Local SEO, Ads, Social) automatically restart in their board's **Renewal**
   column.

### The lifecycle at a glance (lead won → first recurring payment)

```text
  Sales drags lead to WON
            │
            ▼
  Client + Deal created and LOCKED  ──►  opens on Accounting board: NEW
            │
            │   (automatic on creation)
            ├──►  JOBS created — one per service
            │       • off-board: not on a tech board yet
            │       • each carries title, price, VAT, cadence
            │
            └──►  PAYMENT rows seeded — first period
                    • net + VAT  (Greece 24% / Cyprus 0%)
                    • each linked to its job
            │
            ▼
  Accounting works the card:
     NEW  ►  Documents Verified  ►  Invoice Issued  ►  Awaiting Payment
     (a payment method must be set before any move)
            │
            ▼
  PARTIAL PAYMENT  ──►  jobs go onto the tech boards
                          (locked except Web Dev)
            │
            ▼   (you can skip Partial and come straight here)
  PAID IN FULL  ──►  accounting complete
                       • all jobs unlocked
                       • client becomes ACTIVE
                       • first payment marked Paid
            │
            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Nightly job (~05:00 Athens):                             │
  │  when month 1 nears its end, the next month's payment is  │
  │  created automatically (amount copied forward, +1 month)  │
  │     =  FIRST RECURRING PAYMENT                            │
  └──────────────────────────────────────────────────────────┘
```

- **Off-board jobs:** every sold service becomes a job the instant the deal is
  won, but it stays off the technical boards until money arrives — so work can't
  start before payment.
- **Partial Payment is optional:** accounting can go straight to Paid In Full (the
  dashed path); Web Dev is the only service that starts on a deposit.
- **Recurring renews itself:** the first month's row is seeded at creation, then
  the nightly job rolls it forward each period (today it copies the same amount
  forward). Clients also get automatic payment-reminder emails (−7d / +1d / +7d),
  which accounting can pause per deal — see §9.

### Where everything lives

| Page | Route | Who can open it |
| --- | --- | --- |
| **Accounting Clients** (customer book) | `/accounting/clients` | accounting + admin |
| **Onboarding** (the billing board) | `/accounting/onboarding` | accounting + admin |
| **Recurring** (subscriptions book) | `/accounting/recurring` | accounting + admin |
| **Report** (P&L / MRR) | `/accounting/report` | **admin only** |
| **Expenses** | `/accounting/expenses` | **admin only** |

### Who can do what (quick version)

- **Accounting team:** the Onboarding board (move stages, complete accounting,
  close deals), the deal's Jobs & Billing and Payment tabs, the Recurring and
  Clients books, and blocking/unblocking clients and jobs. Accounting can also
  edit client details (company name, VAT, etc.).
- **Admin only:** the **Report** and **Expenses** pages.
- Accounting never edits a job's *work* directly on a tech board — but accounting
  **does own each job's billing** (price, VAT, cadence) from the deal page, and
  can block/unblock jobs.
- **Deleting a job (mistake fixing):** accounting can permanently delete a job
  from the job page, but only while its deal has **never once** been Paid In
  Full (`deals.first_paid_in_full_at` is empty — stamped automatically the
  first time the deal ever enters Paid In Full and never cleared). After a
  deal has been paid even once, job deletion is admin-only again.

---

## 2. Jobs are the billing unit (read this first)

The most important idea in the current system: **a "job" is one self-contained
unit of both work and money.** Every job carries:

- a **title** (e.g. "Web SEO" or a custom name you type),
- a **department / service** (web_seo, local_seo, web_dev, social_media, ai_seo,
  hosting, ads — or **Billing-only**, see below),
- a **price** (the **net** amount, before VAT),
- a **VAT rate** (24% for Greece, 0% for Cyprus, 24% as the default otherwise),
- a **cadence**: **one-time**, **monthly**, or **yearly**,
- an **active / ended** flag.

Because billing lives on the job, you no longer hand-build invoices from a list
of services — the CRM **generates the payment schedule from the jobs**. Change a
job's price and future invoices follow. Add a custom job and its payments are
created for you. End a job and it stops renewing. Each job also has a unique
**code** like `000013-WEBSEO` (the deal code + service) that you can copy and
search.

You manage all of this from the **deal page → "Jobs & Billing"** (see §5).

---

## 3. The Onboarding board

Open it at **Accounting → Onboarding**. Each **card is a won deal** moving
through billing. You work the board by **dragging a card from one column to the
next** as the real-world situation changes.

### The columns (left to right, as they appear)

| Stage | Greek | What it means / what you do |
| --- | --- | --- |
| **New** | Νέο | Just won. Review the deal — services, amounts, VAT, client details. Cards start here and stay until you move them. |
| **Awaiting Payment** | Αναμονή Πληρωμής | Invoice is out and outstanding. The CRM auto-moves a deal here when its first payment row is created. Chase the client before the due date. |
| **On Hold** | Σε Αναμονή | Billing paused (dispute, missing data, or an overdue invoice). Moving here **blocks the client's open jobs** — everything **except their website (Web Dev) and hosting**, which keep running — and marks the client **Blocked**. (See §7.) |
| **Documents Verified** | Έγγραφα Επιβεβαιωμένα | Client documents (VAT number, company data) checked and correct. |
| **Invoice Issued** | Τιμολόγιο Εκδόθηκε | The invoice has gone out. |
| **Partial Payment** | Μερική Πληρωμή | First money in. **The jobs now appear on the technical boards** — 🔒 locked for every service **except Web Dev**, which can start on the deposit. |
| **Paid In Full** ✅ | Πλήρως Εξοφλημένο | The finish line for billing. Marks accounting **complete**, releases any jobs that hadn't spawned yet, and **unlocks all of the deal's jobs**. The client becomes **Active**. |
| **Done** | Ολοκληρώθηκε | Ends the relationship: the deal is **archived off the board** and the client is marked **Done**. Use this when the engagement is finished and you want the card gone. |
| **Closed** | Κλειστό | Wrap-up / close-out. Opens a dialog to mark each job finished and send it to its board's "finished" lane, while the **deal stays visible** and the client status is unchanged. (See §3.4.) |

> The columns are shown in a fixed order, but you don't have to move strictly
> left-to-right. **Awaiting Payment** and **On Hold** sit near the front because
> the system uses them automatically (a new invoice → Awaiting Payment; an
> overdue invoice → On Hold). Your normal manual path is roughly:
> New → Documents Verified → Invoice Issued → Awaiting Payment → Partial Payment
> → Paid In Full.

### 3.1 The one hard rule: set a payment method first

**You cannot move a card to any stage until the deal has a payment method**
(Cash or Online), set on the deal page. If it's missing, the move is refused
with a reminder. (The one exception is dropping a card on **Closed**, which opens
the close-out dialog instead of a plain move.)

### 3.2 What happens automatically when you move a card

| Move to… | What the system does |
| --- | --- |
| **Partial Payment** | Releases the deal's jobs onto the tech boards. Everything **except Web Dev** is **locked** (🔒) until paid in full; Web Dev starts right away. Re-entering the stage never duplicates jobs. |
| **Paid In Full** | Runs "complete accounting": releases any jobs not yet spawned (unlocked), clears the partial-payment locks, stamps the deal **✓ Complete**, sets the client **Active**, and notifies the deal owner. **Every renewable job (Web SEO, Local SEO, Ads, Social) also moves to its board's Renewal column** to start the new cycle — see §3.5. |
| **On Hold** | Marks the client **Blocked** and **blocks the client's open jobs** — everything **except the website (Web Dev) and hosting**, which keep running. AI SEO blocks together (the Web SEO + Local SEO parts pause as one). Jobs already in their board's **Done** column (finished for the month) are left alone. Leaving On Hold, or the client paying, releases the blocks. |
| **Done** | Marks the client **Done** and **archives the deal** (the card leaves the board). |
| **Closed** | Opens the close-out dialog (see §3.4); does **not** change the client status; the card stays on the board in the Closed column. |
| New, Documents Verified, Invoice Issued, Awaiting Payment | No side effects — just records where the deal is. |

### 3.3 What each card shows

- The **deal code** (e.g. `000013`) — click the badge to copy it.
- The client/contact name (click to open the deal), with a green **✓** if
  accounting is already complete.
- Company + industry.
- The **one-time** and **monthly** value of the deal.
- The **owner** (👤).
- The list of **services**.
- A **payment badge**: **Paid** (all rows paid), **Partial** (some paid), or
  **Pending** (nothing paid yet).
- A **📄 Invoiced** mark if every payment row has an invoice number.
- A **⏳ Next due** date when something is still owed.
- The lock/close date.

### 3.4 Closing out a deal (the "Closed" dialog)

When you drag a card onto **Closed**, a dialog lists every active job on the
deal. For each job you can:

- **tick or untick** whether to close it (all ticked by default), and
- for **Web Dev** jobs, choose whether the website goes to **Closed** or **Live**.

Confirm, and the CRM marks the ticked jobs **completed**, moves each to its
board's finished lane (Web SEO / Local SEO → **Done**; Web Dev → **Closed** or
**Live**; Social / Ads / Hosting → **Closed**), clears any locks, and parks the
deal in the **Closed** column (still visible, client status unchanged).

> **Done vs Closed in one line:** **Closed** = "finish the work and tidy the
> boards, keep the record." **Done** = "this client is finished — take the deal
> off my board."

### 3.5 What payment, On Hold and closing do to the work boards

You don't move jobs around the technical boards yourself — paying, holding and
closing the deal does it automatically. Three things worth knowing:

- **Every time the client pays, their work restarts in Renewal.** When a deal is
  marked **Paid In Full**, all of the client's renewable services — **Web SEO,
  Local SEO, Ads, Social** — automatically move to their board's **Renewal**
  column to begin the new cycle (wherever they were before). The website and
  hosting aren't affected. So "client paid" always means "the teams see the work
  back in Renewal, ready to go again."
- **"Done" on a tech board is not the end — it's a monthly rest.** For the
  recurring services (Web SEO, Local SEO, Ads, Social), a team dropping a job in
  **Done** means *"this month's work is finished, waiting for the next renewal."*
  It is **not** finished forever — the next payment restarts it in Renewal (see
  above). Jobs sitting in Done are also left alone when the deal goes On Hold
  (there's nothing to pause).
- **Closing the deal closes all its work.** When you drag a deal to **Closed**
  (or use the close-out dialog), **every one of its jobs automatically moves to
  its board's "Closed" column** — this is the real, permanent end of the work.

---

## 4. The deal page (where accounting works on a deal)

Click any card to open the deal. The tabs you'll use most:

- **Overview** — client and contact details (editable: name, email, phone,
  company, VAT, website, industry, country, address), the sales note, and a
  **read-only summary** of the deal's Jobs & Billing.
- **Payment** — the full **Jobs & Billing panel** (editable for accounting/admin)
  plus the **Payments** table. This is your main workspace.
- **Jobs**, **Tasks**, **Attachments**, **Activity**, **Offers**, **Contracts** —
  supporting tabs.

The deal header also has a **"Move to"** dropdown that moves the deal between
accounting stages (same effect as dragging the card on the board), a **Send
welcome email** button, and the deal/lock status.

---

## 5. Jobs & Billing panel (price, cadence, custom jobs)

On the deal's **Payment** tab, the **Jobs & Billing** panel lists every job on
the deal. Each row shows the **title**, **department**, **price + cadence**
(e.g. "€500 / Monthly"), **status** (Active / Ended), and its **billing group**.

### What you can do per job

- **Change the price.** Click the price, type the new **net** amount, click away
  to save. *This affects future invoices only* — invoices already issued or paid
  are untouched.
- **Change the cadence.** Switch between **One-time**, **Monthly**, and
  **Yearly**. (Switching a job to one-time removes it from any billing group.)
- **Bill together or separately** (the **Group** control):
  - **Separate** — the job is invoiced on its own.
  - **Group / Pair with…** — combine jobs that share the same cadence into **one
    invoice** (one payment with a line per job). Only jobs with the *same*
    cadence (all monthly, or all yearly) can be grouped; one-time jobs can't be
    grouped. Grouping applies to **future** payments only.
- **End the job.** The **End** button stops the job from billing: it won't
  generate any more recurring periods and its billing fields lock. Use this when
  a single service in a multi-service deal is cancelled but the rest continues.

### Adding a custom job (+ Add job)

Click **+ Add job** to bill anything that wasn't part of the original sale. Fill
in:

- **Title** (required),
- **Department** — a real service board, **or "Billing-only"**,
- **Price (net)** (required),
- **VAT rate** (defaults to the client's country rate),
- **Cadence** (one-time / monthly / yearly),
- optional **setup fee** and **description**.

When you save, the CRM **creates the job and generates its payment schedule
automatically**.

> **Billing-only job:** a charge that appears on the invoice and in the books but
> **does not show up on any technical team's board** — perfect for one-off fees,
> adjustments, or add-ons that don't need production work.

### The pricing summary

Below the job list, a read-only summary totals the deal's **one-time**,
**monthly**, and **yearly** charges, each with **net + VAT + total**, counting
only active billing jobs.

---

## 6. Payments & invoicing

There is **no separate "invoice" object** — the invoice **is** the set of
**payment rows** on the deal's **Payment** tab. The CRM generates these rows from
the jobs; you can also add, edit, and delete rows by hand.

Each payment row holds:

- **Service / billing type** — which service and whether it's one-time, monthly,
  or yearly.
- **Label** — free text (e.g. "Installment 1/2", "Setup fee").
- **Start** and **End** dates — the period being billed. *Start* is treated as
  the **due date** for the invoice; *End* drives renewal and "overdue".
- **Net (€)** — you enter this. **VAT** and **Gross** are calculated for you.
- **VAT %** — defaults to the client's country rate; the field turns **amber** if
  it doesn't match (e.g. 0% on a Greek client) so you can catch mistakes.
- **Gross (€)** — net + VAT, shown automatically. **This is the amount the client
  pays / is invoiced.**
- **Status** — click to toggle **Pending ↔ Paid**; marking paid stamps the
  date/time. The daily job flips an unpaid row to **Overdue** once its end date
  passes.
- **Invoice #** — an optional reference you record per row.
- **Delete** (×, with confirmation).

> **VAT is net-based.** You always enter the **net** figure and the CRM adds VAT
> on top. Example: a €500/month Greek service is billed at **€620 gross**
> (€500 + 24%). A Cyprus client at 0% is billed €500.

The deal's **payment badge** (Pending / Partial / Paid) and the board card's
status are derived from these rows — which is exactly what gates the job release
in §3.

### Billing two jobs on one invoice

When jobs share a billing group (§5), they appear as **one payment** with
**several lines** — one line per job, each with its own net/VAT — and a combined
total. Ungrouped jobs each get their own payment.

---

## 7. Blocking work until it's paid

There are two independent ways to stop work:

### Job-level block

Accounting or an admin can block/unblock **a single job** from the **job page**
(the **Block / Unblock** button). A blocked job shows a 🔒 badge; on the **Local
SEO** board, blocked jobs gather in a dedicated **Blocked** column and return to
their previous column when unblocked.

Some blocks happen automatically:

- At **Partial Payment**, every non-Web-Dev job is blocked until **Paid In Full**.
- At **Paid In Full**, those blocks are cleared.
- Moving a deal **On Hold** blocks the client's **open jobs** — everything
  **except their website (Web Dev) and hosting**, which keep running. AI SEO
  blocks together (its Web SEO + Local SEO parts pause as one). Jobs already in
  their board's **Done** column are left alone. Leaving On Hold, or the client
  paying, releases the blocks.

### Client-level block

Blocking a **whole client** (a reason is required) flags them everywhere and
**stops non-admins from moving any of that client's jobs** across stages until
you unblock. Use it when a client's account — not just one job — should freeze.

---

## 8. Recurring billing & MRR

**Accounting → Recurring** is the live book of **subscription clients**
(read-only — no edit buttons here).

- **Top stats:** number of active clients, **Monthly recurring revenue**
  (monthly subscriptions + yearly ÷ 12), overdue count, and blocked count.
- **Per client:** the active recurring services, the **monthly** (and **yearly**)
  amount, the **next due** date, and a **status badge** — **Blocked**,
  **Overdue**, **Done**, or **Active**.
- **Search** by name, email, or industry.

**How renewals stay current:** every night the CRM looks at recurring payment
rows whose period is ending within 7 days and, if no next period exists yet,
**creates the next one automatically** (copying the amount forward and advancing
the date by one month or one year). You don't have to recreate subscription
invoices by hand.

---

## 9. What the CRM does automatically every day

These run on a schedule (times shown in **Athens time**, summer):

| ~Time (Athens) | What it does |
| --- | --- |
| **05:00** | **Renew recurring invoices** — create the next period for subscriptions ending within 7 days. |
| **05:05** | **Renew recurring expenses** (same idea, for costs). |
| **05:05** | **Move overdue deals On Hold** — any deal with a payment whose due date has passed is pushed to **On Hold** (which blocks the client's open work, except website + hosting, and marks the client Blocked). |
| **05:15** | **Mark overdue payments** — flip unpaid rows past their end date to **Overdue**, and send an in-app notification to accounting + admins. |

> **Clients are reminded by email automatically.** The CRM emails the client a
> payment reminder **7 days before the due date**, **1 day after**, and **7 days
> after** (a final notice) — so unpaid invoices are chased without you doing
> anything. If you don't want a particular client chased (e.g. a known-late
> account you're handling personally), open the deal's **Payment** tab and switch
> on **"Pause payment reminders"** — that deal stops getting the automatic
> emails until you turn it back off.

---

## 10. Accounting Clients (the customer book)

**Accounting → Clients** is your **active customer roster** (separate from Sales,
which handles prospects). Read-only. For each client it shows: **code**, **start
date**, **company** (click to open), **contact**, **email**, **phone**
(click-to-call), **VAT number**, **active job count**, **monthly** and **yearly**
revenue, **industry**, and a **status badge** (**Active**, **No Jobs**, or
**Blocked**). You can **search** across all those fields and tick **"blocked
only"** to see just the frozen accounts.

---

## 11. Expenses (admin only)

**Accounting → Expenses** tracks money going **out**.

- Each expense has a **category** (salaries, freelancers, rent, utilities,
  software, hosting/domains, ad spend, equipment, taxes/VAT, accountant fees,
  bank fees, marketing, training, travel, other), a **vendor**, **net + VAT +
  gross** (gross is calculated), a **date**, a **status** (pending/paid), a
  **payment method**, optional **notes**, and an optional **receipt** upload
  (PDF/PNG/JPEG/WebP).
- **+ New expense** lets you **Save** (as pending) or **Save & mark paid**.
- Open an expense to **upload a receipt**, **mark it paid**, or **delete** it.
- Expenses can be **one-off or recurring**; recurring ones auto-extend nightly,
  just like recurring income.
- **Filter** by status, category, or vendor.
- **Creating/editing expenses is admin-only**; everyone in accounting can view
  expense figures inside the Report.

---

## 12. Report — P&L & MRR (admin only)

**Accounting → Report** is the financial summary for any date range — **this
month, last month, this year, last year, or custom** — with year-to-date shown
alongside.

- **Four headline tiles** (each shows gross with a net figure underneath):
  **Income** (paid invoices), **Expenses** (paid expenses), **Net profit**, and
  **MRR**.
- **MRR has two meanings:**
  - **Contracted MRR** — what your active recurring jobs *should* bill each month
    (monthly jobs at face value + yearly jobs ÷ 12). This is the same number the
    Recurring page shows.
  - **Collected MRR** — what was *actually paid* on monthly subscriptions during
    the selected range.
- **Breakdowns:** income by **service type** and expenses by **category**, each
  with count, net, VAT, gross, and share %. Click any row to **drill down** into
  the individual transactions.
- **Export** the whole range to **CSV** or **PDF**.

---

## 13. How-to: every accounting action

A task-by-task cookbook. Find what you want to do, follow the steps. Sections 2–12
above explain *how things work*; this section is *how you do them*. Button names
are written exactly as they appear on screen, in **"quotes"**.

### A. Working a deal on the Onboarding board

**Move a deal to the next stage**
1. Open **Accounting → Onboarding**.
2. **Drag the card** into the target column — or open the deal and use the header
   **"Move to"** dropdown.
3. The card stays in its new column.

> **You must set a payment method first.** If the deal has no payment method
> (Cash/Online), the move is refused with a reminder. Set it on the deal's
> Overview tab (see F). The only move that skips this check is dropping a card on
> **Closed** (that opens a dialog instead — see B).

**Mark a deal Paid In Full (this completes accounting)**
1. Drag the card to **Paid In Full** (or pick it in **"Move to"**).
2. The system automatically: releases any jobs not yet on the boards, **unlocks
   all of the deal's jobs**, stamps the deal **✓ Complete**, sets the client
   **Active**, and notifies the deal's owner.
3. Mark the collected payment rows **Paid** (see D) if you haven't already.

**Put a deal On Hold**
1. Drag the card to **On Hold**.
2. The client is marked **Blocked** and their **open jobs are blocked** —
   everything **except the website (Web Dev) and hosting**, which keep running.
   AI SEO blocks together; jobs already in their board's **Done** column are left
   alone.
3. To release: drag the card out of **On Hold** (or mark the deal Paid In Full) —
   the blocked jobs unlock again.

**Mark a deal Done (take it off the board)**
1. Drag the card to **Done**.
2. The client is marked **Done** and the deal is **archived** — the card leaves
   the board. Use this when the relationship is finished.

### B. Closing out work — three different "stops"

There are three ways to stop a job, and they mean different things:

| Action | What it does | When to use |
| --- | --- | --- |
| **Close** (deal → Closed) | Marks jobs **finished** and moves them to each board's done lane | The work is delivered/over |
| **End** (a job's "End" button) | **Stops billing** on one job; no more renewals | A subscription/service is cancelled |
| **Block** (job or client) | **Temporary pause** of work; reversible | Unpaid balance, dispute |

**Close out a whole deal's jobs**
1. On the Onboarding board, **drag the card to "Closed"** — a dialog opens.
2. In the **Close deal** dialog, every active job is listed with a checkbox,
   **ticked by default**. Untick any job you *don't* want to close.
3. For **Web Dev** jobs, choose **"Closed"** or **"Live"** (where the website
   ends up on its board).
4. Click **"Close deal"**.
5. The ticked jobs are marked completed and moved to their board's finished lane
   (Web SEO / Local SEO → **Done**; Web Dev → **Closed**/**Live**; Social, Ads,
   Hosting → **Closed**). The deal **stays visible** on the board and the client
   status is unchanged.

**End the billing on a single job**
1. Open the deal → **Payment** tab → the **Jobs & Billing** panel.
2. On the job's row, click **"End"**.
3. Confirm in the **"End this job?"** dialog.
4. Billing stops immediately and the job won't generate any more recurring
   periods. (This can't be undone from here.)

**Pause a job without ending it** → see E (Block / unblock one job).

### C. Adding & editing services (jobs)

**Add a service / extra charge to a deal**
1. Open the deal → **Payment** tab → **Jobs & Billing** panel.
2. Click **"+ Add job"**.
3. Fill in:
   - **Title** (e.g. "Extra landing page")
   - **Department** — pick a service board, or **"Billing-only (no board)"**
   - **Cadence** — **One-time**, **Monthly**, or **Yearly**
   - **Price (net €)** — the amount before VAT
   - **VAT %** — defaults to the client's country rate
   - **Setup fee (€)** and **Description** — optional
4. Click **"Add job"**.
5. The job is created **and its payment schedule is generated automatically**.

> **"Billing-only (no board)"** jobs are invoiced and appear in the books, but
> never show up on any technical team's board — use them for one-off fees or
> add-ons that need no production work.

**Change a job's price**
1. Payment tab → Jobs & Billing → click the **price** field on the job's row.
2. Type the new **net** amount and click away (it saves on blur).

> Price changes apply to **future** invoices only — anything already issued or
> paid is untouched. Ended jobs can't be edited.

**Change a job's cadence (one-time / monthly / yearly)**
1. On the job's row, use the **cadence** dropdown.
2. Pick **One-time**, **Monthly**, or **Yearly**.

> Switching a job to **One-time** removes it from any billing group.

**Bill two services together (one invoice) — or split them apart**
1. On the job's row, use the **"Billing"** (group) dropdown.
2. Choose:
   - **"Bill separately"** — invoice this job on its own.
   - **"Group N"** — join an existing group.
   - **"Group with: <job title>"** — pair this job with another to make a new group.
3. Jobs in the same group share **one** invoice (one payment with a line each).

> Only jobs with the **same cadence** can be grouped (all monthly, or all yearly).
> Grouping applies to **future** payments only.

### D. Managing payments (the invoice)

The deal's **Payment** tab holds the payment rows — there's no separate invoice
object. Rows are generated from the jobs; you can also add and edit them by hand.

**Add a payment row manually**
1. Payment tab → click **"+ Add payment"**.
2. Fill in **Service**, **Billing** type, **Label**, **Start**, **End**,
   **Net (€)**, and **VAT %** (the **Gross** is calculated for you).
3. Click **"Add"**.

**Edit a payment row** (all changes save when you click away / pick a date)
- **Label**, **Start**, **End**, **Net (€)**, **VAT %**, **Invoice #** are all
  editable inline on the row.
- If **VAT %** doesn't match the client's country rate, the field turns **amber**
  as a warning.

**Mark a payment Paid (or back to Pending)**
1. Click the **status** chip on the row.
2. It toggles **Paid ↔ Pending**; marking Paid stamps the date/time.

**Record an invoice number** — type it into the row's **Invoice #** field.

**Delete a payment row** — click the row's **×**, then confirm.

**Pause the automatic reminder emails for this deal**
1. Open the deal → **Payment** tab.
2. Switch on **"Pause payment reminders"**.
3. That deal stops receiving the automatic −7d / +1d / +7d reminder emails until
   you turn the toggle back off. (Use it for accounts you're chasing personally.)

> A daily job automatically flips an unpaid row to **Overdue** once its end date
> passes. When jobs are grouped (see C), they appear as **one** payment row with
> several lines underneath. Clients are reminded by email **7 days before due,
> 1 day after, and 7 days after** unless you've paused reminders for the deal.

### E. Blocking work until it's paid

**Block / unblock one job**
1. Open the job (from its board, or via its code/search).
2. Click **"Block"** (or **"Unblock"** if it's already blocked).
3. Blocked jobs show a 🔒 badge; on the Local SEO board they move to a **Blocked**
   column and return on unblock.

> The **"Block"/"Unblock"** button is visible to accounting and admins.

**Block / unblock a whole client**
1. Open the client's page.
2. Click **"Block client"**, type a **reason** (required), and confirm.
3. To release, click **"Unblock client"**.

> Blocking a client stops non-admins from moving any of that client's jobs.
> Note: the client page is reachable when the client has no open deal that
> redirects you to the deal view.

### F. Deal & client housekeeping

- **Edit client / contact details** — deal → **Overview** tab → edit any field
  (company, VAT, email, phone, address, etc.). Changes autosave.
- **Set the payment method** — deal → **Overview** → **Payment method** (Cash or
  Online). Required before you can move the deal between stages.
- **Send the welcome email** — deal header → **"Send welcome email"** (appears
  once a deal has a sales owner).
- **Reassign the deal's owner** — deal header → **Owner** dropdown. (Locked once
  accounting is complete.)

### G. Reading the books (these pages are read-only)

**Recurring page** (`/accounting/recurring`)
- **Top tiles:** active clients, **Monthly recurring** (monthly + yearly ÷ 12),
  overdue count, blocked count.
- **Per client:** services, monthly/yearly amount, **next due** date, and a status
  badge — **Blocked**, **Overdue**, **Done**, or **Active**.
- Use the **filter** box to search by client, email, or industry.

**Accounting Clients page** (`/accounting/clients`)
- Columns: code, start date, company, contact, email, phone, VAT, active job
  count, monthly/yearly revenue, status, industry.
- Use the **search** box; tick **"Blocked only"** to see just frozen accounts.

### H. Expenses (admin only)

**Add an expense**
1. Open **Accounting → Expenses** → click **"+ New expense"**.
2. Fill in **Category**, **Vendor**, **Billing type** (One-time/Monthly/Yearly),
   **Amount (net)**, **VAT rate (%)** (Gross is calculated), **Start date**,
   optional **End date**, **Payment method**, and **Notes**.
3. Click **"Save"** (records it as pending) or **"Save & mark paid"**.

**Mark an expense paid** — open the expense → **"Mark paid"** → enter a
**Payment method** → **"Save"**.

**Attach a receipt** — open the expense → **"Upload receipt"** (PDF, PNG, JPEG,
or WebP).

**Delete an expense** — open the expense → **"Delete"** → confirm.

**Filter the list** — by status (**All** / **Pending** / **Paid**), by
**Category**, or with the **"Search vendor…"** box.

### I. Report — P&L & MRR (admin only)

**Pick a period** — at the top of **Accounting → Report**, choose **This month**,
**Last month**, **This year**, **Last year**, or **Custom range** (then set
**From** / **To**). Year-to-date is shown alongside.

**Read the four tiles** — **Income** (paid invoices), **Expenses** (paid
expenses), **Net profit**, and **MRR**. MRR shows two numbers:
- **Contracted MRR** — what active recurring jobs *should* bill (monthly +
  yearly ÷ 12).
- **Collected MRR** — what was *actually paid* on monthly subscriptions in the
  selected range.

**Drill into a category** — click any row in the **Income** or **Expense**
breakdown to open the transaction list for that group.

**Export** — click **"Export"** → **"Download CSV"** or **"Download PDF"**.

---

## 14. Quick glossary

- **Deal** — a won sale. The card on the Onboarding board. Holds the client, the
  jobs, and the payment schedule.
- **Job** — one service = one unit of work **and** billing (title, department,
  price, VAT, cadence). Custom jobs and "billing-only" jobs are added by
  accounting.
- **Payment row** — one line of the invoice: a service, a period, net/VAT/gross,
  and paid/pending/overdue status.
- **Net / Gross** — net is before VAT; gross is what the client pays. You always
  enter net.
- **Release / spawn** — putting a deal's jobs onto the technical teams' boards
  (happens at Partial Payment and Paid In Full).
- **Block / On Hold** — pausing work until paid. Job-level (one job), or
  client-level / On Hold (all the client's open work except their website and
  hosting).
- **Renewal** — the column each recurring service restarts in every time the
  client pays (Web SEO, Local SEO, Ads, Social).
- **Done (tech board)** — "this month's work finished, waiting for renewal" — a
  monthly rest, not the end. The next payment restarts it in Renewal.
- **MRR** — monthly recurring revenue (contracted vs collected).
- **Complete accounting** — what happens at **Paid In Full**: jobs unlocked,
  deal stamped ✓, client Active.

## AI Βοηθός (2026-08-25)

Η σελίδα **Λογιστήριο → Βοηθός AI** (`/accounting/assistant`) απαντά ελεύθερες
ερωτήσεις («τι γίνεται με τον πελάτη Χ;», «ποιοι είναι ληξιπρόθεσμοι;») με
δεδομένα από τη βάση — ποτέ από τη «μνήμη» του μοντέλου. Τεχνικά: edge
function `accounting-chat` (OpenAI tool-calling, μοντέλο από το secret
`AI_CHAT_MODEL`, default gpt-4o)· ΟΛΑ τα queries τρέχουν με το JWT του χρήστη
που ρωτάει, άρα ισχύει το RLS όπως στο υπόλοιπο CRM (έξοδα/P&L μόνο admins).
Read-only — καμία ενέργεια. Ιστορικό ανά χρήστη στα `ai_chat_conversations` /
`ai_chat_messages` (RLS δικές του γραμμές). Πρόσβαση: ομάδα accounting + admins.
