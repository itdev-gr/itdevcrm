# ITDevCRM — Accounting & Technical: Full System Walkthrough

> **Purpose.** A complete, accurate reference for how the **Accounting** side (deals → recurring payments → reports) and the **Technical** side (Web SEO, Local SEO, Web Dev, and the coupled AI SEO) actually work — board by board, button by button, cell by cell. Written so a fresh session can pick up the system with zero prior context. Every claim is backed by `file:line` citations against the code/migrations as of **2026-06-17**.
>
> Stack: Vite + React + TypeScript frontend; Supabase Postgres (RLS + SECURITY DEFINER RPCs + pg_cron) backend; Resend for email. Boards are rendered from one parameterized kanban; "stages" are rows in `pipeline_stages`; permissions are `group_permissions`/`user_permissions` checked by `current_user_can(board, action)` with an `is_admin` super-bypass.

---

## 0. End-to-end flow (read this first)

```
LEAD (sales kanban)
  └─ dragged into the "won" column
       └─ convert_lead_to_client()  ── creates CLIENT + DEAL in one step
            • deal is created ALREADY LOCKED (locked_at set)
            • services_planned, payment_method, sales_note copied from the lead
            • accounting_stage_id = accounting_onboarding 'new'  → deal lands on the Accounting Onboarding board
            • AFTER INSERT trigger deals_seed_payments → seeds deal_payments rows
                 (web_dev installments split 50/50 or 50/25/25; setup fee row; VAT by country, NET basis)

ACCOUNTING ONBOARDING BOARD  (deal cards)
  New → (accounting moves manually) → Awaiting Payment → Documents Verified → Invoice Issued
      → Partial Payment   ── spawns JOBS (every service except web_dev spawns BLOCKED)
      → Paid In Full      ── complete_accounting(): spawns any missing jobs UNBLOCKED,
                              clears partial-payment blocks, stamps accounting_completed_at, client → active
      → Done   (archives the deal off the board, client → done)
      → Closed (kept visible, no client-status change; used for ClickUp imports)
  • A payment_method MUST be set before ANY stage move (UI + DB trigger).
  • Daily crons: renew recurring payments, flag overdue, move overdue deals → On Hold (client → blocked),
    and email clients payment reminders (−7 / +1 / +7 days around the payment's start_date).

TECHNICAL BOARDS  (job cards — one job per service sold)
  Jobs land in the board's first stage, owned by the service group's team lead.
  web_seo · local_seo · web_dev · social_media · hosting · ads  (ai_seo has NO board — it rides web_seo + local_seo)
  • Tech users drag jobs across stages; a terminal "completed" stage stamps completed_at.
  • Accounting can Block/unblock a job; blocked jobs park (Local SEO shows them in a virtual "Blocked" column).
  • The job Info tab (jobs.details JSONB) holds credentials / URLs / notes / report links.
    Shared notes + report URLs surface on the DEAL overview; credentials never do.
```

**Core tables to know:** `clients` → `deals` → (`deal_payments`, `jobs`). `pipeline_stages` defines every board's columns. `client_blocks` is the client-level block. `expenses` + `expense_categories` feed the P&L. Money lives in two places: **`deal_payments`** (scheduled income per deal) and **`jobs.monthly_amount`/`one_time_amount`** (the contracted figures used for MRR).

---

## 1. The Deal Detail Page (feeds Accounting + Technical)

**File:** `src/features/deals/DealDetailPage.tsx` (component `DealDetailPage`, lines 33–271). Routed by `:dealId` URL param (line 34). Loads the deal via `useDeal(dealId)` (line 41; `src/features/deals/hooks/useDeal.ts`).

The deal is the bridge between Sales and the rest of the system: a converted lead becomes a `deals` row whose `services_planned` JSONB later spawns one technical **job** per service and seeds the **deal_payments** rows that accounting tracks.

### 1.1 Purpose & tab structure

Header bar (lines 113–214), then a `Tabs` component (lines 216–268, default tab `overview`). The eight tabs (`TabsList`, lines 217–226):

| Tab value | Label key (EN / EL) | Content component | File:line |
|---|---|---|---|
| `overview` | "Overview" / "Επισκόπηση" | `DealForm` + `DealNotesArea` + `DealServiceInfo` (left, 65% col) and `CommentsPanel` (right aside, 35% col) | 218, 228–242 |
| `payment` | "Payment" / "Πληρωμή" | `PaymentsPanel` — **documented in §3.5**. Rendered with `services={dealServices}` and `defaultVatRate = client.country === 'Greece' ? 24 : 0` | 219, 243–249 |
| `jobs` | "Jobs" / "Εργασίες" | `JobsTab dealId accountingCompletedAt` | 220, 250–252 |
| `tasks` | "Tasks" / "Καθήκοντα" | `AssignedTasksTab source={{kind:'deal', id}}` | 221, 253–255 |
| `attachments` | "Attachments" / "Συνημμένα" | `AttachmentsPanel parentType="deal"` | 222, 256–258 |
| `activity` | "Activity" / "Δραστηριότητα" | `ActivityPanel entityType="deals"` | 223, 259–261 |
| `offers` | literal "Offers" (no i18n) | `OffersTab dealId` | 224, 262–264 |
| `contracts` | `contracts:tab.title` | `ContractsTab clientId` (only if `deal.client_id` set) | 225, 265–267 |

There is no `comments` tab; comments live in the right column of the Overview tab (heading uses `leads:tabs.comments`, line 237).

**Header controls** (lines 126–213):
- "Deal" purple pill + `CopyableCode` of `deal.code` + `deal.title` (116–120); created-at date + relative time (122–124).
- **Client status** `<select>` (131–141): bound to `deal.client.status` (default `new`), options new/active/blocked/done; `onChangeClientStatus` writes `clients.status` (78–85).
- **Sales person** read-only label (143–150): `wonBy.full_name || email` from `deal.won_by_user_id`.
- **"Send welcome email"** button (151–155), shown only when `deal.won_by_user_id` set; opens `SendEmailDialog` seeded from `buildWonDraft(client.name)` with `dedupeKey = "won:<dealId>"`.
- **Owner** `<select>` (165–184): writes `deals.owner_user_id`; **disabled when accounting-completed**.
- **Move-to (accounting stage)** `<select>` (185–204): only when `deal.accounting_stage_id` set AND not completed. Requires `payment_method` first (else alert); if target is `paid_in_full` it calls the `completeAccounting` RPC, otherwise writes `accounting_stage_id` (87–109).
- **Completed marker** "✓ Complete" when `accounting_completed_at` set (205–207); **lock 🔒** + relative lock time, admins only, when `locked_at` set (208–212).

### 1.2 `services_planned` (the spine)

`deals.services_planned jsonb not null default '[]'` (`20260502000012_phase4_deals_extension.sql:6–7`). Shape `PlannedService` (`src/features/deals/ServicesPlannedField.tsx:16–27`):

