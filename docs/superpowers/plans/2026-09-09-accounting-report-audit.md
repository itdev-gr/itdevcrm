# Accounting Report Full Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Επαληθεύουμε κάθε αριθμό και κάθε λογική του `/accounting/report` (P&L KPIs, YTD, τα δύο MRR, income/expense breakdowns, transaction drawer, export, period locks, client flow) απέναντι στην prod βάση, και παραδίδουμε findings report — ΟΧΙ διορθώσεις (τα fixes αποφασίζει ο owner ανά εύρημα).

**Architecture:** Read-only audit. Ένα .mjs runner script τρέχει όλα τα SQL cross-checks μέσω του Supabase Management API (project `xujlrclyzxrvxszepquy`) και τα συγκρίνει με ανεξάρτητες επανα-υπολογισμένες τιμές· τα frontend μαθηματικά ελέγχονται με code review + τα υπάρχοντα unit tests. Κάθε task γράφει τα ευρήματά του στο findings report.

**Tech Stack:** node .mjs (fetch, sbp token σε `sbp.token` δίπλα στο script — ΠΟΤΕ στο command line), υπάρχοντα Vitest tests, ανάγνωση migrations.

## Global Constraints

- **ΚΑΝΕΝΑ write στην prod.** Μόνο SELECT / πληροφοριακά queries. Το `lock/unlock` period ΔΕΝ δοκιμάζεται live — μόνο code review του guard.
- Token playbook: ο user κάνει paste `sbp_` token → Write σε `scratchpad/sbp.token` → direct `node` run (classifier: token ποτέ inline σε εντολή).
- Findings report: `docs/tech/accounting/report-audit-2026-09-09.md` — κάθε εύρημα με: τι δείχνει το UI, τι λέει η βάση, μέγεθος απόκλισης σε €, πρόταση, decision needed (Y/N).
- Χρονική βάση συγκρίσεων: Σεπτέμβριος 2026 (`2026-09-01`..`2026-09-30`), Αύγουστος 2026, και YTD (`2026-01-01`..`2026-12-31`), ώρα Ελλάδας όπου έχει σημασία.
- Πηγές αλήθειας: migrations `20260827150000_reporting_hardening.sql` (pl_summary_for_range + accounting_ledger_v), `20260827190000_accounting_period_locks.sql`, `20260909120000/130000` (client_flow), frontend `src/features/accounting_report/*`.
- Κάθε task: πρόσθεσε τα queries του στο runner, τρέξε, κατέγραψε — commit μόνο στο τέλος (Task 8) γιατί το παραδοτέο είναι ένα αρχείο.

---

### Task 1: Runner + Ledger view integrity (θεμέλιο όλων)

**Files:**
- Create: `<scratchpad>/report_audit.mjs` (runner με named queries, ίδιο σκελετό με το `deploy_client_flow.mjs` της 9/9: `q(label, sql)` + try/catch ανά query)
- Create: `docs/tech/accounting/report-audit-2026-09-09.md` (κενό skeleton με sections ανά task)
- Read: `supabase/migrations/20260827150000_reporting_hardening.sql`

**Interfaces:**
- Produces: το runner pattern και το findings αρχείο που χρησιμοποιούν ΟΛΑ τα επόμενα tasks. Κάθε επόμενο task προσθέτει queries στο ίδιο runner και τρέχει `node report_audit.mjs <taskN>` (arg φιλτράρει ποια labels τρέχουν).

- [ ] **Step 1: Γράψε το runner skeleton** — `q(label, sql)` POSTs στο `https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, headers `Authorization: Bearer <sbp.token>`, `User-Agent: supabase-cli/1.200.0`. `process.argv[2]` επιλέγει task group.
- [ ] **Step 2: Ζήτα από τον user το sbp token**, γράψτο με Write σε `sbp.token`.
- [ ] **Step 3: Έλεγχος πληρότητας ledger** — κάθε μη-cancelled deal_payment και κάθε expense εμφανίζεται ΜΙΑ φορά στο view:

```sql
-- (α) counts ανά πηγή
select 'view_dp' src, count(*) from accounting_ledger_v where source_table='deal_payments'
union all select 'raw_dp', count(*) from deal_payments where status in ('paid','pending','overdue')
union all select 'view_exp', count(*) from accounting_ledger_v where source_table='expenses'
union all select 'raw_exp', count(*) from expenses;
-- (β) διπλότυπα
select source_table, source_id, count(*) from accounting_ledger_v
 group by 1,2 having count(*) > 1 limit 20;