| Key | Type | Meaning |
|---|---|---|
| `service_type` | `web_seo \| local_seo \| web_dev \| social_media \| ai_seo \| hosting \| ads` | service category |
| `billing_type` | `one_time \| recurring_monthly \| recurring_yearly` | cadence. Hosting is forced to `recurring_yearly` (57–59, 65) |
| `payment_terms` | `full \| 50_50 \| 50_25_25 \| null` | **web_dev only** — installment split of the one-time total; `billing_type` stays `one_time` |
| `package_id` | `string \| null` | FK into `service_packages` |
| `one_time_amount` | number | one-time / website total |
| `monthly_amount` | number | monthly **or** yearly amount (field reused for both cadences) |
| `setup_fee` | number | one-time setup charge |
| `subpackage_codes` | string[] | selected Extras / sub-products by code |

**Editing UI** — `ServicesPlannedField` (377–465) inside DealForm's "Sales" section. Each row = `ServiceRowEditor` (94–375) in a 12-col grid:
- **Service** `<Select>` (115–157): switching to `web_dev` resets to `{billing_type:'one_time', payment_terms:'50_50', …}`; switching away clears `payment_terms`.
- **Package** `<Select>` (158–177): filtered by service_type; `pickPackage` seeds amounts from package defaults.
- **Billing/Terms** `<Select>` (178–225): web_dev shows the three `payment_terms`; otherwise billing options (hosting locked to Yearly).
- **Amount inputs** (226–292): web_dev → "Total amount €" with a live split preview; recurring → "Monthly €"/"Yearly €" + "Setup €"; one_time → "One-time €".
- **Remove** "×" (293–304); **Add service** in header (`addRow` pushes `{service_type:'web_seo', billing_type:'recurring_monthly'}`).

**Drives job spawning:** `release_jobs_for_deal(deal, partial_payment_mode)` iterates `services_planned` and inserts one `jobs` row per service into the board's first stage (`20260610000003_release_jobs_first_stage.sql:42–99`). Idempotent per `(deal_id, service_type)`.

**Drives payment seeding:** `seed_deal_payments(deal)` iterates the same array (`20260617000004_webdev_installment_seeding.sql:23–67`), fired by `deals_seed_payments` AFTER INSERT on deals, guarded so it only runs when the deal has no payments yet.

### 1.3 Website billing terms (Fully paid / 50-50 / 50-25-25)

Set on a **web_dev** row in the Billing/Terms `<Select>` (`ServicesPlannedField.tsx:180–205`). Values (`deals:services.payment_terms`):
- `full` → "Fully paid" / "Εξοφλήθηκε"
- `50_50` → "50 / 50" (default on web_dev)
- `50_25_25` → "50 / 25 / 25"

`paymentTermSplit(total, term)` (31–35): `full` → `[total]`; `50_25_25` → `[50%,25%,25%]`; else `[50%,50%]`. **Connection to installments:** in `seed_deal_payments`, when `billing_type='one_time' AND service_type='web_dev' AND payment_terms IN ('50_50','50_25_25')`, the one-time total splits into N `deal_payments` rows (each `one_time`), labelled `Installment i/N` (`20260617000004:30–42`). `full` → a single one-time row. Job creation is unaffected — only the seeded payment rows differ.

### 1.4 Every button / control on the deal page

| Control (EN / EL) | Where | Effect |
|---|---|---|
| Client status select | DealDetailPage.tsx:131–141 | writes `clients.status` |
| Send welcome email | 151–155 | opens `SendEmailDialog` |
| Owner select | 165–184 | writes `deals.owner_user_id` (disabled if completed) |
| Move-to accounting stage ("Move to"/"Μετακίνηση σε") | 185–204 | `completeAccounting` or write `accounting_stage_id` |
| Title input | DealForm.tsx:207–210 | autosave `deals.title` |
| Full name / Email / Phone / Info | 213–243 | autosave `clients.contact_first/last_name`, `email`, `phone`, `contact_info` |
| Additional contacts | 246–253 | autosave `clients.additional_contacts` |
| Company / VAT / Website / Industry / Country / Address | 255–315 | autosave `clients.*` |
| Payment method select (Cash/Online) | 317–331 | autosave `deals.payment_method` |
| Deal amount input ("Deal amount"/"Ποσό συμφωνίας") | 332–340 | autosave `deals.temp_amount` (free-text reference) |
| Add service | ServicesPlannedField.tsx:431–435 | `addRow` |
| Remove service "×" | 293–304 | `removeRow` |
| Service / Package / Billing / amount controls | 115–292 | mutate `services_planned` |
| **Extras toggle** ("Extras") | 308–321 | collapsible; shown only when the row has a `package_id` with subpackages; `(count)` badge |
| Extras checkboxes | 322–369 | toggle `subpackage_codes` AND adjust the row amount by ±`sp.price` |
| Sales Note textarea ("Sales Note"/"Σημείωση πωλήσεων") | DealNotesArea.tsx:60–69 | autosave `deals.sales_note` |
| Attach contract | Attachments tab (`AttachmentsPanel`) | upload with `kind='contract'`, `parent_type='deal'` |
| Contracts tab "+ new" | ContractsTab.tsx:15 | links to `/contracts/new?clientId=…` |

> **Corrections flagged by investigation:**
> - **There is NO "Lock deal" button.** `useLockDeal`/`lockDeal` exist but are imported by no component; the page only *displays* the 🔒 state. The real sales→accounting transition is **`convert_lead_to_client`** (see §1.6).
> - **No Social section on the deal page.** Instagram/Facebook/TikTok/LinkedIn fields live only on the **LeadForm** (`src/features/leads/LeadForm.tsx:60–63, 277–289`) and are not carried onto the deal.

### 1.5 Every field / cell shown

Header cells: `deal.code`, `deal.title`, `deal.created_at`, `deal.client.status`, `deal.won_by_user_id`, `deal.owner_user_id`, `deal.accounting_stage_id`, `deal.accounting_completed_at`, `deal.locked_at`.

DealForm fields (all autosaved): Title→`deals.title`; Full name→`clients.contact_first_name`+`contact_last_name`; Email/Phone/Info→`clients.email`/`phone`/`contact_info`; Additional contacts→`clients.additional_contacts`; Company/VAT/Website/Industry/Country/Address→`clients.*`; Payment method→`deals.payment_method` (`null|cash|online`); Deal amount→`deals.temp_amount` (text, manual ClickUp reference); Services planned→`deals.services_planned`.

**Pricing summary** table (DealForm.tsx:346–393): computed client-side, not stored — `oneTimeNum = Σ(one_time_amount + setup_fee)`, `monthlyNum = Σ monthly_amount` of monthly rows, `yearlyNum = Σ monthly_amount` of yearly rows; rows One-time/Monthly/Yearly × Subtotal/VAT/Total. **The deal patch persists `one_time_value = oneTimeNum` and `recurring_monthly_value = monthlyNum`** (123–124, 168–169) — these two columns are what lock/complete validate; yearly is not a stored column.