-- (γ) status mapping: πώς χαρτογραφείται το 'overdue' στο view; (το frontend ξέρει μόνο paid|pending)
select status, count(*) from accounting_ledger_v group by 1;
```

Αν το (α) δεν ισούται, βρες ποιες γραμμές λείπουν (`raw left join view on source_id`) και γράψε τες στο report. Στο (γ): αν υπάρχει τρίτο status που το UI αγνοεί σιωπηλά (το `LedgerRow.status` type έχει ΜΟΝΟ `'pending'|'paid'`), είναι εύρημα.
- [ ] **Step 4: event_date convention** — δείξε 10 paid rows όπου `paid_at::date <> start_date` και επιβεβαίωσε ότι το view διάλεξε `paid_at::date`· μέτρα και το UTC-vs-Athens effect:

```sql
select count(*) as boundary_rows, coalesce(sum(amount_gross),0) as eur
  from deal_payments where status='paid'
   and paid_at::date <> (paid_at at time zone 'Europe/Athens')::date;
```

Αν `boundary_rows > 0`: εύρημα «πληρωμές 00:00-03:00 ώρα Ελλάδας χρεώνονται στην προηγούμενη UTC μέρα» με το € μέγεθος (σοβαρό μόνο σε αλλαγή μήνα).
- [ ] **Step 5: Κατέγραψε Task 1 findings στο report αρχείο.**

### Task 2: P&L KPIs + YTD (pl_summary_for_range vs ανεξάρτητο SQL)

**Files:**
- Modify: `<scratchpad>/report_audit.mjs` (πρόσθεσε task2 queries)
- Read: `src/features/accounting_report/hooks/usePLSummary.ts`, `ReportPage.tsx:36-41`

**Interfaces:**
- Consumes: runner από Task 1.
- Produces: επιβεβαιωμένα (ή όχι) KPI νούμερα που το Task 6 (export) συγκρίνει.

- [ ] **Step 1: Για Σεπτέμβριο, Αύγουστο και YTD, τρέξε ΚΑΙ τα δύο:**

```sql
select * from pl_summary_for_range('2026-09-01','2026-09-30', false);
select * from pl_summary_for_range('2026-09-01','2026-09-30', true);
-- ανεξάρτητος επανυπολογισμός, ΧΩΡΙΣ το view:
select coalesce(sum(amount_net) filter (where status='paid'),0) income_net,
       coalesce(sum(vat_amount) filter (where status='paid'),0) income_vat
  from deal_payments
 where status <> 'cancelled'
   and coalesce(paid_at::date, start_date) between '2026-09-01' and '2026-09-30';
select status, coalesce(sum(amount_net),0), coalesce(sum(vat_amount),0)
  from expenses
 where coalesce(paid_date, due_date) between '2026-09-01' and '2026-09-30'  -- προσαρμόσου στο πραγματικό event_date του view για expenses (δες migration πριν τρέξεις)
 group by status;
```

(Πριν το τρέξεις, αντέγραψε την ΑΚΡΙΒΗ event_date έκφραση των expenses από το view definition στο 20260827150000 — μην τη μαντέψεις.)
- [ ] **Step 2: Σύγκρινε** income net/vat/gross, expense net/vat/gross (με και χωρίς pending), net profit = income − expense σε net ΚΑΙ gross. Απόκλιση > €0.01 = εύρημα με τις ακριβείς γραμμές που διαφέρουν.
- [ ] **Step 3: YTD strip** — το ReportPage περνά `rangeForPreset('this_year')` = `2026-01-01..2026-12-31` (ΟΛΟ το έτος, όχι «μέχρι σήμερα»). Επιβεβαίωσε με SQL αν υπάρχουν ΜΕΛΛΟΝΤΙΚΕΣ paid/pending γραμμές (event_date > σήμερα) που φουσκώνουν το «YTD»:

```sql
select count(*), coalesce(sum(amount_gross),0) from accounting_ledger_v
 where event_date > current_date and status in ('paid','pending');
```

Αν count>0 → εύρημα: το «Από αρχή έτους» περιέχει μελλοντικές εγγραφές (label vs σημασία).
- [ ] **Step 4: Κατέγραψε Task 2 findings.**

### Task 3: Τα δύο MRR

**Files:**
- Modify: `<scratchpad>/report_audit.mjs`
- Read: `src/features/accounting_report/hooks/useMRR.ts`, `useContractedMRR.ts`

**Interfaces:**
- Consumes: runner. Produces: MRR findings για το report.

- [ ] **Step 1: Collected MRR (useMRR)** — η υλοποίηση αθροίζει PAID recurring_monthly με **επικάλυψη περιόδου χρέωσης** (`start_date<=to AND end_date>=from`), ΟΧΙ με το πότε πληρώθηκε. Ποσοτικοποίησε τη διαφορά για Σεπτέμβριο:

```sql
-- όπως το UI (overlap χρεωστικής περιόδου)
select coalesce(sum(amount_gross),0) ui_way, count(*) from deal_payments
 where billing_type='recurring_monthly' and status='paid'
   and start_date <= '2026-09-30' and end_date >= '2026-09-01';
-- εναλλακτική ανάγνωση του «εισπράχθηκαν στην περίοδο» (paid_at μέσα στον μήνα)
select coalesce(sum(amount_gross),0) paid_at_way, count(*) from deal_payments
 where billing_type='recurring_monthly' and status='paid'
   and paid_at::date between '2026-09-01' and '2026-09-30';
-- ποιες γραμμές εξηγούν τη διαφορά (δείγμα 15)
select dp.amount_gross, dp.start_date, dp.end_date, dp.paid_at::date, d.code
  from deal_payments dp join deals d on d.id=dp.deal_id
 where dp.billing_type='recurring_monthly' and dp.status='paid'
   and (dp.start_date <= '2026-09-30' and dp.end_date >= '2026-09-01') <> (dp.paid_at::date between '2026-09-01' and '2026-09-30')
 limit 15;
```

Το hint του tile λέει «εισπράχθηκαν στην περίοδο» — αν οι δύο τρόποι αποκλίνουν σημαντικά, εύρημα + decision needed (ποιος ορισμός ισχύει). Σημείωσε επίσης ότι μετράει GROSS (με ΦΠΑ) ενώ τα άλλα KPIs δείχνουν και net.
- [ ] **Step 2: Contracted MRR (useContractedMRR)** — φίλτρα: `jobs.status='active' AND NOT archived AND billing_type<>'one_time' AND client not archived`. Ψάξε μολύνσεις:

```sql
-- (α) paused jobs που μετράνε (pause αφήνει status='active', billing_active=false)
select count(*), coalesce(sum(case when billing_type='recurring_yearly' then amount_net/12.0 else amount_net end),0)
  from jobs j join clients c on c.id=j.client_id
 where j.status='active' and not j.archived and j.billing_type<>'one_time' and not c.archived
   and not j.billing_active;
-- (β) awaiting_first_payment jobs που μετράνε (ποτέ δεν έχουν πληρώσει)
select count(*), coalesce(sum(case when billing_type='recurring_yearly' then amount_net/12.0 else amount_net end),0)
  from jobs j join clients c on c.id=j.client_id
 where j.status='active' and not j.archived and j.billing_type<>'one_time' and not c.archived
   and j.is_blocked and j.blocked_reason='awaiting_first_payment';
-- (γ) το ολικό, για ταύτιση με το tile
select coalesce(sum(case when billing_type='recurring_yearly' then amount_net/12.0 else amount_net end),0)
  from jobs j join clients c on c.id=j.client_id
 where j.status='active' and not j.archived and j.billing_type<>'one_time' and not c.archived;