`DealNotesArea`: editable **Sales Note**→`deals.sales_note`; read-only **Web SEO / Local SEO / Website notes** pulled from the deal's **jobs** (`job.details.seo_notes` / `local_notes` / `webdev_notes`), each block shown only if a job of that type exists.

`DealServiceInfo`: per-job fields where `sharedWithDeal=true` and non-empty — report URLs + notes, grouped by service_type. Credentials are never shared to the deal.

### 1.6 `lock_deal` flow + the real transition

**`lock_deal(target_deal_id)`** (`20260502000012_phase4_deals_extension.sql:38–119`) — gate `is_admin OR current_user_can('sales','lock_deal')`; validations accumulated into `errors[]`:
1. client must exist (`client_missing`)
2. **total value > 0**: `one_time_value + recurring_monthly_value > 0` else `value_required`
3. **≥1 service**: `jsonb_array_length(services_planned) > 0` else `at_least_one_service_required`
4. **contact info**: email non-empty (`client_email_required`) AND (phone OR address) (`client_phone_or_address_required`)
5. **contract attachment**: ≥1 non-archived `attachments` row with `parent_type='deal'`, `kind='contract'` else `contract_attachment_required`

On success: stamps `locked_at`, `locked_by`, `actual_close_date=current_date`, moves sales `stage_id` → `won`, and sets `accounting_stage_id` → accounting_onboarding `new`.