```

(α)>0 ή (β)>0 = εύρημα με €/μήνα υπερεκτίμηση του «συμβολαιοποιημένου» MRR. Σημείωσε ότι είναι NET ενώ το collected είναι GROSS — αν μπαίνουν δίπλα-δίπλα στο ίδιο tile, mixed-basis εύρημα.
- [ ] **Step 3: Κατέγραψε Task 3 findings.**

### Task 4: Income & Expense breakdowns + Drawer

**Files:**
- Modify: `<scratchpad>/report_audit.mjs`
- Read: `src/features/accounting_report/components/IncomeBreakdown.tsx` (groupBy category_key, μόνο paid), `ExpenseBreakdown.tsx`, `TransactionDrawer.tsx`
- Test: υπάρχοντα `src/features/accounting_report/**/*.test.*` (τρέξε τα)

**Interfaces:**
- Consumes: runner· τα επιβεβαιωμένα ledger δεδομένα του Task 1.

- [ ] **Step 1: Income per service** — SQL αναπαραγωγή του component για Σεπτέμβριο:

```sql
select coalesce(category_key,'__unspecified') service, count(*), sum(amount_net), sum(vat_amount), sum(amount_gross)
  from accounting_ledger_v
 where direction='in' and status='paid' and event_date between '2026-09-01' and '2026-09-30'
 group by 1 order by sum(amount_gross) desc;
```

Σύγκρινε με το screenshot/live UI γραμμή-γραμμή (29 Local SEO / €5697.87 net / €1276.30 VAT / €6974.17 gross ήταν το χθεσινό δείγμα). Έλεγξε και ότι NULL category_key εμφανίζεται ως δική του γραμμή («unknown») και πόσα € είναι — αν είναι πολλά, εύρημα ταξινόμησης.
- [ ] **Step 2: Expenses per category** — ίδιο pattern με το πραγματικό grouping key του ExpenseBreakdown (διάβασε το component πρώτα — κατηγορία & pending toggle), SQL ανά κατηγορία, σύγκριση με UI.
- [ ] **Step 3: Drawer & totals** — τα header totals του drawer είναι client-side άθροισμα των rows της ομάδας (`sum()` στο TransactionDrawer): επιβεβαίωσε για μία ομάδα (Local SEO Σεπτεμβρίου) ότι transactions count = SQL count και net/vat/gross = SQL sums. Έλεγξε ότι ο κωδικός πελάτη εμφανίζεται (χθεσινό fix `e7f7010`) και ότι expenses drawer rows ανοίγουν το expense detail.
- [ ] **Step 4: `npm run test:run -- accounting_report`** — όλα πράσινα (frontend μαθηματικά καλύπτονται από τα unit tests). Failures = ευρήματα.
- [ ] **Step 5: Κατέγραψε Task 4 findings.**

### Task 5: Client flow section (χθεσινή δουλειά — αντίπαλος έλεγχος)

**Files:**
- Modify: `<scratchpad>/report_audit.mjs`
- Read: `supabase/migrations/20260909130000_client_flow_client_code.sql`

**Interfaces:** Consumes: runner.

- [ ] **Step 1: Boundary tests του RPC** — deal φτιαγμένο 31/8 ώρα 23:30 Ελλάδας (=20:30 UTC) ΔΕΝ πρέπει να μετρά στον Σεπτέμβριο· έλεγξε τις οριακές γραμμές:

```sql
select code, created_at, (created_at at time zone 'Europe/Athens')::date athens_day, created_at::date utc_day
  from deals
 where (created_at at time zone 'Europe/Athens')::date <> created_at::date
   and created_at >= '2026-08-01' order by created_at desc limit 10;
```
- [ ] **Step 2: Stopped-clients αντίστροφος έλεγχος** — κανείς «stopped Σεπτεμβρίου» δεν έχει ζωντανό job σήμερα, και κανείς με ζωντανό job δεν εμφανίζεται:

```sql
with flow as (select * from client_flow_for_range('2026-09-01','2026-09-30'))
select f.client_name, j.code, j.status, j.billing_active, j.archived
  from flow f join jobs j on j.client_id = f.client_id
 where f.kind='stopped_client' and j.status='active' and not j.archived and j.billing_active
 limit 20;  -- πρέπει: 0 γραμμές
```

(Σημ.: μέσω Management API το `auth.uid()` είναι NULL → το RPC γυρνά κενό· inline το σώμα του, όπως στο χθεσινό sanity script.)
- [ ] **Step 3: Renewata πληρότητα** — μέτρα και τους first-ever-paid Σεπτεμβρίου (νέοι πληρωτές) και δείξε ότι renewal + first-ever = σύνολο πελατών που πλήρωσαν μέσα στον μήνα.
- [ ] **Step 4: Κατέγραψε Task 5 findings.**

### Task 6: Export CSV/PDF & Period locks (code review + spot check)

**Files:**
- Read: `src/features/accounting_report/components/ExportMenu.tsx`, `PeriodLockControl.tsx`, `supabase/migrations/20260827190000_accounting_period_locks.sql`

**Interfaces:** Consumes: επιβεβαιωμένα KPI/breakdown νούμερα των Tasks 2/4.

- [ ] **Step 1: ExportMenu code review** — ο CSV/PDF παίρνει `summary`, `incomeRows`, `expenseRows` props (ίδια δεδομένα με την οθόνη). Έλεγξε: (α) περιλαμβάνει το includePendingExpenses καθεστώς σωστά στο label/γραμμές, (β) escaping σε ονόματα με κόμμα/εισαγωγικά στο CSV, (γ) τα totals στο export είναι recompute ή τα ίδια props (drift αδύνατο αν props).
- [ ] **Step 2: Period locks** — ΧΩΡΙΣ write: (α) `select * from accounting_period_locks order by period desc limit 6` — ποιοι μήνες κλειδωμένοι, (β) code review του `money_period_lock_guard` trigger από το migration: καλύπτει deal_payments ΚΑΙ expenses; ποια πεδία πυροδοτούν; (γ) επιβεβαίωσε ότι το guard κοιτά την ΙΔΙΑ event_date σύμβαση `coalesce(paid_at::date,start_date)` με το view (αν όχι → εύρημα: μπορεί να αλλάξει κλειδωμένος μήνας μέσω πεδίου που ο guard δεν βλέπει).
- [ ] **Step 3: Realtime invalidation spot** — `useExpensesRealtime`/`useDealPaymentsRealtime` κάνουν invalidate τα query keys του report· έλεγξε ότι καλύπτουν ΚΑΙ το νέο `accountingClientFlow` key ή σημείωσε ότι το client flow δεν κάνει auto-refresh σε αλλαγή πληρωμής (μικρό εύρημα, ίσως αποδεκτό).
- [ ] **Step 4: Κατέγραψε Task 6 findings.**

### Task 7: Οπτική επιβεβαίωση στο live site

**Files:** — (browser μόνο)

- [ ] **Step 1:** Με claude-in-chrome άνοιξε `https://www.itdevcrm.com/accounting/report` (ο user είναι ήδη logged-in admin). Πάρε screenshot: KPIs, YTD, breakdowns, client flow Σεπτεμβρίου.
- [ ] **Step 2:** Σύγκρινε ΚΑΘΕ ορατό νούμερο με τις SQL τιμές των Tasks 2-5 (πίνακας UI vs DB στο report). This-month στο UI = `2026-09-01..2026-09-30` — ταυτόσημο range με τα SQL.
- [ ] **Step 3:** Άνοιξε ένα drawer (Local SEO) και το client flow expand — έλεγξε counts, κωδικούς, links.
- [ ] **Step 4: Κατέγραψε Task 7 αποτελέσματα (UI vs DB πίνακας).**

### Task 8: Findings report finalize + παράδοση

**Files:**
- Modify: `docs/tech/accounting/report-audit-2026-09-09.md`

- [ ] **Step 1:** Ταξινόμησε ευρήματα: 🔴 λάθος νούμερο στην οθόνη / 🟡 σωστό νούμερο, παραπλανητικό label ή ορισμός / 🟢 verified σωστό. Κάθε section της σελίδας πρέπει να έχει ρητό verdict — και τα «όλα σωστά» γράφονται.
- [ ] **Step 2:** Λίστα «Owner decisions needed» (π.χ. ορισμός collected MRR, paused jobs στο contracted MRR).
- [ ] **Step 3:** `git add docs/tech/accounting/report-audit-2026-09-09.md docs/superpowers/plans/2026-09-09-accounting-report-audit.md && git commit` (μήνυμα: `docs(accounting): full report-page audit 2026-09-09`). Σβήσε το `sbp.token`.
- [ ] **Step 4:** Σύνοψη στον owner στη γλώσσα του: τι είναι 100% σωστό, τι όχι, τι περιμένει απόφαση.