**However**, the live app uses **`convert_lead_to_client(target_lead_id)`** (`20260616150737_deal_notes_and_temp_amount.sql:12–144`), triggered when a sales user drags a lead into the **won** column (`SalesKanbanPage.tsx:126–135`). It validates the *lead* (value>0, ≥1 service, email, phone-or-address, company name, payment_method) and creates the client + deal **already locked and already on the accounting board** (`locked_at=now()`, `accounting_stage_id = accounting_onboarding 'new'`, `won_by_user_id=auth.uid()`, carrying `services_planned`, `payment_method`, and the lead's Sales Note). On that INSERT, `deals_seed_payments` seeds the payments.

---

## 2. Accounting — Onboarding Board

Board code `accounting_onboarding`. Page `src/features/accounting/AccountingOnboardingKanbanPage.tsx`. Route `/accounting/onboarding` (`router.tsx:197`), gated by `<RequireGroup groups={['accounting']}>` (admin OR `accounting` group).

### 2.1 Purpose
Handoff point between Sales and Accounting. A locked won deal arrives with `accounting_stage_id = new`. Accounting verifies documents, issues an invoice, chases payment, and on "Paid In Full" triggers `complete_accounting`, which spawns the operational jobs and marks the client active. The board shows deals where `accounting_stage_id is not null AND archived=false`, ordered `updated_at desc` (`useAccountingDeals.ts:28-35`).

### 2.2 Stages / columns (current, after all migrations)

| code | EN | EL | pos | terminal | notes |
|------|----|----|-----|----------|-------|
| `new` | New | Νέο | 10 | no | Deals land here on lock; a trigger keeps brand-new deals here until accounting moves them manually. |
| `awaiting_payment` | Awaiting Payment | Αναμονή Πληρωμής | 15 | no | Reordered to slot 2. Subtitle "7 days prior". Auto-target when a payment row is inserted. |
| `on_hold` | On Hold | Σε Αναμονή | 17 | no | Subtitle "Blocked". Setting this stage sets `clients.status='blocked'`. Daily cron moves overdue deals here. |
| `documents_verified` | Documents Verified | Έγγραφα Επιβεβαιωμένα | 20 | no | |
| `invoice_issued` | Invoice Issued | Τιμολόγιο Εκδόθηκε | 30 | no | |
| `partial_payment` | Partial Payment | Μερική Πληρωμή | 50 | no | Entering spawns jobs (non-web_dev blocked) and sets `clients.status='active'`. |
| `paid_in_full` | Paid In Full | Πλήρως Εξοφλημένο | 60 | **yes** (`paid`) | `triggers_action='complete_accounting'`. Dropping a card here runs `complete_accounting`. |
| `done` | Done | Ολοκληρώθηκε | 80 | **yes** (`cancelled`) | Renamed from `refunded`. Entering it sets `clients.status='done'` AND archives the deal (leaves the board). |
| `closed` | Closed | Κλειστό | 90 | no | NEW (`20260617000002`). Keeps the deal visible and does NOT change client status. For ClickUp imports whose list-status was "done/delivered". |

Source seeds: `20260502000002_pipeline_stages.sql:57-64` plus repositions/renames in `20260503000017/18/20` and the new `closed` stage in `20260617000002`.

### 2.3 Buttons / controls
This board has **no explicit buttons** — interaction is drag-and-drop plus card links.
- **Drag a card to another column** (`onDragEnd`, AccountingOnboardingKanbanPage.tsx:60–80): if `payment_method` is null it alerts `payment_method_required` and aborts; if dropped on `paid_in_full` it calls `complete.mutateAsync(dealId)`; any other column calls `moveStage.mutateAsync({dealId, stageId})` (a plain `UPDATE deals SET accounting_stage_id`).
- **Card title link** → `/deals/{id}`. **Deal code chip** (CopyableCode) copies the code.
(The accounting `complete_accounting` permission and a "Complete accounting" string exist but no button renders it here — completion is purely the Paid-In-Full drop.)

### 2.4 Card cells (`AccountingKanbanCard.tsx`)
| Cell | Source | Format |
|---|---|---|
| Deal code badge | `deals.code` | CopyableCode, if present |
| Title (link) | contact full name, else `client.name`, else `deals.title` | |
| Completed ✓ | `deals.accounting_completed_at` | green check if set |
| Company · category | `clients.name` + `clients.industry` | |
| One-time value | `deals.one_time_value` | `€n`, only if >0 |
| Recurring value | `deals.recurring_monthly_value` | `€n/mo`, only if >0 |
| Owner | `deals.owner_user_id` → name/email | 👤 |
| Services | `deals.services_planned` | service labels joined by " · " |
| Payment status badge | derived from `deal_payments` (`paymentSummary`) | paid=emerald / partial=amber / pending=slate |
| Invoiced 📄 | `deal_payments[].invoice_number` | shown if ≥1 row AND every row has an invoice number |
| Next-due ⏳ | earliest pending `deal_payments.end_date` | relative; shown only when not fully paid |
| Locked 🗓 | `actual_close_date ?? locked_at ?? updated_at` | relative |

### 2.5 `complete_accounting` step-by-step
> The current definition is `20260504000001_jobs_blocked_state.sql:156–225` (earlier `20260502000013/25/37`, `20260503000003` are **superseded**). It delegates job-spawning to `release_jobs_for_deal`.

1. **Permission**: `is_admin OR current_user_can('accounting_onboarding','complete_accounting')` else `permission_denied`.
2. Load deal; not found → `deal_not_found`.
3. Already completed (`accounting_completed_at` set) → `already_completed`.
4. Not locked (`locked_at` null) → `deal_not_locked`.
5. Validations: empty `services_planned` → `services_planned_empty`; `one_time_value` null/`<0` → `invalid_one_time_value`.
6. **Spawn missing jobs unblocked**: `release_jobs_for_deal(d.id, false)` — for each planned service (allowed types/billing only), idempotent per `(deal, service_type)`, into the board's first stage, owner = `team_lead_for_group`, `status='active'`.
7. **Clear partial-payment blocks**: unblock all jobs of the deal where `blocked_reason='partial_payment_pending'`.
8. **Stamp deal**: `accounting_completed_at=now()`, `accounting_completed_by=auth.uid()`, move `accounting_stage_id → paid_in_full` (re-fires triggers → `clients.status='active'`).
9. **Notify** the owner.
10. Returns `{ok:true, deal_id, code}`.

Note: jobs may already exist from passing through `partial_payment` (trigger `deals_release_jobs_partial_payment` calls `release_jobs_for_deal(id, true)`, which blocks non-web_dev jobs). `complete_accounting` just fills gaps and unblocks.

### 2.6 Move-stage rules & side effects
- **Hard block**: trigger `guard_payment_method_before_stage_move` (BEFORE UPDATE, `20260503000009`) raises `payment_method_required` if `accounting_stage_id` changes while `payment_method` is null (also covers the `complete_accounting` update). The UI pre-checks the same.
- **`deals_sync_client_status`**: `partial_payment`/`paid_in_full`→`active`; `on_hold`→`blocked`; `done`→`done` + archives the deal. `closed`/`new`/`documents_verified`/`invoice_issued`/`awaiting_payment` → no status change.
- **`deals_release_jobs_partial_payment`**: entering `partial_payment` → `release_jobs_for_deal(id, true)` (non-web_dev jobs blocked with `partial_payment_pending`).
- **`deal_payments_move_to_awaiting`** (AFTER INSERT on `deal_payments`): a new payment row auto-moves the deal to `awaiting_payment`, EXCEPT brand-new deals (stay in `new`), completed deals, terminal stages, or already-awaiting.
- **Daily cron** `move_overdue_deals_to_on_hold()` (02:05 UTC): deals with a pending payment whose `end_date <= today` → `on_hold` (skipping completed/terminal).
- On board open, `useAccountingKanbanRealtime` calls `ensure_recurring_payments()` and subscribes to realtime `deals`/`deal_payments` changes.

---

## 3. Accounting — Recurring Billing & Payments

> **Two generations exist.** The Phase-5 `monthly_invoices` system was **fully dropped** (`20260502000019`); do NOT treat it as live (`client_blocks` survived the drop). Everything below is the current **`deal_payments`** system.

### 3.1 `deal_payments` table (current columns)
Base `20260503000010_deal_payments.sql`; VAT cols `20260601000005_deal_payments_vat.sql`; `overdue` status `20260610000004`.

| Column | Meaning |
|---|---|
| `id` / `deal_id` (FK, cascade) / `service_type` | identity + which deal + which service |
| `service_index` | index within `services_planned`; renewal successors share it |
| `billing_type` | `one_time \| recurring_monthly \| recurring_yearly` (the recurring-vs-one-time marker — no boolean) |
| `label` | e.g. `Setup fee`, `Installment 1/2` |
| `amount` | **DEPRECATED gross** — read `amount_gross`; slated to drop after 2026-07-01 |
| `start_date` | period start / **the date reminders key on** |
| `end_date` | period end / **the date overdue/renewal/next-due key on** |
| `status` | `pending \| paid \| overdue` (default pending) |
| `invoice_number` | manual, entered by accounting |
| `paid_at` | set when toggled to paid |
| `amount_net` | **authoritative entered amount (NET, pre-VAT)** |
| `vat_rate` | percent, default 24, CHECK 0–100 |
| `vat_amount` | generated: `round(amount_net*vat_rate/100, 2)` |
| `amount_gross` | generated: `round(amount_net + amount_net*vat_rate/100, 2)` — the figure invoiced/emailed/shown |

RLS: SELECT for admin / `sales:view` / `clients:view` / `accounting_onboarding:view`; write for admin / `accounting_onboarding:edit`. In the realtime publication.

### 3.2 How payments are generated
**Initial seeding** — `seed_deal_payments(deal)` (current `20260617000004_webdev_installment_seeding.sql:6–68`), fired AFTER INSERT on `deals`, idempotent:
- **VAT by country**: `cyprus → 0%`, **everything else (incl. unknown) → 24%** (matches `src/lib/countries.ts`).
- Period start = `coalesce(deals.actual_close_date, current_date)`. **The entered amount is treated as NET** (net-basis since `20260616110538`; gross = net + VAT).
- `one_time` → one row (`end=start`); `recurring_monthly` → one row (`end=start+1 month`); `recurring_yearly` → one row (`end=start+1 year`, with the annual figure in `monthly_amount`).
- **Web_dev installments**: `one_time` + `web_dev` + `payment_terms in (50_50, 50_25_25)` → split into `one_time` rows labelled `Installment i/n` (`[0.5,0.5]` or `[0.5,0.25,0.25]`).
- **Setup fee** > 0 → separate `one_time` row labelled `Setup fee`.

> Net-basis history: earlier code treated entries as gross and back-divided. After the fix a €500/mo Greek service bills **€620 gross**; Cyprus (0%) unaffected. Only new seedings changed.

**Recurring renewal** — `ensure_recurring_payments()` (current `20260601000005:102–140`): scans recurring rows on non-archived deals whose `end_date <= today + 7 days` with no successor, inserts the next period (copies `amount_net`, `vat_rate`; advances `end` by 1 month/year). Idempotent. Run by daily cron `daily_ensure_recurring_payments` (02:00 UTC) **and** on accounting-board mount.

> The `recurring_test_2min` cadence/column/every-minute cron were all **removed** (`20260503000023`); a dead `recurring_test_2min` branch remains in the auto-kanban trigger.

A parallel **recurring expenses** system mirrors this (`ensure_recurring_expenses()`, daily 02:05).

### 3.3 Payment status automation
- **Auto-move to Awaiting Payment** (`deal_payments_move_to_awaiting`, current `20260503000021`): new payment row → deal `accounting_stage_id = awaiting_payment`, EXCEPT brand-new deals (stay in `new`), completed, terminal, or already-awaiting.
- **Overdue marking** (`mark_overdue_payments()`, daily 02:15 UTC): flips `pending → overdue` where `end_date < today` and inserts in-app `payment_overdue` notifications to admins + accounting (only for newly-flipped rows).
- **Move overdue deals → On Hold** (`move_overdue_deals_to_on_hold()`, daily 02:05): deals with a pending payment `end_date <= today` (keys on `pending`, runs before the 02:15 overdue flip).
- **Card display** (`paymentSummary`, AccountingKanbanCard.tsx:12–24): paid if all paid, pending if none, else partial; invoiced badge; next-due = earliest pending `end_date`.

**Cron summary (payments/recurring/expenses):**

| Cron | Schedule (UTC) | RPC |
|---|---|---|
| `daily_ensure_recurring_payments` | `0 2 * * *` | `ensure_recurring_payments()` |
| `daily_ensure_recurring_expenses` | `5 2 * * *` | `ensure_recurring_expenses()` |
| `daily_move_overdue_deals_to_on_hold` | `5 2 * * *` | `move_overdue_deals_to_on_hold()` |
| `mark-overdue-payments` | `15 2 * * *` | `mark_overdue_payments()` |
| `daily_payment_reminders` | `0 6 * * *` | `enqueue_payment_reminders()` |

### 3.4 Payment reminders (client emails)
`enqueue_payment_reminders()` runs daily at **06:00 UTC** (~09:00 Athens). It scans `deal_payments` (non-archived deals, clients with email) and queues one `email_outbox` row (identity `accounting`) per match whose **`start_date`** matches an offset of `current_date`, deduped via `email_log`/`email_outbox` on `<prefix>:<payment_id>`.

**Current cadence** (after the rebuild + due-today drop, `20260616000005`):

| Offset vs `start_date` | Template | Content |
|---|---|---|
| **−7 days** | `payment_due_soon` | "payment due soon" + IBANs (NBG, Piraeus) + Viva Wallet link |
| **+1 day** | `payment_overdue` | "outstanding / pay ASAP" + instructions |
| **+7 days** | `payment_final_notice` | final notice — services will be paused until paid |

The **due-today** reminder is **disabled** (template row kept, branch removed). Payload: `client_name`, `service_type`, `amount_gross`, `due_date (DD/MM/YYYY)`, `deal_id`. Template bodies live in `email_templates` rows (authoritative; `send-email` uses `renderDbTemplate`).

> **Date-field gotcha:** reminders key on **`start_date`**; overdue/renewal/next-due/on-hold all key on **`end_date`**. For recurring rows these are a full period apart.

### 3.5 The per-deal Payments panel (`src/features/deals/PaymentsPanel.tsx`)
Rendered in the deal's "Payment" tab. `defaultVatRate = client.country==='Greece' ? 24 : 0` (note: this UI default differs from the DB default, which is 24 for everything-except-Cyprus). CRUD via `useDealPayments` directly against `deal_payments` (admin/`accounting_onboarding:edit`), ordered by `service_index` then `start_date`.

**Header button** `+ Add payment` toggles the add form. **Table columns & per-row behavior** (`PaymentRow`):

| Column | Cell behavior |
|---|---|
| Service | `services.types.*` + `services.billing.*` |
| Label | text input, commits `label` on blur |
| Start | date input → `start_date` |
| End | date input → `end_date` |
| Net (€) | number input → `amount_net` (blur) |
| VAT % | number input → `vat_rate` (blur); amber when `vat_rate !== countryVatRate` |
| Gross (€) | computed preview matching the DB generated column |
| Status | button toggling paid↔pending (sets/clears `paid_at`); emerald/red/slate |
| Invoice # | text input → `invoice_number` (blur) |
| (actions) | "×" delete with confirm |

**Add-payment form**: Service + Billing-type selects, Label, Start, End, Net, VAT % (defaults to `defaultVatRate`), live Gross; submit disabled until a net amount is entered. Status/invoice/paid_at are edited inline after creation.

### 3.6 The Recurring Clients page (`AccountingRecurringPage.tsx`)
Route `/accounting/recurring`. **Read-only — no mutation buttons.** Data via `useRecurringClients` (clients with active recurring jobs only; clients with none dropped).

**Stat cards**: Active clients (`rows.length`); **Monthly recurring** = `Σ(monthly_total + yearly_total/12)` (yearly annualized); Overdue count; Blocked count.
**Filter**: single text input (name/email/industry).
**Table columns**: Client (link to first live deal else client), with contact·email sub-line; Services (`active_services` joined); Monthly (`€monthly_total`, second line `€yearly_total/yr` if any); Next due (`earliest_due` of recurring pending/overdue payments); Status badge (Blocked > Overdue > Done > Active).

### 3.7 VAT & monthly-vs-yearly
- Per-row `amount_net` (entered), `vat_rate` (default 24), generated `vat_amount` and `amount_gross`. **Net basis** since `20260616110538`.
- Country map (`src/lib/countries.ts`): Greece 24%, Cyprus 0%, default 24%. (UI panel default gives 0% to every non-Greece country — a known discrepancy with the DB default.)
- For **both** monthly and yearly, the per-service amount lives in `monthly_amount`; yearly holds the annual figure. Seeding sets first `end_date` to +1 month / +1 year; renewal advances by the same interval. The Recurring page annualizes yearly to `/12` for the MRR stat.

---

## 4. Accounting — Clients, Reports & Blocks

### 4.1 Accounting Clients page (`AccountingClientsPage.tsx`)
Route `/accounting/clients`, gated by the accounting `RequireGroup` (not admin-only). A read-mostly billing roster of non-archived clients with derived revenue + block status. **No per-row edit/save buttons.**

**Controls**: title; **search input** (filters code/name/contact/email/phone/industry/country/VAT); **"Blocked only" checkbox** (hides clients with no active `client_blocks` row).

**Columns** (revenue computed from embedded **active** jobs = `!archived && status='active'`):

| Col | Cell | Source |
|---|---|---|
| Code | CopyableCode | `clients.code` |
| Start | `start_date` else `created_at` | |
| Company | link → `/clients/{id}` | `clients.name` |
| Contact | first+last | `clients.contact_first/last_name` |
| Email / Phone (CallLink) / VAT | text | `clients.*` |
| Jobs | active jobs count | derived |
| € / mo | `Σ monthly_amount` of `recurring_monthly` jobs | derived |
| € / yr | `Σ monthly_amount` of `recurring_yearly` jobs (annual figure stored there) | derived |
| Status | red Blocked / amber Pending(no jobs) / green Active | derived |
| Industry | localized label | `clients.industry` |

The recent **`clients:edit` fix** (`20260617000003`) granted the `accounting` group `clients:edit` so accounting edits to client fields (e.g. company name on a deal) stop being silently rejected by the `clients_update` RLS — it's a backend fix, not a UI change here.

### 4.2 Block / Unblock client
**`client_blocks` table** (`20260502000014:108–117`): `client_id` (cascade), `blocked_at/by`, `reason` (NOT NULL), `unblocked_at/by`. Partial unique index → **at most one active block per client**. No INSERT/UPDATE RLS — all mutation via SECURITY DEFINER RPCs.

- **`block_client(client, reason)`** (`20260502000016:23–58`): gate admin OR `accounting_recurring/onboarding:block_client`; requires reason; errors `already_blocked`/`client_not_found`; inserts a block row.
- **`unblock_client(client)`** (`:63–93`): gate admin OR `…:unblock_client`; sets `unblocked_at/by`; `not_blocked` if none.

**What blocking prevents**: trigger `enforce_no_stage_move_when_blocked` — if a **job's** `stage_id` changes while the client is blocked and the caller isn't admin → `RAISE 'client_blocked'`. So a blocked client's jobs can't be moved across stages by non-admins until unblocked.

**UI**: `BlockBadge` (red "🚫 Blocked – Awaiting Accounting", title=reason) next to the client name and per-row on the clients list; `BlockClientDialog` (required reason) on `ClientDetailPage`, with Block/Unblock buttons. (Caveat: `ClientDetailPage` redirects to `/deals/:id` when a live deal exists, so those buttons are only reachable for clients with no live deal.)

> Distinct mechanism — **`jobs.is_blocked`** (per-job): RPCs `block_job`/`unblock_job` (gate admin OR `accounting_onboarding:edit`); non-web_dev jobs auto-block at `partial_payment` (`partial_payment_pending`) and auto-unblock at `complete_accounting`. Not surfaced on the clients page.

### 4.3 Reports / Ledger / P&L (admin-only)
`/accounting/report` and `/accounting/expenses` are wrapped in `<AdminGuard>`; the `expenses` table RLS is admin-only. There is no `accounting_report` permission — the gate is purely admin.

**`accounting_ledger_v`** (`20260601000006`, `security_invoker`): `UNION ALL` of an **income** leg (from `deal_payments` join deals/clients: `direction='in'`, `event_date = coalesce(paid_at::date, start_date)`, `period`, `status`, net/vat/gross, `category_key = service_type`, `counterparty = client name`) and an **expense** leg (from `expenses` join categories: `direction='out'`, same shape, `category_key = category key`, `counterparty = vendor`).

**`accounting_pl_summary_v`** (`20260601000007`, grouped by period, **paid rows only**): `total_income_net/_vat/_gross`, `total_expense_net/_vat/_gross`, `net_profit_net`, `net_profit_gross`.

**Report page** (`ReportPage.tsx`):
- **Date-range presets**: this_month / last_month / this_year / last_year / custom (two date inputs). All UTC.
- **Four KPI tiles** (gross big + net small): Total income; Total expenses; Net profit; **MRR** (gross = contracted MRR, net line = collected MRR in period).
- **YTD strip** (income/expenses/net, gross).
- **IncomeBreakdown** / **ExpenseBreakdown**: group paid rows by category; cols Service/Category, Count, Net, VAT, Gross, %; row click → TransactionDrawer. ExpenseBreakdown has a **"+ New expense"** button.
- **TransactionDrawer**: per-group rows (Date, Counterparty, Billing, Net, VAT, Gross, Status); expense rows open the expense detail dialog.
- **ExportMenu**: Download **CSV** (`ledgerRowsToCSV`) and **PDF** (jsPDF: summary + up to 40 income + 40 expense rows).

**MRR metrics**: **Contracted MRR** (`useContractedMRR`) = Σ over active non-archived recurring jobs, monthly at face value + yearly ÷ 12. **Collected MRR** (`useMRR`) = Σ `amount_gross` of `recurring_monthly` **paid** payments overlapping the range (excludes yearly). The two are intentionally different metrics.

**Expenses page** (admin-only): "+ New expense"; filters status (All/Pending/Paid), category select, vendor search. **NewExpenseDialog**: category, vendor, billing type, net, vat_rate (default 24), live gross, start/end (end auto-derived), payment method, notes; "Save" (pending) or "Save & mark paid". **ExpenseDetailDialog**: Upload receipt (≤10 MB, pdf/png/jpeg/webp → `expense-receipts` bucket), Mark paid, Delete.

---

## 5. Technical — Job Lifecycle, Board Mechanics & Web Dev

### 5.1 `jobs` table
`20260502000008_deals_jobs.sql:87–111` + later columns:

| Column | Meaning |
|---|---|
| `id` / `deal_id` (cascade) / `client_id` (cascade) | identity + parents |
| `service_type` | which tech board (`web_seo`, `local_seo`, `web_dev`, `social_media`, `ai_seo`, `hosting`, `ads`) |
| `billing_type` | `one_time` / `recurring_monthly` / `recurring_yearly` |
| `one_time_amount` / `monthly_amount` / `setup_fee` | charges |
| `recurring_start_date` | start of recurring billing |
| `stage_id` (FK pipeline_stages, nullable) | current column; null = invisible |
| `owner_user_id` | assigned owner (set to the group team lead at spawn) |
| `assigned_group_id` | service-type group that owns the work |
| `status` | `active`/`paused`/`cancelled`/`completed` (DB enum; **no tech UI writes it**) |
| `monthly_tasks` / `monthly_tasks_period` | legacy per-period checklist (SEO templates emptied) |
| `started_at` / `completed_at` | spawn time / set when moved into a terminal "completed" stage (cleared when moved out) |
| `archived` (+ at/by/reason) | soft-archive; excluded from all queries |
| `is_blocked` / `blocked_reason` / `blocked_at` / `blocked_by` | job block state |
| `code` | the deal's `L-NNNNNN` code, copied at spawn |
| `details` (jsonb) | the Info-tab bag (URLs / credentials / notes / reports) |

**RLS**: `jobs_select` = admin OR `current_user_can(service_type,'view')` OR accounting view. `jobs_mutate_admin_or_service` = admin OR `current_user_can(service_type,'edit')`. Accounting has NO direct table-mutate — block/unblock go through SECURITY DEFINER RPCs.

### 5.2 Job lifecycle
Creation is driven by **`release_jobs_for_deal(deal, partial_payment_mode)`** (current `20260610000003:17–102`): per planned service (allowed types/billing only), idempotent per `(deal, service_type)`, resolves the group + `team_lead_for_group` owner, lands in the **lowest-position non-archived stage** of the board (`ai_seo` → `web_seo` board; `hosting` has no stages → `stage_id=null`), inserts `status='active'`, `started_at=now()`, `code=d.code`.

Two entry points:
1. **Partial Payment** → trigger `deals_release_jobs_partial_payment` → `release_jobs_for_deal(deal, true)` → **every job except web_dev spawns BLOCKED** (`partial_payment_pending`); web_dev unblocked (work can start before full payment).
2. **Paid In Full** → `complete_accounting` → `release_jobs_for_deal(deal, false)` (unblocked) + clears `partial_payment_pending` blocks.

States: **Active** (normal); **Blocked** (`is_blocked=true`, `stage_id` preserved); **Archived** (excluded); **Completed** — there is **no "complete job" RPC**; a job is completed by moving it into a terminal stage with `terminal_outcome='completed'` (Web SEO/Local SEO "Done", Web Dev "Live"), which stamps `completed_at`. The `status` enum is shown read-only but not written by tech UI.

### 5.3 Board mechanics (shared)
One `JobsKanbanPage` renders every tech board, parameterized by `serviceType`. Routes under `/tech` (`router.tsx:206–225`), gated by `RequireGroup` for `[web_seo, local_seo, web_dev, social_media, ai_seo, hosting, ads]`: `/tech/web-seo`, `/tech/local-seo`, `/tech/web-dev`, `/tech/social-media`, `/tech/hosting`, `/tech/ads`. **No `ai-seo` route** (AI SEO rides web-seo/local-seo). Plus `/tech/:serviceType/clients` (My Clients) and `/tech/:serviceType/docs` (only local_seo/web_dev/web_seo).

- `useJobs(serviceType)`: non-archived jobs `in serviceTypesForBoard` (web_seo/local_seo also include `ai_seo`), ordered `updated_at desc`; bucketed into columns by `groupJobsForBoard`.
- **Move a job** = drag/drop (`@dnd-kit`). On drop, `useMoveJobStage` updates `jobs.stage_id` (and stamps/clears `completed_at` via `stageCompletesJob`). Optimistic + rollback; errors via `alert()`.
- **Permission gate**: RLS `jobs_mutate_admin_or_service` (admin or service `edit`). No per-stage UI gate.
- **"Only mine" filter**: non-admins default to `owner_user_id === self` (`?mine=0` toggles to "All my group's"); admins see all + a static "Admin view · N" badge.
- **Realtime**: channel `jobs-${serviceType}` invalidates the board on change.

### 5.4 Buttons / controls on tech kanban
- **Page header**: board title; admin badge "Admin view · N"; non-admin **scope toggle** "Only mine"/"All my group's".
- **Column**: droppable target; header label + `(count)`. A virtual **"🔒 Blocked"** column renders only on `local_seo`.
- **Card**: whole card draggable; deal code chip (copyable); headline link → `/jobs/{id}`. **No block/unblock or move buttons on the card** — blocking is done from the Job detail page; movement is drag-only.

### 5.5 Tech card cells (`JobsKanbanCard.tsx`)
Headline (contact/client/title); deal code chip; **AI SEO** violet pill (if `service_type='ai_seo'`); **🔒 Blocked** red pill (title=reason) if `is_blocked`; green ✓ if `completed_at`; subtitle "client · industry"; "€monthly/mo" if >0; "👤 owner"; "🗓 updated relative".

### 5.6 Job detail page + Info tab (`JobDetailPage.tsx`)
**Header**: "Job" pill, deal code, full name, 🔒 Blocked badge; subtitle service·created·relative; **Block/Unblock button** (shown when `isAdmin || groups includes 'accounting'`) → RPCs `block_job`/`unblock_job` (authoritative gate = admin OR `accounting_onboarding:edit`); **Stage `<select>`** (same move path as a board drag); read-only Owner.

**Tabs**: **Overview** (`MonthlyTasksPanel` only when `recurring_monthly` AND service has no Info fields; `ContactsCard`; summary grid Service/One-time/Status/Client/Deal; `CommentsPanel`), **Info** (only when the service has Info fields), **Tasks**, **Attachments**, **Activity**.

**Info tab** (`JobInfoPanel`): reads `job.details` JSONB, one input per field grouped by section, **autosaves** the whole object. Field types: url / text / textarea / password (password masked with 👁 reveal). Fields per service (`serviceInfoFields.ts`):
- **local_seo**: `profile_url`, `local_report_url` (shared), `local_notes` (shared)
- **web_seo**: `website_username`, `website_password`, `web_report_url` (shared), `seo_notes` (shared)
- **web_dev**: `webdev_notes` (shared), `hosting`, `supabase_name`, `temp_url`, `live_url`, `email`
- **ai_seo**: union of Local SEO + Web SEO fields

**Creds vs notes**: inside the Info tab there is NO field-level role gating (anyone who can open the job sees/edits all fields, incl. passwords). The split is on the **deal overview** via `sharedWithDeal`: `DealServiceInfo` shows only shared (report URLs + notes) per job, and `DealNotesArea` surfaces the three notes (`seo_notes`/`local_notes`/`webdev_notes`) read-only. Credentials never reach the deal.

**`tech_my_clients`** view: per-service clients with a non-cancelled job updated in the last 90 days; columns Client/Industry/Active jobs/Last activity/Status.

### 5.7 Web Dev board — stages (after ClickUp realignment, `20260615000001`)

| Pos | Code | EN / EL | Terminal | Meaning |
|---|---|---|---|---|
| 10 | `new_project` | New Project / Νέο Έργο | no | Entry column (spawn lands here). |
| 20 | `client_contact` | Client Contact / Επικοινωνία Πελάτη | no | Reaching out. |
| 30 | `no_response` | Called / No response / Κλήση – Χωρίς Απάντηση | no | Awaiting reply. |
| 40 | `get_requirements` | Get requirements - Creds / Απαιτήσεις & Κωδικοί | no | Gathering requirements + credentials. |
| 50 | `planning` | Planning / Σχεδιασμός | no | Scoping the build. |
| 60 | `development` | Development / Ανάπτυξη | no | Active build. |
| 70 | `stuck` | Stuck / Κολλημένο | no | Stalled. |
| 80 | `revision` | Revision / Διόρθωση | no | Applying revisions. |
| 90 | `redesign` | Redesign / Επανασχεδιασμός | no | Larger redesign loop. |
| 100 | `waiting_client_approval` | Waiting client Approval / Αναμονή Έγκρισης Πελάτη | no | Awaiting sign-off. |
| 110 | `live` | Live / Παραδόθηκε | **yes (`completed`)** | Delivered — stamps `completed_at`. |

Old columns (awaiting_brief, discovery, wireframes, design, internal_qa, client_review, revisions, maintenance) were archived and jobs remapped. Web Dev is the only service that spawns **unblocked** under Partial Payment.

---

## 6. Technical — SEO Boards (Web SEO, Local SEO, AI SEO)

Cards here are **jobs** (one per client per SEO service). Only two physical routes exist: `/tech/web-seo`, `/tech/local-seo`. AI SEO has no route of its own.

### 6.1 Web SEO board (`board='web_seo'`, realigned `20260615000002`)
The original 5 generic stages (onboarding/audit_strategy/active/on_hold/cancelled) were archived; live web_seo AND ai_seo jobs remapped. Current stages:

| Pos | Code | EN / EL | Terminal | Meaning |
|---|---|---|---|---|
| 10 | `new_project` | New Project / Νέο Έργο | no | Entry; review deal/goals/notes, plan first contact. |
| 20 | `no_response` | No Response / Χωρίς Απάντηση | no | Tried to reach client, no answer. |
| 30 | `renewal` | Renewal / Ανανέωση | no | Subscription renewed; restart cycle. |
| 40 | `gsc_ga4_setup` | GSC & GA4 Setup | no | Mandatory access/setup: Search Console + GA4 + site creds. |
| 50 | `sitemap_schema` | Sitemap & Schema | no | sitemap.xml, robots.txt, schema markup. |
| 60 | `performance_audit` | Performance Audit | no | Speed / Core Web Vitals / technical health. |
| 70 | `technical_crawl` | Technical Crawl | no | Full crawl: errors, indexability, structure. |
| 80 | `keyword_research` | Keyword Research | no | Keyword + competitor research. |
| 90 | `metadata` | Metadata | no | Titles, meta descriptions, headings. |
| 100 | `content` | Content / Περιεχόμενο | no | Content enrichment + on-page. |
| 110 | `internal_links` | Internal Links | no | Internal linking structure. |
| 120 | `backlink_cleanup` | Backlink Cleanup | no | Backlink audit + disavow. |
| 130 | `blogs` | Blogs / Μπλογκ | no | Article production. |
| 140 | `results_review` | Results Review | no | Review via GSC + Semrush; iterate (loops back). |
| 150 | `stuck` | Stuck / Κολλημένο | no | Manually parked on a blocker. |
| 160 | `done` | Done / Ολοκληρώθηκε | **yes (`completed`)** | Project finished / subscription ended cleanly. |

No virtual Blocked column on Web SEO (blocked jobs show the 🔒 badge in place).

### 6.2 Local SEO board (`board='local_seo'`, realigned `20260610000002`)

| Pos | Code | EN / EL | Terminal | Meaning |
|---|---|---|---|---|
| 10 | `new_project` | New project / Νέο Έργο | no | Entry; open client file, contact for access. |
| 20 | `renewal` | Renewal / Ανανέωση | no | Re-subscribed client; cycle restarts. |
| 30 | `called_no_response` | Called/No response | no | Tried to reach client, no response. |
| 40 | `send_form` | Send form / Αποστολή Φόρμας | no | Send intake form; waits for return. |
| 50 | `optimize` | Optimize / Βελτιστοποίηση | no | Active GBP optimization (categories, photos, posts, citations/NAP, reviews). |
| 60 | `rank_tracking` | Rank tracking | no | Steady-state monitoring (recurring monthly work lives here). |
| 70 | `new_gbp` | New GBP / Νέο GBP | no | Create a profile from scratch. |
| 80 | `done` | Done / Ολοκληρωμένο | **yes (`completed`)** | Terminal. |
| 90 | `suspended` | Suspended / Σε Αναστολή | no | Google suspended the profile; work reinstatement. |
| 100 | `verification` | Verification / Επαλήθευση | no | Awaiting Google verification. |

**Virtual "Blocked" column** (Local SEO only): not a `pipeline_stages` row — `local_seo` is the only board in `BLOCKED_COLUMN_BOARDS`. Every `is_blocked` job is pulled out of its real stage into a read-only `__blocked__` column (`stage_id` unchanged, so it returns to its prior column on unblock). Blocked cards can't be dragged. Jobs get blocked by accounting (auto at Partial Payment, manual via Block) and unblock at Paid In Full.

### 6.3 AI SEO — coupling of Web SEO + Local SEO (no own board)
`ai_seo` was folded into Web SEO (`20260509000005`): its board archived, jobs migrated to same-code `web_seo` stages. AI SEO jobs remain a distinct `service_type` but live canonically on `web_seo` stages.
- **Canonical home**: `release_jobs_for_deal` resolves `ai_seo` → the `web_seo` board.
- **Appears on both boards**: `serviceTypesForBoard` returns `[serviceType, 'ai_seo']` for web_seo and local_seo.
- **Display mapping** (web_seo stage → local_seo column, only on the Local SEO board, `kanbanGrouping.ts:20–37`): the 11 work stages all collapse to `optimize`; `no_response→called_no_response`, `stuck→suspended`, else same code.
- **Drag-back mapping** (local_seo column → web_seo stage): `optimize→content`, `suspended→stuck`, `called_no_response→no_response`, else same; columns with no web_seo equivalent (`send_form`, `rank_tracking`, `new_gbp`, `verification`) → no-op. On the Web SEO board the column is used directly (no mapping).
- **Badge**: purple "AI SEO" pill.

### 6.4 Monthly recurring SEO workflow — now the Info tab, not a checklist
There used to be a `service_monthly_task_templates` checklist (web_seo: keyword review/backlink audit/publish article/ranking report; local_seo: GBP post/citation check/ask reviews/local report; ai_seo: prompt audit/citation check/visibility report). On **2026-06-15** (`20260615000005`) `jobs.details` (the Info tab) was added and the SEO templates were **emptied**. Because `MonthlyTasksPanel` only renders when the service has no Info fields, and all three SEO services have Info fields, the checklist **never shows** for SEO jobs — they use the **Info tab** instead. (`social_media`'s template is untouched and still active.)

So monthly SEO delivery is driven by **board movement + the Info tab**: Web SEO clients cycle through the technical/content stages (renewals re-enter at `renewal`, `results_review` loops back); Local SEO steady-state work lives in `rank_tracking` (`optimize` for active pushes, `renewal` for re-subscribed). Credentials, profile/report URLs, and per-period notes are recorded in `jobs.details`; shared report URLs + notes propagate to the deal overview.

---

## 7. Known gotchas & ambiguities (consolidated)

1. **Two date fields, different roles**: reminders key on `deal_payments.start_date`; overdue/renewal/next-due/on-hold key on `end_date`. For recurring rows they're a full period apart.
2. **`deal_payments.amount` is deprecated** — read `amount_gross`; slated to drop after 2026-07-01.
3. **Net basis** (since `20260616110538`): the entered service amount is NET; gross = net + VAT. A €500/mo Greek service bills €620.
4. **Frontend `defaultVatRate` ≠ DB VAT default** for non-Greece/non-Cyprus countries (UI = 0%, DB = 24%).
5. **Setup fees and web_dev installments are `one_time` rows** — never renew, don't affect job creation.
6. **`monthly_invoices` (Phase 5) is gone** — not live; don't reference it.
7. **No "Lock deal" button** — `useLockDeal` is unwired; the real sales→accounting transition is `convert_lead_to_client` (lead dragged to "won").
8. **No Social section on the deal page** — Instagram/Facebook/TikTok/LinkedIn live on the lead form only.
9. **No "complete job" RPC** — a job is completed by moving it into a terminal `completed` stage (stamps `completed_at`); the `jobs.status` enum is not written by tech UI.
10. **Block has two layers**: client-level `client_blocks` (blocks stage moves for all the client's jobs) and job-level `jobs.is_blocked` (auto at Partial Payment for non-web_dev; manual). The Block button UI gate uses group `accounting`, but the authoritative gate is the RPC's `accounting_onboarding:edit` check.
11. **AI SEO has no board** — it rides Web SEO (canonical) and Local SEO (mapped). Dropping an AI SEO card on a Local SEO column with no Web SEO equivalent is a no-op.
12. **`closed` vs `done`** on the accounting board: `done` archives the deal and sets client `done`; `closed` keeps it visible with no status change (for ClickUp imports).
13. **Dead code**: a vestigial `recurring_test_2min` branch remains in the auto-kanban trigger though the cadence/column/cron were removed.
14. **`jobs.service_type`/`billing_type` original CHECK constraints** were narrower than runtime values (`ai_seo`/`hosting`/`ads`, `recurring_yearly`); the explicit relaxing `ALTER` wasn't located in the read set — verify before relying on the constraint text.

---

*Generated 2026-06-17 from a parallel read-only investigation of the codebase. Every section is traceable to the cited `file:line`. If behavior seems to disagree with this document, trust the code and update this file.*
