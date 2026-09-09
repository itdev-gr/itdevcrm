# Accounting report page audit — 2026-09-09

Plan: `docs/superpowers/plans/2026-09-09-accounting-report-audit.md`. Read-only
audit of `/accounting/report` (P&L KPIs, YTD, the two MRR tiles, income/expense
breakdowns, transaction drawer, export, period locks, client flow) against
prod (`xujlrclyzxrvxszepquy`), run via the Supabase Management API
(`database/query`, SELECT-only) using `<scratchpad>/report_audit.mjs`.

Finding format: what the UI shows / what the DB says / € size / suggestion /
decision needed (Y|N). Verified-correct results are recorded explicitly (🟢).
Legend: 🔴 wrong number on screen, or a figure that is materially
misleading versus its own caption even when the arithmetic behind it is
intentional (this is why 3a scores 🔴) · 🟡 correct number, misleading label
or definition · 🟢 verified correct.

---

## Περίληψη για τον owner (τελικοποιήθηκε 2026-09-09, Task 8)

Έλεγχος όλης της σελίδας `/accounting/report` — κάθε αριθμός στην οθόνη
ξαναϋπολογίστηκε ανεξάρτητα απευθείας πάνω στη βάση παραγωγής (όχι σε
staging/δείγμα). Live επιβεβαίωση έγινε και στην ίδια τη σελίδα (Task 7):
**0 αριθμοί βρέθηκαν λάθος στην οθόνη σήμερα** — τα δύο πραγματικά
προβλήματα είναι **ορισμός/ετικέτα**, όχι αριθμητικό σφάλμα, εκτός από ένα
component bug (ExpenseBreakdown) που κρύβει σωστά δεδομένα.

### Verdict ανά περιοχή σελίδας

| # | Περιοχή | Verdict | Σύνοψη |
|---|---|---|---|
| 1 | **Θεμέλιο ledger** (`accounting_ledger_v`) | 🟡 | Η όψη είναι πλήρης, χωρίς διπλότυπα ή χαμένες γραμμές· κάθε καταναλωτής (KPI, export, dashboard) φιλτράρει σωστά το status. Ένα υποβόσκον, μη-ενεργό ρίσκο ζώνης ώρας (UTC vs Αθήνα) στο όριο μήνα — **€124,00 σήμερα, 0 μήνες λάθος μέχρι στιγμής** — εκκρεμεί απόφαση (βλ. απόφαση 8). |
| 2 | **KPI P&L** (έσοδα/έξοδα/καθαρό κέρδος) | 🟢 | Ακριβή στο λεπτό έναντι ανεξάρτητου υπολογισμού, σε 6 συνδυασμούς (3 περίοδοι × 2 καταστάσεις toggle). Καμία απόκλιση. |
| 3 | **Λωρίδα YTD** ("Από αρχή έτους") | 🟡 | Η ετικέτα λέει "από αρχή έτους" αλλά η περίοδος που πραγματικά τραβάει είναι **όλος** ο ημερολογιακός χρόνος (έως 31/12), όχι έως σήμερα. **€0–57,00 ζωντανή επίδραση σήμερα** (ανάλογα με το toggle εκκρεμών εξόδων)· **€9.011,21 σε εκκρεμή μελλοντικά έσοδα** «κάθονται» μέσα στο παράθυρο αλλά δεν μπαίνουν σήμερα στο άθροισμα (paid-only φίλτρο). |
| 4 | **Collected MRR** (λεζάντα "εισπράχθηκαν στην περίοδο") | 🔴 | Ο αριθμός δεν είναι αυτό που λέει η λεζάντα του — υπολογίζει επικάλυψη περιόδου χρέωσης, όχι πραγματικές εισπράξεις. Σε κλεισμένους μήνες: **42–53% υπερεκτίμηση** (Αύγουστος: **€122.051,83** στην οθόνη έναντι **€57.177,40** που πραγματικά εισπράχθηκαν). |
| 5 | **Contracted MRR** (κεντρικός/μεγάλος αριθμός) | 🟡 | Μετράει και jobs σε παύση/hold χρέωσης: **€8.746–10.109/μήνα** από το σύνολο **€59.984,81** (14,6–16,9%). Επιπλέον, το ίδιο πλακίδιο δείχνει NET αριθμό (κεντρικό) δίπλα σε GROSS αριθμό (λεζάντα) χωρίς καμία ένδειξη βάσης. `awaiting_first_payment` jobs δεν μολύνουν τον αριθμό (€0,00, verified). |
| 6 | **Ανάλυση εσόδων** (ανά υπηρεσία) | 🟢 | Ομαδοποίηση, φίλτρα, ταξινόμηση, χειρισμός κενής κατηγορίας και το πρόθεμα κωδικού συμφωνίας ελέγχθηκαν πλήρως έναντι SQL — καμία απόκλιση. |
| 7 | **Ανάλυση εξόδων** (ανά κατηγορία) | 🔴 | Bug: ο πίνακας αγνοεί το κουτάκι "συμπερίληψη εκκρεμών εξόδων" — δείχνει πάντα μόνο τα πληρωμένα, ενώ τα KPI πλακίδια και οι εξαγωγές CSV/PDF σέβονται σωστά το ίδιο κουτάκι. **€288,00 (4 γραμμές)** αποκρύπτονται σήμερα (Σεπτέμβριος), χωρίς καμία ένδειξη στην οθόνη ότι λείπουν. |
| 8 | **Συρτάρι συναλλαγών** (transaction drawer) | 🟢 | Τα αθροίσματα, ο αριθμός γραμμών και το πρόθεμα κωδικού συμφωνίας ελέγχθηκαν πλήρως — καμία απόκλιση. |
| 9 | **Εξαγωγή CSV/PDF** | 🟢 | Και οι δύο εξαγωγές σέβονται σωστά το κουτάκι εκκρεμών εξόδων (ακόμα κι όταν ο πίνακας στην οθόνη δεν το κάνει)· το CSV escaping ελέγχθηκε έναντι πραγματικών «επικίνδυνων» ονομάτων πελατών· το PDF έχει δικό του, ανεξάρτητο έλεγχο admin. Καμία απόκλιση/κίνδυνος. |
| 10 | **Κλειδώματα περιόδου** | 🟢 | Πλήρως θωρακισμένα από τις 28/8/2026 — μπλοκάρουν πληρωμένο χρήμα να μπει, να φύγει ή να αλλάξει μέσα σε κλειδωμένο μήνα, σε INSERT/UPDATE/DELETE. Επιβεβαιώθηκε ζωντανά στην prod (4/4 triggers ενεργά). Μια αρχική εκτίμηση ότι υπήρχε κενό ανακλήθηκε — ήταν ήδη διορθωμένο. |
| 11 | **Ροή πελατών** (Client Flow) | 🟢 | Οι μετρήσεις new_deal/stopped_client/renewal_client υπολογίζονται σωστά — επαληθεύτηκε με ανεξάρτητα ίχνη (σχόλια/ειδοποιήσεις), όχι μόνο αντιγραφή της ίδιας λογικής. Το άλμα 3→44 σε "clients stopped" εξηγείται πλήρως (ένα πραγματικό μαζικό batch στις 8/9). Μία τεκμηριωμένη προσέγγιση (βλ. απόφαση 6 παρακάτω) παραμένει ανοιχτή ως θέμα ακρίβειας, όχι bug. |
| 12 | **Realtime ανανέωση** | 🟡 | Το tab "Ροή πελατών" **δεν** ανανεώνεται αυτόματα όταν αλλάζει πληρωμή/έξοδο — μόνο με χειροκίνητο reload. Επιπλέον, η λίστα ανανέωσης των εξόδων είναι πιο στενή από των πληρωμών (λείπουν MRR + 2 κλειδιά dashboard). Καμία € επίδραση, μόνο staleness στην οθόνη. |

### Αποφάσεις για τον owner

Ενοποιημένη, χωρίς επαναλήψεις λίστα από όλα τα tasks — ερώτημα, € επίδραση,
σύσταση του audit.

1. **Ορισμός/λεζάντα Collected MRR.** Η λεζάντα λέει "εισπράχθηκαν στην
   περίοδο" αλλά ο αριθμός είναι επικάλυψη περιόδου χρέωσης, όχι
   πραγματικές εισπράξεις. **€ επίδραση:** 42–53% υπερεκτίμηση σε κλεισμένους
   μήνες (Αύγουστος: **€122.051,83** στην οθόνη έναντι **€57.177,40** που
   πραγματικά εισπράχθηκαν· Ιούλιος: παρόμοιο, 42,8%). **Σύσταση:** είτε (α)
   άλλαξε τον υπολογισμό ώστε να ταιριάζει με τη λεζάντα (`paid_at` μέσα στην
   περίοδο), είτε (β) κράτα τον σημερινό ορισμό (είναι έγκυρη μετρική
   "τζίρος περιόδου χρέωσης") αλλά άλλαξε τη λεζάντα ώστε να μην λέει
   "εισπράχθηκαν".
2. **Contracted MRR μετράει jobs σε παύση/hold + μπερδεμένη βάση
   (NET/GROSS) στο ίδιο πλακίδιο.** **€ επίδραση:** €8.746–10.109/μήνα
   (14,6–16,9%) από το σύνολο €59.984,81, ανάλογα με το ποιο σήμα
   (`billing_active` ή `is_blocked`) χρησιμοποιηθεί για τον αποκλεισμό.
   **Σύσταση:** επιβεβαίωσε αν το "contracted" πρέπει να περιλαμβάνει jobs
   σε παύση/hold (τότε είναι θέμα τεκμηρίωσης μόνο) ή όχι (τότε χρειάζεται
   ένα επιπλέον φίλτρο στο `useContractedMRR.ts`)· ξεχωριστά, βάλε ετικέτες
   "(NET)"/"(GROSS)" στους δύο αριθμούς του πλακιδίου ή ενοποίησέ τους στην
   ίδια βάση.
3. **Bug: το ExpenseBreakdown δεν σέβεται το κουτάκι εκκρεμών εξόδων.** Το
   component ξαναφιλτράρει τις γραμμές με σκληρό-κωδικοποιημένο
   `status==='paid'`, αγνοώντας τις γραμμές που το `ReportPage` του έχει
   ήδη δώσει σωστά φιλτραρισμένες με βάση το κουτάκι. **€ επίδραση:**
   **€288,00 (4 γραμμές)** για τον Σεπτέμβριο, χωρίς ένδειξη στην οθόνη ότι
   κάτι λείπει· το ποσό μεγαλώνει όσο συσσωρεύονται εκκρεμή έξοδα. **Σύσταση
   (διόρθωση, όχι μόνο απόφαση):** αφαίρεσε το μισό `status !== 'paid'` του
   guard στο `ExpenseBreakdown.tsx`'s `groups` `useMemo` (γραμμή 54) —
   ΚΡΑΤΑ το άλλο μισό, `direction !== 'out'`, όπως είναι.
4. **Ετικέτα YTD vs εύρος ολόκληρου έτους.** Η λωρίδα YTD λέει "από αρχή
   έτους" αλλά τραβάει όλο το 2026 (έως 31/12), όχι μέχρι σήμερα.
   **€ επίδραση:** €0,00 με το κουτάκι εκκρεμών εξόδων off (προεπιλογή),
   **€57,00** με το κουτάκι on· **€9.011,21** σε εκκρεμή μελλοντικά έσοδα
   κάθονται μέσα στο παράθυρο αλλά δεν μπαίνουν σήμερα στο άθροισμα (μόνο
   πληρωμένα έσοδα μετρούν) — θα γινόταν πραγματικό πρόβλημα μόνο αν αλλάξει
   ποτέ το φίλτρο εσόδων ώστε να μετράει και εκκρεμή. **Σύσταση:** είτε (α)
   κάνε το εύρος πραγματικά "μέχρι σήμερα" (`{from: 1/1, to: σήμερα}`), είτε
   (β) αν θέλεις τον αριθμό ολόκληρου έτους, άλλαξε την ετικέτα (π.χ. "Έτος
   2026") ώστε να μην διαβάζεται σαν "μέχρι τώρα".
5. **Η "Ροή πελατών" δεν ανανεώνεται live.** Καμία από τις δύο realtime
   συνδρομές (πληρωμών, εξόδων) ούτε ο κοινός invalidation helper
   ανανεώνει το tile "Ροή πελατών" όταν αλλάζει πληρωμή/έξοδο/deal· χρειάζεται
   χειροκίνητο reload. Επιπλέον, η λίστα ανανέωσης των εξόδων είναι πιο
   στενή από των πληρωμών (λείπουν το MRR key και τα 2 κλειδιά dashboard).
   **€ επίδραση:** καμία — μόνο staleness στην οθόνη. **Σύσταση:** πρόσθεσε
   το `accountingClientFlow` key στη λίστα invalidation και ευθυγράμμισε τη
   λίστα των εξόδων με των πληρωμών — μικρή, χαμηλού ρίσκου αλλαγή.
6. **Προσέγγιση στο "clients stopped" όταν ένα job σέρνεται σε "Closed"
   πριν το πάτημα του End (drag-then-End).** Η μετρική αποδίδει την
   απώλεια πελάτη στον μήνα του End-πατήματος, όχι στον μήνα που το job
   μπήκε ουσιαστικά σε "Closed" — τεκμηριωμένη, γνωστή συμπεριφορά του
   migration, όχι bug. **Μέγεθος:** **12 από τους 61** υποψήφιους
   end-πελάτες του Σεπτεμβρίου (≈20%) πέφτουν σε αυτή την κατηγορία.
   **Σύσταση:** αποδέξου το ως τεκμηριωμένη προσέγγιση (καμία αλλαγή) ή, αν
   θέλεις ακριβέστερη απόδοση μήνα, βελτίωσε τη μετρική ώστε να πιάνει την
   ημερομηνία που το job μπήκε σε "Closed" αντί του End-πατήματος.
7. **Προαιρετική θωράκιση της όψης ledger (defense-in-depth, Task 1).**
   Το `accounting_ledger_v` δεν φιλτράρει το status στο επίπεδο της όψης —
   κάθε σημερινός καταναλωτής φιλτράρει σωστά μόνος του, οπότε **δεν
   υπάρχει σημερινή € επίδραση**· μόνο ρίσκο αν προστεθεί μελλοντικά νέος
   καταναλωτής που ξεχάσει να φιλτράρει (π.χ. 134 ακυρωμένες γραμμές /
   €38.617,41 κάθονται σήμερα «αόρατες» μέσα στην όψη, σωστά αγνοημένες
   παντού όπου διαβάζονται). **Σύσταση:** προαιρετικό migration — πρόσθεσε
   `where status <> 'cancelled'` στο σκέλος `deal_payments` της όψης, ή/και
   διόρθωσε τον TS τύπο `LedgerRow.status` ώστε να περιλαμβάνει
   `'overdue'`/`'cancelled'`. Χαμηλή προτεραιότητα — μηδενική σημερινή
   επίδραση.
8. **UTC vs Αθήνα στο `paid_at::date` της όψης ledger (μηνιαία απόδοση).**
   Η όψη αποδίδει κάθε πληρωμή στον μήνα με βάση `paid_at::date` σε UTC, όχι
   σε τοπική ώρα Αθήνας — μία πληρωμή στις 2026-08-27 21:37 UTC (=
   2026-08-28 00:37 Αθήνα) αποδίδεται σήμερα στις 27/8 αντί 28/8· τυχαία και
   οι δύο ημερομηνίες πέφτουν στον ίδιο μήνα, οπότε καμία μηνιαία απόδοση
   δεν έχει αλλάξει μέχρι στιγμής. **€ επίδραση:** €124,00 σήμερα, σε 1
   γραμμή· καμία μηνιαία απόκλιση έχει καταγραφεί ακόμα, αλλά ο κίνδυνος
   είναι δομικός — μια πληρωμή που μπαίνει «paid» τις τελευταίες ώρες UTC
   της τελευταίας ημέρας ενός μήνα θα μπορούσε να προσγειωθεί στον *επόμενο*
   μήνα κατά UTC ενώ κατά ώρα Αθήνας ανήκει ακόμα στον προηγούμενο, δηλαδή
   λάθος μήνας σε P&L/MRR. **Σύσταση:** αν η μηνιαία απόδοση κατά τοπική ώρα
   Αθήνας έχει σημασία, άλλαξε την έκφραση `event_date` της όψης σε
   `(paid_at at time zone 'Europe/Athens')::date` — αυτό αλλάζει ιστορική
   απόδοση περιόδου για κάθε γραμμή που βρίσκεται στο όριο, όχι μόνο τις
   μελλοντικές, άρα χρειάζεται ρητό migration + μονομιάς before/after diff,
   όχι σιωπηλή αλλαγή.

---

## Task 1: Runner + ledger view integrity

*(filled in below)*

## Task 2: P&L KPIs + YTD

*(filled in below)*

## Task 3: The two MRR tiles

Collected MRR (`useMRR`) is computed as billing-period overlap, not
`paid_at` in range, despite the tile caption literally saying "collected in
the period" — on completed months this overstates by **42–53%** (Aug 2026:
€64,874.43/53.2%; Jul 2026: €51,959.50/42.8%); the report's default range,
September 2026, is a partial in-progress month and shows a larger 77%/
€54,960.48 gap that will shrink but not close as the month completes (🔴,
decision needed). Contracted MRR (`useContractedMRR`) counts paused/held
jobs (`billing_active=false` and/or `is_blocked` account_on_hold/
billing_paused) — €8,746–10,109/mo of the €59,984.81 total (🟡, decision
needed); does **not** count `awaiting_first_payment` jobs (🟢). The single
tile also mixes NET (contracted, headline) with GROSS (collected, caption)
with no basis label (🟡, decision needed). Full detail: `Task 3` section
below.

## Task 4: Income & expense breakdowns + drawer

Income breakdown, drawer sums, and the `e7f7010` `deal_code` prefix all
verified correct against SQL (🟢). Expense breakdown's own grouping filter
hard-codes `status==='paid'`, silently ignoring the already-toggled
`includePendingExpenses` rows `ReportPage` hands it — the KPI tiles and
CSV/PDF export correctly honor the toggle, this one table does not (🔴,
€288.00/4 rows for September, decision needed). The ledger view's expense
arm INNER JOINs `expense_categories`, so a NULL `category_id` would silently
drop the whole row from the view rather than surface as "unknown" like
income does — currently schema-impossible (`category_id` is NOT NULL) and
0 rows affected, so no action needed (🟢). All 25 `accounting_report` test
files / 103 tests pass. Full detail: `Task 4` section below.

## Task 5: Client flow section

`client_flow_for_range` (v2, `20260909130000_client_flow_client_code.sql`,
shipped yesterday) re-checked against its own owner-approved definitions —
**round 1, a fix round after task review rejected round 1's rigor on 6
points, then a second fix round after re-review found the fix round's
CRITICAL 1 response still not actually closed** (not the RPC itself — no
live bug was proven either way in any round). September 2026 kind counts,
**partial month in progress (today is 2026-09-09), will still move**:
new_deal 4, stopped_client 44, renewal_client 52 (+5 first-ever payers,
not their own tile) — the renewal figure alone moved 50→52 between this
morning's ship-day check and this run, reconciled below to specific
payments touched intraday, not a bug. `new_deal`/`stopped_client` bucket
Athens-local, `renewal_client` deliberately uses the *raw*
`coalesce(paid_at::date, start_date)` basis (matches the definition text
verbatim, not a bug) — a direct row-level search for real UTC-vs-Athens
midnight-crossing rows at both month edges found **zero** in the current
data, so the timezone conversion itself is verified **structurally only**,
not against a live crossing case (🟢, with that caveat now explicit). The
round-1 "independent" `stopped_client` re-derivation was rejected because
it copied the migration's ended-condition character-for-character; redone
from a genuinely separate evidence trail — `comments`/`notifications`
written by `end_and_archive_job` (`20260904200000`) for the new End era,
and `pipeline_stages` position for the old `end_job` era, which writes no
audit trail at all — but the *first* fix-round pass still only asserted
its arithmetic from a non-mutually-exclusive count query (47+14=61≠60)
and misidentified one worked example (`Apex Exclusive Services`, whose job
actually matches September, not a drag-then-End case). **Closed properly
in round 2** with one real, mutually-exclusive, per-client reconciliation
query: of the **61**-client candidate pool, **44** are in the RPC's
`stopped_client` output (independently matching the RPC's own count), **5**
are excluded by the "no other open job" clause (each blocking job named —
not 4, as first asserted), **12** are drag-then-End cases (not 13; each
verified individually, `CANTIN CENTER Ε.Ε.` — not Apex — as the confirmed
worked example), and **0** are unexplained (🟢, no bug, both the caveat and
its exact size now proven, not asserted). The 3→44 stopped-client jump is
fully explained: 2026-09-08 was a real, one-day mass End batch (124
`job_archived` comments that month, 122 of them on the 8th alone) tied to
the local_seo disconnect-deferral rollout (`20260908120000`, shipped the
same day) — 40 of the 44 stopped clients are exactly that batch (🟢,
informational for Task 7, not a bug). The stopped-clients reverse check is
relabeled honestly: it can catch gross transcription errors (comparing
today's snapshot to itself) but cannot certify business-definition
correctness or true month-end state. No bugs found in any round; no
decisions needed on correctness — the drag-then-End 12/61 divergence is not
a bug, but the month-attribution accuracy choice it represents is a real,
open question, surfaced separately as decision 6 in the consolidated list.
Full detail: `Task 5` section below.

## Task 6: Export CSV/PDF & period locks

CSV/PDF export verified clean: both correctly honor
`includePendingExpenses` (CSV inherits `ReportPage`'s already-filtered
`expenseRows`; PDF independently re-derives the identical paid+pending
rule server-side from its own `includePending` query param); CSV escaping
(`/[",\n]/`, quote-doubling) is correct and was checked against real
prod client names containing commas (e.g. "ΠΟΛΙΤΙΚΟΣ ΜΗΧΑΝΙΚΟΣ, CIVIL
ENGINEERING") — one theoretical gap (a bare `\r` without `\n` isn't
quoted) has zero live instances in current data; amounts are plain JS
numbers (never locale-formatted with a decimal comma), so no CSV-column
corruption risk; `api/report-pdf.ts` has a real, explicit admin gate
(bearer-token auth + `profiles.is_admin` check against the service-role
client, independent of RLS) — no anonymous or non-admin access; PDF
totals are independently recomputed server-side from a fresh paged fetch
of `accounting_ledger_v` (never trust client props), CSV carries no
totals row at all — zero drift risk in either export (🟢, no decision
needed). Period locks: 3 months currently locked (2025-09, -10, -11 —
the latter two locked this morning, 2026-09-09, unrelated to this
read-only audit); the `money_period_lock_guard` trigger's
`coalesce(paid_at::date, start_date)` period convention textually
matches `accounting_ledger_v`'s own definition, and its guarded-field
list is complete (`vat_amount`/`amount_gross` are `GENERATED ALWAYS`
from `amount_net`/`vat_rate`, both already guarded). **Correction (this
finding was wrong in the first pass of this section and has been
rewritten):** the guard was NOT directionally asymmetric at the time of
this audit — round 1 characterized it off the single migration the brief
named (`20260827190000`) and never checked for a later migration that
touched the same function. `20260828120000_lock_guard_hardening.sql`
(shipped the very next day, 2026-08-28, already covered elsewhere in this
audit's own program history) rewrote `money_period_lock_guard()` to add
a `BEFORE INSERT` arm on both tables and a both-sides
(`v_old_locked or v_new_locked`) check on UPDATE, closing exactly the
three paths round 1 flagged. Verified live on prod, not just re-read from
the migration file: `pg_trigger` shows all 4 expected triggers present
and enabled (`deal_payments_period_lock_ins_trg` / `expenses_period_lock_
ins_trg`, BEFORE INSERT; `deal_payments_period_lock_trg` /
`expenses_period_lock_trg`, BEFORE UPDATE OR DELETE), and
`md5(pg_get_functiondef('money_period_lock_guard()'))` on prod is
`8e0e2f5d0d2bd1fc3bbba4e675f5be0e` — the exact post-hardening value
`financial-controls.md` already documents. No migration after
`20260828120000` touches the guard. The "0 rows created after lock" spot
-check from round 1 most likely shows the INSERT trigger *working*, not
an unexploited gap — the guard as it has stood since 2026-08-28 is:
**no paid money enters, leaves, or changes in a locked month**, on all
three directions (🟢, no decision needed — already hardened, nothing to
do). Realtime: confirmed `accountingClientFlow` is not in either
`useExpensesRealtime`'s inline invalidation list or
`useDealPaymentsRealtime`'s shared `FINANCIAL_REPORT_KEYS` — the Client
Flow tab does not auto-refresh on payment/expense changes (🟡, minor,
decision needed); also noticed in passing that `useExpensesRealtime`'s
own inline list is narrower than the shared helper `deal_payments`
realtime uses, missing `accounting-mrr` and both dashboard keys (🟡,
minor, decision needed). Full detail: `Task 6` section below.

## Task 7: Live-site visual confirmation

Live browser pass on `https://www.itdevcrm.com/accounting/report` (admin,
already logged in), September 2026 (the page's own "This month" default),
each on-screen number re-checked against a fresh SQL re-run (`node
report_audit.mjs task2/task3/task4/task5`) taken within seconds of the
matching screenshot, not against the earlier tasks' now-stale snapshots.
**Every single number checked matched its fresh SQL exactly — 0 mismatches,
0 new findings.** Both previously-recorded issues were visually
reconfirmed live: the expense-breakdown pending-toggle gap (4b) — toggling
"Include unpaid expenses" on moved the expense KPI tile from €9626.54 to
€9914.54 (matches `pl_summary_for_range(...,true)` exactly) while the
"Expenses by category" table stayed frozen at the paid-only €9626.54
breakdown, byte-identical before and after the toggle — and the MRR tile's
mixed caption (3a/3d): headline €59984.81 (contracted, ties to
`useContractedMRR`'s live total) sits beside "€71511.66 collected in
period" (ties to `useMRR`'s billing-overlap query, not `paid_at`-in-range).
Client Flow's September tile counts (new deals 4, clients stopped 44,
renewals 52) matched Task 5's reconciled figures exactly, and the expanded
"New deals" list rows are real clickable deal links (verified by clicking
`006258 ΙΚΟΥΤΑΣ ΒΑΣΙΛΕΙΟΣ`, which navigated to
`/deals/940628a3-bce8-4e18-90be-68b78aedb601`) while "Clients stopped"
rows carry client codes but are not links — expected, since `stopped_
client` is grouped by `client_id` with no `deal_id`, unlike `new_deal`.
Period lock control is visible and correct for an admin (Sept 2025/Oct
2025/Nov 2025 show "Locked"/Unlock, all other months "Open"/Lock,
matching Task 6's fresh read) — no lock/unlock button was ever pressed.
**Fix round (post-review, read-only, no browser reopened):** task review
found the "Clients stopped" claim above had zero SQL backing (the only
query that could have supported it truncated before reaching any
`stopped_client` row) — closed with a fresh, narrow, un-truncated query;
all 10 screen-recorded rows, including the one distinct date, matched
exactly. Also closed: 2 truncated raw logs now disclosed and superseded,
a Renewals row-level spot check added (with an honest "aggregate-only,
no screen counterpart" label, since that tile was never expanded live), and
the toggle-ON comparison's ~2-minute timing gap empirically closed by a
13-minute-later re-run showing the relevant (expense) figures unchanged
throughout. 0 new bugs surfaced; one ordinary same-day payment (+€220)
landed after the pass's comparisons had already matched, unrelated to any
finding. Full detail, every screenshot, every fresh-SQL figure: `Task 7`
section below.

## Task 8: Owner decisions needed (finalized at the end of the audit)

Finalized 2026-09-09. See **«Περίληψη για τον owner»** at the very top of
this document (right after the legend) for the per-area verdict table (12
page areas) and the full, deduplicated, numbered **«Αποφάσεις για τον
owner»** list (7 decisions, each with the question, € impact, and the
audit's recommendation) — kept in one place only, so this section and the
top summary can't drift apart. No new findings originate here; this task
consolidated and cross-checked what Tasks 1–7 already established.

---

<!-- ============================== TASK 1 ============================== -->

## Task 1 — Runner + ledger view integrity

Run 2026-09-09 against prod via `report_audit.mjs task1`, read-only
(`assertReadOnly` in the runner refuses any query that isn't a bare
`SELECT`/`WITH`/`EXPLAIN`/`TABLE` or contains a write/DDL keyword). View
source read from `supabase/migrations/20260827150000_reporting_hardening.sql`
before writing any query — column names and the `event_date` expression are
exact, not guessed.

### 1a — Ledger completeness (deal_payments)

- **What the UI would show:** `useLedger` reads `accounting_ledger_v` with no
  status filter at the query layer; `LedgerRow.status` is typed
  `'pending' | 'paid'` only.
- **What the DB says:** `accounting_ledger_v` has **no `WHERE status = ...`
  clause on either arm** — confirmed by reading the view body in
  `20260827150000_reporting_hardening.sql` and by counts:
  - `view` rows with `source_table='deal_payments'`: **1294**
  - raw `deal_payments` with `status in ('paid','pending','overdue')`: **1160**
  - the 134-row gap = exactly the raw `cancelled` count (134). Confirmed by
    splitting the view's own status column by `source_table`: `deal_payments`
    arm = 994 paid + 81 pending + 85 overdue + **134 cancelled**, summing to
    1294 — i.e. every raw row (all 4 statuses) reaches the view untouched,
    nothing is missing and nothing is duplicated (0 duplicate
    `(source_table, source_id)` pairs; the `raw LEFT JOIN view` completeness
    check returned 0 missing rows for both `deal_payments` and `expenses`).
- **€ size:** cancelled deal_payments sitting in the view: **134 rows /
  €38,617.41 gross**. `overdue` deal_payments also sit in the view (a status
  the frontend TS type doesn't declare): **85 rows**.
- **This is pre-existing, already-documented behavior, not a new bug.** The
  2026-08-27 audit (`docs/system-analysis/2026-08-27-expenses-reporting-audit-findings.md`,
  finding E1) established the same thing: `accounting_ledger_v` is
  deliberately unfiltered by status; filtering to realized money is the
  caller's job. `docs/tech/accounting/reporting.md` documents the accepted
  rule downstream (`pl_summary_for_range`: income = paid only, expenses =
  paid + opt-in pending). I checked **all 4 current consumers of the raw
  view/its aggregate sibling** myself (code read + one live view-definition
  pull, not taken on trust) and every one of them filters status correctly,
  so the leak is fully mitigated everywhere it's read today:

  | # | Consumer | Reads | How it filters |
  |---|---|---|---|
  | 1 | `src/features/accounting_report/ReportPage.tsx:44-56` | `accounting_ledger_v` via `useLedger` (client-side `.select('*')`, no status filter in the query) | `incomeRows` = `.filter(r => r.direction==='in' && r.status==='paid')`; `expenseRows` = `.filter(r => r.direction==='out' && (r.status==='paid' \|\| (includePendingExpenses && r.status==='pending')))`. `TransactionDrawer` and `ExportMenu` only ever receive these two pre-filtered arrays, never the raw ledger rows. |
  | 2 | `pl_summary_for_range()` SQL function (`20260827150000_reporting_hardening.sql`) — the P&L RPC behind `usePLSummary` | `accounting_ledger_v` (no status filter in its own `WHERE`) | Every aggregate column has an explicit `FILTER (WHERE direction='in' AND status='paid')` (income) or `FILTER (WHERE direction='out' AND (status='paid' OR (p_include_pending_expenses AND status='pending')))` (expenses) — filtering happens inside the SQL aggregate itself. |
  | 3 | `api/report-pdf.ts:89-119` (PDF export, admin-only) | `accounting_ledger_v` via a paged, unfiltered `.select(...)` (same 1000-row-cap concern as `useLedger`, handled the same way) | Read the source directly (lines 94-119): after draining all pages into `rows`, a `counted = rows.filter(r => r.direction==='in' ? r.status==='paid' : r.status==='paid' \|\| (includePending && r.status==='pending'))` is applied before any totals/period grouping — same rule as consumer #1, independently implemented. |
  | 4 | `src/features/dashboard/hooks/useDashboardData.ts:82-97` (`useMonthlyPL`, dashboard tile) | `accounting_pl_summary_v` (a *different*, older, always-paid-only aggregate view — **not** `accounting_ledger_v` directly, and applies no status filter of its own in the query) | Pulled the view's live definition with `pg_get_viewdef('public.accounting_pl_summary_v', true)`: every one of its 8 `sum(...)` columns is gated `CASE WHEN direction='in' AND status='paid' THEN ... ELSE 0 END` (income) / `direction='out' AND status='paid'` (expense) — confirmed still true today, not just per the 2026-08-27 audit's finding E2. This view has **no pending-expense opt-in** (unlike `pl_summary_for_range`), so `useMonthlyPL` is always strictly paid-only by construction; nothing for the hook itself to filter. |

  No other file in the repo queries `accounting_ledger_v` or
  `accounting_pl_summary_v` directly (`grep -rn "accounting_ledger_v\|accounting_pl_summary_v"`
  across `src/` and `api/` returns only these 4 call sites plus their
  TypeScript type declarations in `src/types/supabase.ts`).
- **Suggestion:** optional defense-in-depth — add `where status <>
  'cancelled'` to the `deal_payments` arm of the view (a cancelled row is
  never real money under any definition) so a *future* consumer (a new
  export, a new dashboard tile, an ad-hoc SQL report) can't forget to
  exclude it. Lower priority: the `LedgerRow.status` TS type
  (`'pending' | 'paid'`) is inaccurate — Supabase can and does return
  `'overdue'` and `'cancelled'` rows for this view; today every consumer
  filters before the type is ever trusted, but the type itself lies about
  what the query can return.
- **Decision needed: N for today's numbers** (nothing on screen is wrong —
  confirmed by code review of every consumer). **Y for the optional
  hardening** (add the view-level filter and/or fix the TS type) — owner
  call on whether it's worth a migration given zero live impact today.
- **Verdict: 🟢** current UI numbers are correct; the unfiltered view is a
  known, accepted, documented characteristic with confirmed downstream
  mitigation, not a live discrepancy.

### 1b — Ledger completeness (expenses)

- **What the UI would show:** all expenses should appear in the view exactly
  once.
- **What the DB says:** `view_exp` count = 162, raw `expenses` count = 162 —
  exact match. Raw `expenses.status` only ever takes `pending`/`paid` (57
  paid + 105 pending = 162; confirmed via the status breakdown), so there's
  no `cancelled`/`overdue` equivalent on this arm and no leak class to worry
  about. 0 duplicates, 0 missing rows.
- **€ size:** n/a — exact match.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct.**

### 1c — `event_date` convention (`coalesce(paid_at::date, start_date)`)

- **What the UI would show:** transactions are dated/grouped by the date they
  were paid, falling back to the scheduled `start_date` when unpaid.
- **What the DB says:** confirmed by reading the view body — both arms use
  `coalesce(paid_at::date, start_date)`. Live sample of 10 paid rows shows
  `paid_at::date` routinely differs from `start_date` (payments made on a
  different calendar day than scheduled), confirming `paid_at::date` really
  is the value being used whenever `paid_at` is set. Aggregate: **683 of 994
  paid `deal_payments` rows (€196,727.95 gross)** have `paid_at::date <>
  start_date`. Raw 10-row sample (`order by paid_at desc limit 10`,
  re-verified identical on re-run):

  | start_date | paid_at (UTC) | paid_at::date | amount_gross |
  |---|---|---|---|
  | 2026-09-01 | 2026-09-09 06:27:38.181 | 2026-09-09 | 270.00 |
  | 2026-09-15 | 2026-09-09 06:22:03.659 | 2026-09-09 | 744.00 |
  | 2026-09-02 | 2026-09-09 00:00:00 | 2026-09-09 | 200.00 |
  | 2026-09-08 | 2026-09-09 00:00:00 | 2026-09-09 | 372.00 |
  | 2026-09-08 | 2026-09-09 00:00:00 | 2026-09-09 | 248.00 |
  | 2026-09-12 | 2026-09-08 07:00:33.674 | 2026-09-08 | 372.00 |
  | 2026-09-10 | 2026-09-08 00:00:00 | 2026-09-08 | 200.00 |
  | 2026-09-01 | 2026-09-08 00:00:00 | 2026-09-08 | 540.00 |
  | 2026-09-04 | 2026-09-08 00:00:00 | 2026-09-08 | 372.00 |
  | 2026-09-15 | 2026-09-08 00:00:00 | 2026-09-08 | 148.80 |
- **€ size:** n/a — expected/by-design, not a discrepancy.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct** — this is the documented cash-basis
  attribution reinstated by the 2026-07-17 revert, working as specified.

### 1d — UTC-vs-Athens day-boundary effect on `paid_at::date`

- **What the UI would show:** a payment's `event_date`/`period` (month
  grouping) is derived from `paid_at::date`, i.e. truncated to a calendar
  date **in the database session's UTC timezone**, not Athens local time
  (UTC+3 in September).
- **What the DB says:** `select count(*), sum(amount_gross) from
  deal_payments where status='paid' and paid_at::date <> (paid_at at time
  zone 'Europe/Athens')::date` → **1 row, €124.00** currently affected.
  Detail: `id d34dc841-…`, `paid_at = 2026-08-27 21:37:22.87 UTC` = Athens
  `2026-08-28 00:37`. The view attributes it to **2026-08-27** (UTC date);
  Athens wall-clock says **2026-08-28**. Both dates fall within August, so
  today this row's `period` ('2026-08') is unaffected — it's a same-month,
  different-day misattribution only, not a cross-month one.
- **€ size:** €124.00 today, on a single row, with zero month-level impact
  right now. The risk is structural, not currently realized: any payment
  marked paid between roughly 21:00–23:59 UTC (00:00–02:59/03:00 Athens,
  depending on DST) **on the last day of a month** would have its `period`
  shifted into the *next* calendar month's UTC date while still landing in
  the *previous* month by Athens wall-clock — i.e. it would appear in the
  wrong month's P&L/MRR. No such event has occurred in the current data (the
  one boundary row this run found is mid-month).
- **Suggestion:** if month-accurate-by-Athens-wall-clock attribution matters
  to the owner, change the view's `event_date` expression to `coalesce((
  paid_at at time zone 'Europe/Athens')::date, start_date)`. This changes
  historical period assignment for every row where the boundary crosses (not
  just future rows), so it needs an explicit migration + one-time
  before/after diff, not a silent swap.
- **Decision needed: Y** — whether Athens-local day/month attribution is
  worth a migration, given the currently-measured impact is 1 row / €124 and
  no month has yet been misattributed.
- **Verdict: 🟡** correct under the documented convention (`paid_at::date`,
  UTC), but the convention itself has a known, previously-flagged (2026-08-27
  audit, Invariant 4) latent month-boundary risk that remains open.

### Summary — Task 1

| # | Item | Verdict | € impact | Decision needed |
|---|---|---|---|---|
| 1a | Ledger unfiltered by status (deal_payments) | 🟢 (mitigated downstream) | 134 rows / €38,617.41 cancelled + 85 overdue sit in the raw view, but every consumer filters them out | N for today; Y for optional hardening |
| 1b | Ledger completeness (expenses) | 🟢 | exact match, 0 gap | N |
| 1c | `event_date` = paid_at::date fallback start_date | 🟢 | working as documented | N |
| 1d | UTC vs Athens day-boundary on `paid_at::date` | 🟡 | €124.00 today, 0 month-level impact so far | Y |

No duplicate `(source_table, source_id)` rows anywhere in the view (0 found).
No raw `deal_payments`/`expenses` row is missing from the view (0 found in
either direction of the `raw LEFT JOIN view` check).

<!-- ============================== TASK 2 ============================== -->

## Task 2 — P&L KPIs + YTD (`pl_summary_for_range` vs independent SQL)

Run 2026-09-09 against prod via `report_audit.mjs task2` (20 labeled,
read-only queries). Full detail (every raw result, all 12 range/toggle
combinations): `.superpowers/sdd/2026-09-09-accounting-report-audit/task-2-report.md`.

Before writing any query, the `expenses` arm's `event_date` expression was
copied byte-for-byte from `supabase/migrations/20260827150000_reporting_hardening.sql`:
`coalesce(e.paid_at::date, e.start_date)` — **not** `paid_date`/`due_date`
(those columns don't exist on `expenses`; it uses the same `paid_at`/
`start_date` naming as `deal_payments`). Task 1's deferred items were both
closed here: `select current_setting('TimeZone')` re-confirmed `UTC`; the
expenses arm's `event_date` had no independent check in Task 1 and is now
covered by the exact reconciliations below (if the expression were wrong,
`pl_summary_for_range` and the independent recompute would not tie out to
the cent — they do, in every one of 6 combinations).

### 2a — `pl_summary_for_range()` vs independent recompute (Sept, Aug, YTD × pending on/off)

- **What the UI would show:** the four KPI tiles (income, expense, net
  profit, MRR) for the selected range, and the YTD strip below them — both
  driven by `usePLSummary` → RPC `pl_summary_for_range(from, to,
  includePendingExpenses)`.
- **What the DB says:** ran `pl_summary_for_range` for September
  (2026-09-01..30), August (2026-08-01..31), and YTD (2026-01-01..12-31),
  each with `p_include_pending_expenses` both `false` and `true` — 6 RPC
  calls — and independently recomputed every one of income net/vat/gross and
  expense net/vat/gross/row-count straight off `deal_payments` and
  `expenses` (bypassing `accounting_ledger_v` entirely), summed by status.
  Net profit was independently derived as income − expense in both net and
  gross. Sample (September, pending=true): RPC returned
  `total_income_net=16681.91, total_expense_net=9914.54,
  net_profit_net=6767.37`; independent recompute: income
  paid=16681.91 (71 rows), expense paid(9626.54, 27 rows)+pending(288.00, 4
  rows)=9914.54 (31 rows), profit=16681.91−9914.54=6767.37. Identical.
  August and YTD reconcile the same way, including YTD's fractional net
  income (`247671.4980` — matches to the fourth decimal).
- **€ size:** **€0.00 deviation across all 6 combinations** (3 ranges × 2
  toggle states) — every net, vat, gross, row-count, and derived net-profit
  figure matches exactly.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct.** `pl_summary_for_range` computes exactly
  what it claims to; the P&L KPI tiles and the YTD strip's income/expense/net
  figures are arithmetically sound.

### 2b — YTD strip range = whole calendar year, not "year to date"

- **What the UI would show:** the YTD strip's label —
  `t('kpi.ytd')` = **"Από αρχή έτους"** (Greek locale) / **"YTD"** (English
  locale), both of which read as "from the start of the year up to now."
- **What the DB says:** `ReportPage.tsx:38` builds the strip's range via
  `rangeForPreset('this_year')`, which is `{ from: '${y}-01-01', to:
  '${y}-12-31' }` (`formatRange.ts:34-36`) — the **entire** calendar year,
  including months that haven't happened yet. Today is 2026-09-09, so
  2026-09-10..12-31 (nearly 4 months) is "future" inside a range labeled
  "from start of year [to now]." Checked what's actually in that gap via
  `accounting_ledger_v`:
  - Future (`event_date > 2026-09-09`) **paid** rows anywhere: **0 rows /
    €0.00**.
  - Future **pending** rows within the YTD window (`<= 2026-12-31`): **33
    rows / €9,068.21** total — split `direction='in'` (income): 31 rows /
    €9,011.21; `direction='out'` (expense): 2 rows / €57.00.
  - Because `pl_summary_for_range` only ever sums income where
    `status='paid'` (2a, and `20260827150000_reporting_hardening.sql`), the
    €9,011.21 of future-dated *pending* income never reaches
    `total_income_*` regardless of the date range — it's excluded by status,
    not by date. **Income side: €0.00 live impact.**
  - Expenses only count `pending` when `includePendingExpenses` is checked
    (same toggle drives both the main range and the YTD strip —
    `ReportPage.tsx:37,39`). With the toggle on, the 2 future-dated pending
    expense rows (**€57.00**) *are* included in the YTD strip's expense
    figure — money that is both unpaid and not even due yet, inside a
    "from start of year" label. With the toggle off (default), €0.00.
- **€ size:** **€0.00 with the pending-expenses toggle off (default); €57.00
  with it on.** The much larger €9,011.21 (future pending income) sits in
  the window but is not currently live € impact — it would only become one
  if `pl_summary_for_range`'s income filter were ever loosened to include
  pending status (mirroring the expense side) without also fixing the range.
- **Suggestion:** either (a) make `ytdRange` literally year-to-date —
  `{ from: '${y}-01-01', to: today }` instead of reusing
  `rangeForPreset('this_year')` — or (b) if a full-year figure is intended
  (e.g. a run-rate view once pending is included), rename the label so it
  doesn't read as "so far this year" (e.g. "Έτος 2026" / "Full year 2026").
- **Decision needed: Y** — pick (a) or (b); either is a small, low-risk
  change (one hook call site or two i18n strings), not a migration.
- **Verdict: 🟡** — the numbers are exactly what the code computes (no
  arithmetic bug, ties to 2a), but the label promises "to date" while the
  query reads the whole year; today's live € exposure is small (€0.00–€57)
  but the underlying mislabel is real and would grow as more of 2026 accrues
  future-dated pending rows.

### Summary — Task 2

| # | Item | Verdict | € impact | Decision needed |
|---|---|---|---|---|
| 2a | `pl_summary_for_range` vs independent recompute (Sept/Aug/YTD × pending on/off, 6 combinations) | 🟢 | €0.00 deviation, every combination | N |
| 2b | YTD strip = whole calendar year (`2026-01-01..12-31`), not year-to-date, despite the "Από αρχή έτους"/"YTD" label | 🟡 | €0.00 (pending off, default) / €57.00 (pending on); €9,011.21 of future pending income in-window but excluded by the paid-only filter (not live today) | Y |

TimeZone re-confirmed `UTC` (Task 1's deferred item (a)); expenses
`event_date` independently validated via exact reconciliation in 2a (Task 1's
deferred item (b) — no standalone check was needed given the reconciliation
result).

<!-- ============================== TASK 3 ============================== -->

## Task 3 — The two MRR tiles (`useMRR` collected vs `useContractedMRR` contracted)

Run 2026-09-09 against prod via `report_audit.mjs task3` in two passes (11
labeled queries, then +4 more after a post-review fix — see below; 15
total, all HTTP 201, zero failures). Primary range: September 2026
(`2026-09-01`..`2026-09-30`), the report page's default; 3a additionally
cross-checks August and July 2026 (both complete months) since September is
still in progress. Full detail (every raw result, plus the fix report):
`.superpowers/sdd/2026-09-09-accounting-report-audit/task-3-report.md`.

Frontend read before writing any query: `useMRR.ts` (collected — sums
`amount_gross` where `billing_type='recurring_monthly' AND status='paid' AND
start_date<=to AND end_date>=from`, i.e. billing-**period overlap**, not
receipt date), `useContractedMRR.ts` (contracted — sums `amount_net` over
`jobs` where `status='active' AND NOT archived AND billing_type<>'one_time'`
joined to non-archived `clients`, with `recurring_yearly` divided by 12),
and `ReportHeader.tsx` + `ReportPage.tsx:40-41,92-93` for how the two feed
one tile (see 3d below).

### 3a — Collected MRR: implementation vs its own caption

- **What the UI would show:** the MRR tile's small caption line —
  `t('kpi.mrr_collected_suffix')` = Greek **"εισπράχθηκαν στην περίοδο"**
  ("collected in the period") / English "collected in period" — next to a
  euro figure.
- **What the DB says:** ran the query exactly as `useMRR.ts` implements it
  (billing-period overlap) and, separately, the query that actually matches
  the caption's wording (`paid_at::date` inside the selected month) — for
  three months, because the report's default range (September 2026) is a
  **partial, in-progress month** (today is 2026-09-09) whose `paid_at_way`
  figure is still accruing and understates the true gap. Re-ran the
  identical comparison on **August** and **July** 2026 (both fully closed)
  to get a stable baseline:
  - **August 2026 (primary example, complete month):** UI-as-implemented
    **€122,051.83 (432 rows)** vs what "collected in the period" would
    actually mean, `paid_at` in August, **€57,177.40 (205 rows)** — a
    **€64,874.43 (53.2%) overstatement.**
  - **July 2026 (complete month):** **€121,359.36 (423 rows)** vs
    **€69,399.86 (245 rows)** — a **€51,959.50 (42.8%) overstatement.**
  - **September 2026 (partial month, report's default range):**
    **€71,331.66–71,511.66 (255–256 rows, two runs ~15 min apart, live prod
    data)** vs **€16,371.18–16,551.18 (58–59 rows)** — a **77%/€54,960.48
    gap**, larger than the completed months only because September's
    `paid_at_way` hasn't finished accruing yet (9 of 30 days elapsed); it
    will shrink as the month completes but, per the 42–53% floor already
    observed on two closed months, will not close.
  - Sample of the disagreeing rows (September) confirms the mechanism: of
    15 sampled rows where the two definitions disagree, 12 were paid in
    August and 3 in July for a period overlapping September (e.g.
    `start_date=2026-08-09, end_date=2026-10-09, paid_at=2026-08-10` counted
    toward September's "collected" figure). The 3 July-paid rows are
    **prepaid**, not late — `paid_at` precedes `start_date` by 13–35 days in
    each case. Also confirmed the figure is genuinely GROSS
    (`vat_amount` sums to ~20% on top of net on the September UI-way query)
    — not a rounding artifact.
- **€ size:** **42–53% overstatement on completed months** (the stable
  baseline: Aug €64,874.43/53.2%, Jul €51,959.50/42.8%); September (partial,
  today's date) shows a larger 77%/€54,960.48 gap that will shrink but not
  close as the month finishes.
- **Suggestion:** either (a) change the query to `paid_at::date between
  from and to` so it matches the caption, or (b) keep the current
  billing-overlap definition (a legitimate "revenue recognized this period"
  metric in its own right) and change the caption so it doesn't claim
  "collected" (e.g. "τιμολογημένη περίοδος" / "billing period overlap").
- **Decision needed: Y** — pick (a) or (b).
- **Verdict: 🔴** — not an arithmetic bug (the code computes exactly what it
  intends to), but the number on screen is materially larger (1.75–2.13× on
  completed months, 4.32–4.36× on the current partial month) than what its
  own caption promises, which is a materially misleading figure for anyone
  reading "collected in the period" at face value.

### 3b — Contracted MRR: paused/held jobs still counted

- **What the UI would show:** the MRR tile's main bold number — "how much
  monthly recurring revenue we're currently contracted for."
- **What the DB says:** of the 417 jobs feeding the €59,984.81 total
  (`recurring_monthly`: 343 jobs/€59,474.73 + `recurring_yearly`: 74
  jobs/€510.0775 — ties to the cent), **131 jobs (€8,746.33/month, 14.6% of
  the total)** have `billing_active=false` (billing explicitly paused) yet
  still count. A second, only-partially-overlapping signal
  (`is_blocked`/`blocked_reason`) shows **35 jobs (€10,109.46/month, 16.9%)**
  are `is_blocked=true` (`account_on_hold`: 10 jobs/€2,819.04,
  `billing_paused`: 25 jobs/€7,290.42) and also still count.
  `awaiting_first_payment` jobs, by contrast, **never** contaminate this
  metric — **0 jobs, €0.00** — consistent with the job first-payment gate
  keeping such jobs from reaching this combination of flags in the first
  place.
- **€ size:** €8,746.33/mo (14.6%) via `billing_active=false`, and a
  separate €10,109.46/mo (16.9%) via `is_blocked` account_on_hold/
  billing_paused, out of the €59,984.81 tile total for September 2026. The
  `awaiting_first_payment` check: €0.00 (verified clean).
- **Suggestion:** confirm intent — if "contracted" is meant to include
  jobs whose billing is currently paused/held (i.e. "what we're contractually
  owed even if not currently billing"), the query is correct as-is and this
  is a documentation/labeling item. If "contracted" is meant to represent
  what's actively billing, add `AND billing_active` and/or
  `AND NOT is_blocked` (or exclude specific `blocked_reason` values) to
  `useContractedMRR.ts`'s existing filter chain.
- **Decision needed: Y.**
- **Verdict: 🟡** for the paused/held contamination (arithmetic matches the
  code's own definition exactly — no bug, just a definitional question with
  real € size); **🟢** for `awaiting_first_payment` specifically (verified
  it does not contaminate the metric).

### 3c — Contracted MRR: `awaiting_first_payment` jobs

- **What the DB says:** 0 jobs, €0.00 — see 3b.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct.**

### 3d — Mixed basis in a single tile (NET headline + GROSS caption, no basis label)

- **What the UI would show:** confirmed by reading `ReportPage.tsx:92-93`
  and `ReportHeader.tsx:160-167` directly (not inferred) — `ReportPage`
  passes `mrr={contractedMrr.data}` (NET, per `useContractedMRR.ts`'s own doc
  comment — the figure lives in `jobs.amount_net`) and
  `collectedMrr={collectedMrr.data}` (GROSS, per `useMRR.ts`'s
  `amount_gross` sum) into one `<ReportHeader>`, which renders a single
  `KpiTile` with `gross={mrr}` (→ actually the NET contracted figure,
  displayed as the large bold number) and `net={collectedMrr}` (→ actually
  the GROSS collected figure, displayed as the small line underneath,
  captioned "collected in period" — see 3a for why even that caption is
  itself misleading).
- **What the DB says:** confirmed both figures' bases independently — 3a's
  Query 5 shows the collected figure is GROSS (`vat_amount` sums to
  €12,078.00 on top of net), and `useContractedMRR.ts`'s doc comment plus
  its `amount_net` column selection confirm the contracted figure is NET.
- **€ size:** not a euro-figure bug — a presentation issue. The tile shows
  €59,984.81 (NET) as the headline and €71,331.66 (GROSS) as the caption,
  side by side, with nothing on the tile indicating which basis is which.
  (€71,331.66 is this task's first-run reading of the September "collected"
  figure; a second run ~15 minutes later and Task 7's live screenshot both
  read €71,511.66 — normal partial-month drift, see 3a's two-runs note and
  7b. The presentation defect this finding describes — mixed NET/GROSS
  basis, no label — is unaffected by which run's figure is quoted.)
- **Suggestion:** either add explicit "(NET)" / "(ΦΠΑ €X" or "GROSS incl.
  VAT)" labels to the two numbers, or normalize both to the same basis
  before display. Separately (a smaller, code-hygiene point): the `KpiTile`
  component's `gross`/`net` props are being reused here as generic
  "primary line"/"secondary line" slots rather than true gross/net — for
  this call site the NET value is passed into the prop named `gross` and the
  GROSS value into the prop named `net`, which will confuse the next person
  reading `ReportHeader.tsx`.
- **Decision needed: Y.**
- **Verdict: 🟡** — no arithmetic error, but a real mixed-basis /
  unlabeled-units finding, confirmed by reading the component tree rather
  than assumed.

### Summary — Task 3

| # | Item | Verdict | € impact (Sept 2026) | Decision needed |
|---|---|---|---|---|
| 3a | Collected MRR = billing-period overlap, not `paid_at` in range, despite the "εισπράχθηκαν στην περίοδο" caption | 🔴 | **42–53% overstatement on completed months** (Aug: €64,874.43/53.2%; Jul: €51,959.50/42.8%); Sept (partial, in progress) shows a larger 77%/€54,960.48 gap that will shrink but not close | Y |
| 3b | Contracted MRR counts paused/held jobs (`billing_active=false`: 131 jobs; `is_blocked` account_on_hold/billing_paused: 35 jobs, partially overlapping) | 🟡 | €8,746.33/mo (14.6%) + €10,109.46/mo (16.9%) of the €59,984.81 total, depending on which signal | Y |
| 3c | Contracted MRR does not count `awaiting_first_payment` jobs | 🟢 | €0.00 | N |
| 3d | Single MRR tile mixes NET (contracted, headline) and GROSS (collected, caption) with no basis label; `KpiTile` gross/net props semantically inverted for this call site | 🟡 | n/a (presentation) | Y |

<!-- ============================== TASK 4 ============================== -->

## Task 4 — Income & expense breakdowns + transaction drawer

Run 2026-09-09 against prod via `report_audit.mjs task4` (15 labeled,
read-only queries, all HTTP 201 on the final run — one query hit an
ambiguous-column error from an unqualified reference and was fixed before
any other query ran; a separate mistake in the brief's original two
breakdown queries — `sum(amount_net)`/`sum(vat_amount)`/`sum(amount_gross)`
left unaliased — was caught before publishing: Supabase's Management API
JSON-serializes repeated column names into a single collapsed key, so the
first pass through those two queries silently returned only the *last*
`sum()` under one `"sum"` key; both were re-run with explicit `net`/`vat`/
`gross` aliases before any figure below was trusted). Full detail, every
raw result: `.superpowers/sdd/2026-09-09-accounting-report-audit/task-4-report.md`.

Frontend read before writing any query: `IncomeBreakdown.tsx`,
`ExpenseBreakdown.tsx`, `TransactionDrawer.tsx`, `ReportPage.tsx` (owns
`includePendingExpenses` and pre-filters `incomeRows`/`expenseRows` before
handing them down), `useLedger.ts`, `useExpenseCategories.ts`, and
`ExportMenu.tsx` (to check whether the export shares the pending-toggle gap
found below — it doesn't). `accounting_ledger_v`'s live definition was
pulled first (`pg_get_viewdef`), confirming income's `category_key` =
`deal_payments.service_type` (a plain nullable column — a NULL row still
surfaces) versus expense's `category_key` = `cat.key` from an **inner
join** to `expense_categories` (a NULL `category_id` would drop the row
from the view entirely, not surface as NULL — see 4c).

### 4a — Income per service (`IncomeBreakdown.tsx`)

- **What the UI would show:** rows filtered `direction==='in' &&
  status==='paid'`, grouped by `category_key` (NULL → its own group,
  rendered as `t('income_breakdown.unknown')` = "Χωρίς κατηγορία"), sorted
  by gross descending, count/net/vat/gross/% columns, label via
  `t('deals:services.types.${key}', {defaultValue:key})`.
- **What the DB says:** September 2026, `direction='in' AND status='paid'`:

  | service | count | net | vat | gross |
  |---|---|---|---|---|
  | local_seo | 30 | 5877.87 | 1276.30 | 7154.17 |
  | ai_seo | 10 | 3103.55 | 658.45 | 3762.00 |
  | web_seo | 8 | 2429.85 | 475.16 | 2905.01 |
  | web_dev | 6 | 2290.00 | 408.00 | 2698.00 |
  | ads | 8 | 1370.97 | 329.03 | 1700.00 |
  | social_media | 4 | 1229.03 | 258.97 | 1488.00 |
  | hosting | 4 | 480.00 | 86.40 | 566.40 |
  | maintenance | 2 | 80.64 | 19.36 | 100.00 |

  Total 72 rows / €20,373.58 gross. 0 NULL `category_key` rows this month
  (the "unknown" bucket is empty, not material). `deal_code` presence:
  **72/72 income rows** carry a non-null `deal_code` — confirms `e7f7010`'s
  claim for every row this month, not a sample.
- **Stale-screenshot reconciliation:** brief's reference (yesterday) was 29
  rows / €5697.87 net / €1276.30 VAT / €6974.17 gross for `local_seo`;
  today's fresh figure (30 / €5877.87 / €1276.30 / €7154.17) differs by
  exactly **+1 row / +€180.00 net / +€0.00 VAT / +€180.00 gross** — traced
  to a single genuine payment made *today* (`event_date=2026-09-09`,
  counterparty "ΚΑΡΑΜΠΟΙΚΗ ΝΙΚΗ ΚΩΝΣΤΑΝΤΙΝΟΣ", 0%-VAT, €180.00). Confirms
  prod moved since the screenshot, as expected — not a discrepancy.
- **€ size:** n/a — exact match to the component's own logic.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct.** Grouping key, filter, sort, NULL
  handling, label fallback, and `deal_code` all match the SQL.

### 4b — Expenses per category (`ExpenseBreakdown.tsx`) — pending-toggle gap

- **What the UI would show:** same shape as income — rows filtered
  `direction==='out' && status==='paid'`, grouped by `category_key`
  (looked up via `useExpenseCategories()`, NULL → em-dash `—` rather than a
  translated label), sorted by gross descending. The page also has an
  "include pending expenses" checkbox (`ReportHeader.tsx` ->
  `includePendingExpenses`) that visibly affects the KPI tiles.
- **What the DB says:** September 2026, `direction='out' AND status='paid'`:

  | category | count | net | vat | gross |
  |---|---|---|---|---|
  | salaries | 5 | 4376.18 | 0.00 | 4376.18 |
  | software | 14 | 2818.36 | 0.00 | 2818.36 |
  | rent | 1 | 1450.00 | 0.00 | 1450.00 |
  | other | 5 | 502.00 | 0.00 | 502.00 |
  | ads_spend | 1 | 470.00 | 0.00 | 470.00 |
  | hosting_domains | 1 | 10.00 | 0.00 | 10.00 |

  Total 27 rows / €9,626.54 gross — ties exactly to Task 2's independently
  recomputed September paid-expense total. (Every expense this month, and
  in fact all 162 expense rows all-time, carry `vat_amount=0.00` — a
  general characteristic of the `expenses` table, not a Sept anomaly or a
  UI bug, noted so Task 7 doesn't mistake an always-zero VAT column for a
  rendering defect.) 0 NULL `category_key` rows and 0 rows referencing an
  archived category this month (archived categories are excluded from
  `useExpenseCategories()`'s label map, which would otherwise fall back to
  raw key text — currently unreachable, not a live issue).
- **Finding:** `ReportPage.tsx` (lines 48–56) already widens `expenseRows`
  to include `status==='pending'` when the toggle is on:
  ```ts
  const expenseRows = useMemo(
    () => (ledger.data ?? []).filter(
      (r) => r.direction === 'out' &&
        (r.status === 'paid' || (includePendingExpenses && r.status === 'pending')),
    ),
    [ledger.data, includePendingExpenses],
  );
  ```
  but `ExpenseBreakdown.tsx`'s own `groups` `useMemo` (line 54) re-filters
  with a hard-coded `r.status !== 'paid'` exclusion that ignores the
  toggle entirely — it never sees the pending rows `ReportPage` already
  included for it. The KPI tiles (`usePLSummary`, Task 2) and the CSV/PDF
  export (`ExportMenu.tsx`, confirmed by reading it — passes `expenseRows`
  straight through, no re-filtering) both correctly honor the toggle; this
  one table silently does not, with no visual cue anything is withheld.
- **€ size:** **€288.00 (4 rows)** for September 2026 — `software`: 3
  rows/€271.00; `other`: 1 row/€17.00 — the pending expenses the toggle
  should surface in this table but currently cannot.
- **Suggestion:** drop the `status !== 'paid'` half of the guard in
  `ExpenseBreakdown.tsx`'s `groups` `useMemo` (line 54) — the component
  should trust the rows it's handed (already correctly filtered by
  `ReportPage`) rather than re-filtering with a stale assumption.
- **Decision needed: Y.**
- **Verdict: 🔴** for the pending-toggle gap (reproducible, €288.00 today,
  grows with the pending-expense backlog, inconsistent with the same
  toggle's effect on KPIs and export). **🟢** for grouping key/label/NULL
  handling otherwise — matches the SQL.

### 4c — `expenses` arm's inner join silently excludes NULL-category rows

- **What the UI would show:** every expense should appear somewhere in the
  breakdown table (paid) or KPI totals — either under a named category or
  an "unspecified"/em-dash bucket, mirroring how income handles a NULL
  `service_type`.
- **What the DB says:** `accounting_ledger_v`'s expense arm is `FROM
  expenses e JOIN expense_categories cat ON cat.id = e.category_id` — an
  **inner** join, not `LEFT JOIN`. If `e.category_id` were ever NULL, that
  row would fail the join and be **excluded from the view entirely** —
  invisible to the breakdown table, the KPI tiles, and CSV/PDF export
  alike, with no error and no "unspecified" row, unlike income's NULL
  `service_type` (a plain column, always surfaces). Checked: `category_id`
  is `NOT NULL` in the generated Supabase types (`src/types/supabase.ts`
  Row type: `category_id: string`, not optional) — this is currently
  **schema-enforced impossible**, not just empty by luck. Confirmed 0 raw
  expenses with `category_id IS NULL` (all-time) and, redundantly, 0
  ledger-view gaps from this cause.
- **€ size:** €0.00 — structurally prevented by the NOT NULL constraint.
- **Suggestion:** none needed given the NOT NULL constraint; noted for the
  record since it's a real asymmetry between the two ledger arms that would
  matter if the constraint were ever relaxed.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct** — no live or reachable issue.

### 4d — Drawer & totals (Local SEO, September 2026)

- **What the UI would show:** `TransactionDrawer`'s header totals (net/vat/
  gross) and row count for whichever group was clicked.
- **What the DB says:** `TransactionDrawer.tsx` does no filtering of its
  own — `totals` is a plain client-side `reduce`/`sum()` over the exact
  `rows` array its caller hands it, so it's only as correct as the
  breakdown component's own grouping (4a/4b already verified). SQL
  cross-check for the `local_seo` September group: **30 rows, net
  €5,877.87, vat €1,276.30, gross €7,154.17** — matches 4a's `local_seo`
  row exactly (same count, same three sums).
- **`deal_code` prefix (`e7f7010`):** `TransactionDrawer.tsx` line 131
  renders `row.deal_code` unconditionally when truthy (income rows only in
  practice, since the view always sets `deal_code=NULL` for expenses).
  Verified live for all 30 `local_seo` rows — every row carries a
  `deal_code` (e.g. `005279`, `000866`, `000129`, …) and would render the
  prefix.
- **Expense drawer rows open the expense detail:** gated on
  `row.source_table === 'expenses' && !!onSelectExpense` ->
  `onSelectExpense(row.source_id)` -> `ExpenseDetailDialog`. Verified every
  September paid expense-sourced ledger row's `source_id` resolves to a
  real `expenses.id`: **27/27 resolvable**, 0 orphaned.
- **€ size:** n/a — exact match.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct** for the drawer's client-side sums and
  the `e7f7010` `deal_code` prefix (both verified against a full group, not
  a sample).

### 4e — Frontend unit tests

`npm run test:run -- accounting_report`: **25 test files, 103 tests, all
passed** (2.20s), 0 failures.

- **Decision needed: N.**
- **Verdict: 🟢 verified correct** — full suite green, 0 failures.

### Summary — Task 4

| # | Item | Verdict | € impact (Sept 2026) | Decision needed |
|---|---|---|---|---|
| 4a | Income per service: grouping/filter/sort/NULL/`deal_code` match SQL | 🟢 | n/a | N |
| 4b | Expense breakdown's own filter hard-codes `status==='paid'`, ignoring the already-widened `includePendingExpenses` rows it's handed; KPIs and export correctly honor the toggle, this table does not | 🔴 | €288.00 (4 rows) withheld from the table when the toggle is on | Y |
| 4c | Expense ledger arm's INNER JOIN to `expense_categories` would silently drop NULL-`category_id` rows from the whole view (not surface as "unspecified"); currently schema-impossible (`category_id` NOT NULL) | 🟢 | €0.00, structurally prevented | N |
| 4d | Drawer header totals = correct client-side sum of the exact group handed to it (verified for `local_seo`/Sept); `e7f7010` `deal_code` prefix renders for 30/30 rows; expense rows open `ExpenseDetailDialog` correctly (27/27 resolvable) | 🟢 | n/a | N |
| 4e | `npm run test:run -- accounting_report`: 25 files / 103 tests, all green | 🟢 | n/a | N |

<!-- ============================== TASK 5 ============================== -->

## Task 5 — Client flow section (`client_flow_for_range` v2, shipped 2026-09-08)

Run 2026-09-09 against prod via `report_audit.mjs task5` (round 1, 16
labeled read-only queries), a fix round `task5_fix` + `task5_fix_counts`
(25 more), then a second fix round `task5_fix2` + `task5_fix2b` (6 more,
closing out CRITICAL 1 properly), all HTTP 201 across all three runs.
`auth.uid()` is NULL over the Management API, so calling the real RPC
returns empty rows for every caller — every query below inlines the RPC's
v2 body (`flowSql()` helper in the runner, copied verbatim from
`20260909130000_client_flow_client_code.sql`; metric logic/rationale
unchanged from `20260909120000_client_flow_for_range.sql`, only
`client_code` was added in v2). Frontend read before writing any query:
`ClientFlowSection.tsx`, `useClientFlow.ts`, `utils/clientFlow.ts`. Full raw
output, all rounds: `.superpowers/sdd/2026-09-09-accounting-report-audit/task-5-report.md`.

**Fix round 1, why:** task review rejected round 1's rigor on 6 points —
not the RPC itself, no live bug was proven either way in round 1. CRITICAL
1: the "independent" `stopped_client` re-derivation had copied the
migration's ended-condition character-for-character (only the `NOT EXISTS`
shape was rewritten), so a bug in the shipped condition would have
reproduced in both arms. CRITICAL 2: the `leaked_aug31`/`leaked_oct1`
boundary checks were tautologically 0, since the inner query already
filters to the range being tested. IMPORTANT 3: the Sept-1 "inclusion"
claim never showed the actual rows. IMPORTANT 4: the stopped-clients
reverse check compares today's snapshot to itself with a strict-subset
predicate — close to logically guaranteed, and was labeled as if it proved
more than that. IMPORTANT 5: the 3 (August) → 44 (September, 9 days in)
`stopped_client` jump was never investigated. IMPORTANT 6: a same-day
50→52 `renewal_client` delta (this morning's ship-day sanity vs this run)
was left unreconciled. All 6 were addressed in the first fix round.

**Fix round 2, why:** re-review of fix round 1 found IMPORTANT 3–6 genuinely
addressed, but **CRITICAL 1 was not** — its "closure" asserted "48 genuine
end-clients − 4 exclusions = 44" from a `count(distinct client_id) FILTER
(...)` split that isn't mutually exclusive per client (47+14=61≠60, since a
client with jobs in both filter buckets is counted twice), the "4
exclusions" figure was never actually queried, and one worked example
(`Apex Exclusive Services`) was misclassified as a drag-then-End case when
its own job genuinely matches September. Closed in round 2 with one real,
mutually-exclusive, per-client reconciliation query — see 5d.

**September 2026 kind counts (record for Task 7's live-screen comparison)
— PARTIAL MONTH, today is 2026-09-09, these will still move:**

| kind | count |
|---|---|
| new_deal | 4 |
| stopped_client | 44 |
| renewal_client | 52 (was 50 this morning — reconciled in 5g) |
| *(first-ever payer, not a tile)* | 5 |

For reference, August 2026 (a fully-closed month): new_deal 24,
stopped_client 3, renewal_client 169. The stopped_client jump (3→44) is not
apples-to-apples with August either — see 5f: 40 of the 44 trace to one
specific one-day batch on 2026-09-08, not organic month-over-month growth.

### 5a — Timezone boundary correctness

- **What the UI would show:** a deal/payment/end-event exactly at the
  Athens-local month edge (e.g. 31/8 23:30 Athens = 20:30 UTC) should not
  bleed across the boundary; the brief specifically worried about a
  UTC-vs-Athens day mismatch near midnight.
- **Round-1 flaw (CRITICAL 2):** the original `leaked_aug31`/`leaked_oct1`
  checks filtered the RPC's own output to `kind='new_deal'` etc. **from a
  query that had already restricted `event_date between p_from and p_to`**
  — so `leaked_aug31=0` was true by construction, not evidence of anything.
  Replaced below with row-level checks: every real Aug-31 row traced by id
  to its actual disposition, plus a direct search for rows where the UTC
  calendar date and the Athens calendar date disagree in the specific
  windows where that could change a month.
- **What the DB says now (`task5_fix`, C2-a/C2-b/C2-c):**
  - **The 12 real Aug-31 (raw-basis) paid payments, by id:** none of their
    12 clients has *any* September-dated paid payment too (`client_has_a_
    september_payment_too = false` for all 12) — so none of these rows,
    correctly, produces a September output row of any kind; they simply
    don't reach the range filter. Confirmed by id, not inferred from a
    tautological count.
  - **The 1 real Aug-31 (Athens-basis) job completion** (`Δεσποτάκης
    Μάριος`, `web_seo`, `completed_at` 2026-08-31 09:49 UTC): it genuinely
    satisfies the RPC's "ended" condition (`qualifies_as_ended_event =
    true`) — its Athens-local `end_date` is 2026-08-31, one day before the
    range, so it correctly cannot appear in September's `stopped_client`
    output regardless of the "no other open job" exclusion. (Same client,
    unrelated to this job, is one of 5c's first-ever September payers on a
    different deal — not a conflict, just the same client showing up for
    two different reasons.)
  - **Direct tz-conversion search (C2-c):** rows where UTC day ≠ Athens day
    in the actual midnight-crossing windows — `created_at`/`completed_at`/
    `paid_at` in `[2026-08-31T21:00Z, 2026-09-01T00:00Z)` (the only UTC
    range where Athens, at UTC+3 in September, rolls into the next
    calendar day before UTC does) and the symmetric `[2026-09-30T21:00Z,
    2026-10-01T00:00Z)` — returned **zero rows** across `deals`, `jobs`,
    and `deal_payments`. **The Athens-vs-UTC conversion logic itself is
    therefore verified structurally only** (the SQL expression is correct
    Postgres, and 5a's earlier finding of real Athens≠UTC rows elsewhere in
    the data, e.g. the Aug 27→28 case, proves the expression *does*
    something), **not against a live case at this specific month boundary**
    — none currently exists to test against. This is an honest gap, not a
    bug: worth re-running this exact `C2-c` query next month-end if a
    genuine near-midnight event is wanted as a live proof.
  - **`renewal_client`'s date basis is *not* Athens-adjusted** —
    `coalesce(dp.paid_at::date, dp.start_date)` is the raw UTC-ish basis
    (same convention as `accounting_ledger_v`'s `event_date`, already
    characterized in Task 1). Not an oversight: the migration's rationale
    header and this task's own brief both state it explicitly. Confirmed
    with a real example (payment `d34dc841…`, `paid_at` 2026-08-27 21:37
    UTC → raw basis Aug 27, an Athens-adjusted read would say Aug 28) — a
    small, intentional inconsistency between the three metrics' day-
    boundary conventions (two Athens-local, one raw), not a bug. Because
    this basis has no timezone conversion at all, "midnight-crossing" is
    not a meaningful concept for it — see 5c-note below.
  - **Sept-1 inclusion, actual rows (IMPORTANT 3, `I3-a`/`I3-b`):** the 1
    `stopped_client` row on `event_date=2026-09-01` is `completed_at`
    2026-09-01 12:30 UTC → Athens day also 2026-09-01 — a plain daytime
    event, **not** a midnight-crossing case (it doesn't test the boundary
    logic, just confirms an ordinary same-day value passes through
    correctly). The 8 `renewal_client` rows on `event_date=2026-09-01` are
    all raw-basis, so "crossing" doesn't apply to them by construction; one
    (`B2B CORPORATE`) has `paid_at` at exactly `2026-09-01 00:00:00 UTC`,
    the earliest possible UTC instant of the day — unambiguous, no
    conversion involved.
  - Sept-30 inclusion remains untestable — 0 deals/payments/job-ends exist
    anywhere in the data on Athens-local 2026-09-30 (today is 2026-09-09).
- **€ size:** n/a — no misattributed rows found.
- **Suggestion:** none required for the logic; flagging the Athens-local vs
  raw-basis split for the record (spec'd, not a bug), and flagging that the
  tz conversion's correctness at the exact month edge is currently
  structural-only, not empirically demonstrated (no live crossing case
  exists yet).
- **Decision needed: N.**
- **Verdict: 🟢** for every row-level check actually run (all correctly
  classified, by id) and for the raw-vs-Athens basis split (matches spec).
  **Honest gap, not a defect:** the tz-conversion expression has no live
  midnight-crossing row to prove itself against at this specific boundary
  right now; Sept-30 inclusion is likewise untestable today.

### 5b — Stopped-clients reverse check (relabeled, IMPORTANT 4)

- **What the UI would show:** a client the `stopped` tile lists for
  September should have no live job today, and no client with a live job
  today should ever appear in that tile.
- **What the DB says:** both directions checked against today's actual job
  state (`status='active' AND NOT archived AND billing_active`):
  `stopped_client ∩ live_today` = **0 rows** each way.
- **Honest capability statement (this is the fix, not new SQL):** this
  check compares one live snapshot (today's job state) against a strict
  subset predicate (a client flagged `stopped_client` must NOT be in
  today's live set) evaluated from the *same* underlying `jobs` table the
  RPC itself reads. What it **can** catch: gross transcription errors —
  e.g. if the RPC's exclusion subquery had an inverted condition or a
  wrong join key, a `stopped_client` row would trivially collide with a
  currently-live job and this check would fail loudly. What it **cannot**
  catch: whether "stopped" is the *right* business call for any given
  client (that's 5f/definition correctness, not this check), or the true
  state of the world at the actual month-end instant (2026-09-30 23:59:59
  Athens) — it only ever sees "right now" (2026-09-09), so a client who
  goes live again *between* month-end and whenever this check runs would
  silently pass either way. It is a weak, close-to-logically-guaranteed
  check by nature — kept because a failure would still be meaningful, not
  because a pass proves much.
- **€ size:** n/a.
- **Decision needed: N.**
- **Verdict: 🟢** for what it actually tested (0 mismatches against today's
  snapshot) — see the capability statement above for what this does and
  does not certify.

### 5c — Renewal completeness (renewal + first-ever = all Sept payers)

- **What the UI would show:** the `renewals` tile is meant to catch every
  *recurring* payer this month; it's not supposed to (and doesn't) include
  a client's very first-ever payment, which the brief calls out as a
  distinct bucket to reconcile against, not a UI tile of its own.
- **What the DB says:** September 2026 — **57** distinct clients paid at
  all, of which **52** had an earlier paid payment before September
  (`renewal_client`, matches the RPC exactly) and **5** paid for the very
  first time in September (`PRAXIS HARMONY GROUP`, `Δεσποτάκης Μάριος`,
  `ΙΚΟΥΤΑΣ ΒΑΣΙΛΕΙΟΣ`, `ΚΟΣΜΑΣ ΧΡΗΣΤΟΣ …`, `ΠΑΠΑΣΑΒΒΑΣ ΑΥΓΕΡΙΝΟΣ`).
  52 + 5 = 57, exact. Four of those five first-ever payers are also this
  month's four `new_deal` rows (new client, same-month first payment) —
  the fifth (`Δεσποτάκης Μάριος`) is a pre-existing deal paying for the
  first time this month. No gap: every Sept payer lands in exactly one of
  the two buckets.
- **Partial-month caveat (IMPORTANT 4/6):** this is a snapshot of an
  in-progress month (today is 2026-09-09) — both the 57 total and the
  52/5 split will grow as more September payments get marked paid over the
  rest of the month, the same way Tasks 2b/3a flag partial-vs-complete
  months. The 52 itself already moved from 50 (this morning) to 52 (this
  run) within the same day — reconciled to specific payments in 5g. The
  completeness *proof* (52+5=57 exhaustive, no third bucket) holds at any
  instant regardless of how many payments have posted; only the absolute
  numbers move.
- **€ size:** n/a — count reconciliation, not €.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct** (structurally, at every instant); see
  5g for the specific same-day count movement.

### 5d — Independent end-event reconstruction (redone, CRITICAL 1)

- **Round-1 flaw:** the original "independent" re-derivation copied the
  migration's ended-condition — the `archived_reason` list, the
  `pending_archive_reason` branch, the `billing_paused` exclusion —
  character-for-character; only the `NOT EXISTS`/aggregation shape was
  rewritten. A bug in the shipped boolean condition itself would have
  reproduced identically in both arms and the diff would still have shown
  0. That query and its 0-row diff are **not evidence of correctness** and
  are superseded by this subsection.
- **What was checked instead:** two evidence sources that don't touch the
  RPC's boolean condition at all.
  1. **New End era (since `end_and_archive_job`, `20260904200000`):**
     every End action writes an audit `comments` row (`task_key =
     'job_archived:<job_id>'`) and, separately, `notifications` rows —
     independent artifacts with their own `created_at`, unrelated to the
     RPC's `jobs.completed_at` basis. Built "clients with a September
     End-action" from `comments.created_at`, and diffed that client set
     against the RPC's own `client_id`s in the `ended` CTE for September
     (`completed_at` basis).
  2. **Old End era (`end_job`, pre-9/4):** this function writes **no**
     audit trail at all — confirmed by reading its body
     (`20260624060000_end_job_cascade_children.sql`): only `billing_active`/
     `status`/`completed_at`/`stage_id` change, no `comments`/
     `notifications` insert. The only independent corroboration available
     is **pipeline stage position** — does the job's `stage_id` actually
     point at a `code='closed'` stage on its board?
- **Preliminary counts (`task5_fix` C1-a..d), context only — superseded by
  the reconciliation below:** 124 September `job_archived` comments → 65
  distinct jobs → 60 distinct clients. 64 September `job_archived`
  notifications → 64 distinct jobs (1 fewer than comments — expected,
  notifications legitimately skip the acting user / jobs with no eligible
  recipient). Old-era candidates: 7 jobs / 5 distinct clients match the
  RPC's old-era branch with `end_date` in September, **7/7 (100%)** sit in
  a `stage_code='closed'` lane.
- **Re-review correction:** the first version of this subsection stopped
  at a `count(distinct client_id) FILTER (...)` split ("47 agree + 14
  differ") and asserted "48 genuine end-clients − 4 exclusions = 44"
  without ever running a per-client reconciliation query — that FILTER
  split isn't mutually exclusive (a client with two jobs, one matching
  each filter, gets counted in both: 47+14=61≠60), and the "4 exclusions"
  and one worked example (`Apex Exclusive Services`) were both wrong —
  Apex's `ai_seo` job `d0ec35bd` has `completed_at` **2026-09-08**, a
  genuine September match, not a drag-then-End case. Corrected below with
  one real, mutually-exclusive, per-client query
  (`task5_fix2`/`task5_fix2b`).
- **THE reconciliation:** every client in the candidate pool (comment-
  confirmed new-era ∪ old-era stage-confirmed) classified into exactly one
  bucket:

  | Bucket | Meaning | Count |
  |---|---|---|
  | a | In the RPC's `stopped_client` output | **44** |
  | b | Excluded by the "no other open job at month end" clause | **5** |
  | c | Comment/old-era evidence exists, but no job of theirs has `completed_at` in September (drag-then-End) | **12** |
  | d | Anything else (unexplained) | **0** |
  | **TOTAL** | | **61** |

  44+5+12+0 = 61, the exact candidate-pool size; bucket a (44)
  independently matches the RPC's own `stopped_client` count, queried
  separately as a cross-check in the same run; bucket d is empty.

  **Bucket b — the 5 real exclusions, with the job that keeps each client
  open:**

  | Client | `end_date` | Blocking job(s) |
  |---|---|---|
  | HAJDINI HAMIT RRAPI (000294) | 2026-09-08 | `000294-ADS`/`DOMAINS`/`HOSTING`/`WEBDEV` (all active, billing_active=true) |
  | Ε ΜΗΤΣΟΣ ΚΑΙ ΣΙΑ Ε Ε (000121) | 2026-09-09 | `000121-HOSTING`/`WEBDEV` (active, true) |
  | ΚΑΡΑΜΑΝΟΣ Ο. & ΣΙΑ Ο.Ε. (000058) | 2026-09-08 | `000058-AISEOLOC` (**completed**, billing_active=false — a different in-limbo state, not a match to any "ended" branch) |
  | ΚΑΦΙΕΡΗ ΑΡΤΕΜΙΑ ΙΩΑΝΝΗΣ (005906) | 2026-09-08 | `005906-ADS` (active); `005906-LOCALSEO` (active, billing_active=false) |
  | ΠΑΝΑΓΙΩΤΑΚΗΣ ΙΑΚΩΒΟΣ ΝΙΚΟΛΑΟΣ (000338) | 2026-09-08 | `000338-DOMAINS`/`WEBDEV` (active); `000338-LOCALSEO-2` (active, billing_active=false) |

  `Ε ΜΗΤΣΟΣ`'s end-event landed on **2026-09-09 — today** — a live example
  of month-in-progress data changing while this query ran.

  **Bucket c — the 12 real drag-then-End clients** (all individually
  confirmed: a September comment exists, but not one job of theirs has
  `completed_at` in September): `CANTIN CENTER Ε.Ε.` (000082, comment
  2026-09-08 / `completed_at` 2026-06-24 — verified worked example),
  `Crete Car Rental agency…` (000321), `PREGIO FOOD BAR ΜΟΝΟΠΡΟΣΩΠΗ
  Ι.Κ.Ε.` (000333), `Traffic Store Army and Workwear` (000297), `ΑΣΠΙΩΤΗΣ
  ΣΤΑΜΑΤΙΟΣ ΝΙΚΟΛΑΟΣ ΣΠΥΡΙΔΩΝ` (000123), `Β ΚΑΙ Μ ΜΑΝΟΥΡΑΣ ΟΕ` (000072),
  `ΒΟΥΛΓΑΡΑΚΗΣ ΕΥΑΓΓΕΛΟΣ ΛΕΩΝΙΔΑΣ` (000153), `ΓΟΥΣΕΤΗ ΑΘΗΝΑ ΔΙΟΝΥΣΙΑ
  ΓΕΩΡΓΙΟΣ` (000332), `ΜΟΥΤΖΟΥΡΗ ΧΑΡΑΛΑΜΠΙΑ ΔΑΦΝΗ ΝΙΚΟΛΑΟΣ` (000150),
  `ΣΠΥΡΙΔΑΚΗΣ ΜΙΧΑΗΛ ΕΜΜΑΝΟΥΗΛ||PARADISE` (000397), `ΤΡΙΑΝΤΑΦΥΛΛΑΚΗΣ
  ΚΩΝΣΤΑΝΤΙΝΟΣ ΝΙΚΟΛΑΟΣ` (000389), `ΧΡΗΣΤΙΔΗΣ ΕΥΑΓΓΕΛΟΣ ΝΙΚΟΛΑΟΣ`
  (000434) — a real, now-measured instance of the migration's own
  documented caveat ("job dragged to Closed months before End charges the
  departure to the month of the drag"), **12 of 61 (20%)** of the
  candidate pool.

  **Bucket a — all 44 clients in the actual `stopped_client` output**
  (full list, `task5_fix2b`): `ANGJELIU ELIS EDMOND`, `Apex Exclusive
  Services`, `Avgerinos Hair Art`, `DE LUCA MICHELE JUSSEPE`, `DRIVE THRU
  CAFE ΚΑΛΑΜΑΤΑΣ Ε. Ε.`, `ECODIN ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΕΙΑ`,
  `Korniza`, `LA ESQUINA EST 2013 Ε Ε`, `MAHO ABDUL KERIM MOHAMAD`,
  `MAMAKAS STAFF ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΙΑ`, `Maria Daikou`, `Olive
  Groove Travel`, `RHODES LEASING BOATS G.P.`, `San Strati Experience |
  Agios Efstratios`, `ZLATEV ALEKS MIROSLAVOV`, `Αλέξανδρος Βάκρινος
  Μηχανολόγος Μηχανικός`, `ΒΑΙΤΣΟΥ ΧΡΥΣΟΥΛΑ ΤΟΥ ΠΑΝΑΓΙΩΤΗ`, `ΓΕΩΡΓΙΟΣ
  ΜΠΟΝΕΛΗΣ`, `ΓΚΟΥΡΟΜΠΙΝΟΣ ΜΑΡΙΟΣ ΔΗΜΗΤΡΙΟΣ`, `ΔΑΤΣΕΡΗΣ ΝΙΚΟΛΑΟΣ
  ΙΩΑΝΝΗΣ`, `Ελεύθερος Επαγγελματίας` (the sole old-era-only member),
  `Ι ΜΠΑΜΠΑΛΗΣ ΚΑΙ ΣΙΑ Ε.Ε.`, `ΙΩΑΝΝΗΣ ΛΥΡΑΣ ΙΔΙΩΤΙΚΟ ΙΑΤΡΕΙΟ ΙΑΤΡΙΚΗ
  ΜΟΝΟΠΡΟΣΩΠΗ ΕΠΕ`, `ΚΑΡΑΤΖΟΓΙΑΝΝΗ ΑΘΗΝΑ ΛΕΩΝΙΔΑΣ`, `ΚΟΛΛΙΑΣ ΠΑΝΑΓΙΩΤΗΣ
  ΓΡΗΓΟΡΙΟΣ`, `ΚΟΥΤΣΟΥΡΑΚΗΣ ΜΑΡΙΟΣ - ΜΑΥΡΗ ΖΑΧΑΡΗ`, `ΚΥΠΡΙΩΤΗ ΑΝΤΩΝΙΑ ΤΟΥ
  ΑΝΔΡΕΑ`, `ΛΟΝΤΟΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΑΝΤΕΜ`, `ΜΑΡΙΝΟΣ ΓΕΩΡΓΙΟΣ ΧΑΡΑΛΑΜΠΟΣ`,
  `ΜΟΥΤΑΦΤΣΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΔΗΜΗΤΡΙΟΣ`, `ΜΠΑΡΜΠΑ ΕΥΑΓΓΕΛΙΑ ΚΑΙ ΣΙΑ ΕΕ`,
  `ΜΠΡΙΝΤΑΛΟΣ ΙΩΑΝΝΗΣ ΗΛΙΑΣ`, `ΠΑΛΗΚΥΡΑΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΓΕΡΑΣΙΜΟΣ`,
  `ΠΑΝΗΜΑΘΙΑΚΟΣ ΑΘΛΗΤΙΚΟΣ ΣΥΛΛΟΓΟΣ ΚΑΡΑΤΕ ΒΕΡΟΙΑΣ`, `ΠΑΠΑΔΑΚΗΣ ΔΗΜΗΤΡΙΟΣ
  του ΑΝΤΩΝΙΟΥ`, `ΠΑΠΑΠΑΝΑΓΙΩΤΟΥ ΣΕΒΑΣΤΗ`, `ΠΡΑΣΙΝΟΣ ΕΥΑΓΓΕΛΟΣ
  ΚΩΝΣΤΑΝΤΙΝΟΣ`, `ΣΦΥΡΑΚΗΣ ΔΗΜΗΤΡΙΟΣ ΑΝΤΩΝΙΟΣ`, `ΤΕΡΖΟΠΟΥΛΟΣ ΔΗΜΟΣΘΕΝΗΣ
  ΚΑΙ ΣΙΑ Ε.Ε.`, `ΤΕΧΝΟΛΟΓΙΚΟ ΜΟΥΣΕΙΟ ΦΑΕΘΩΝ`, `ΦΑΡΜΕΡΣ ΙΚΕ`,
  `Χ.ΣΑΒΒΟΠΟΥΛΟΣ - Α.ΜΑΛΑΜΟΥΔΗΣ ΚΑΙ ΣΙΑ ΙΚΕ`, `Χρήστος Διαμαντής`,
  `ΧΡΥΣΑΝΘΗΣ ΣΤΥΛΙΑΝΟΣ ΤΟΥ ΔΗΜΗΤΡΙΟΥ`.
- **€ size:** n/a.
- **Decision needed: N as a bug** — this is documented, working-as-migrated
  behavior, not a defect; the accuracy trade-off it represents (attribute
  the departure to the End-press month vs. the month the job actually
  entered "Closed") is a real, open choice and is surfaced separately as
  **decision 6** in the consolidated list above.
- **Verdict: 🟢** — every one of the 61 candidates is accounted for by
  exactly one bucket (none unexplained); bucket a's 44 independently
  matches the RPC's own output; bucket c's 12-client drag-then-End
  divergence matches a caveat the migration already documented in writing
  before this audit ran. This table, not the retracted "47/48" arithmetic
  from the first pass, is the source of truth.

### 5e — Frontend rendering fidelity (`ClientFlowSection.tsx` / `useClientFlow.ts` / `utils/clientFlow.ts`)

- **What the UI would show:** `groupClientFlow()` (`utils/clientFlow.ts`)
  does a plain `rows.filter(kind===...).sort(byName)` per kind — no
  dedup, no re-aggregation. `ClientFlowSection.tsx`'s tile counts are
  `groups?.newDeals.length` / `.stopped.length` / `.renewals.length`
  (list lengths, not a separate count field), and the drill-down list
  under each tile renders exactly that filtered array, keyed
  `${kind}:${deal_id ?? client_id}`.
- **What the DB says:** each RPC branch (`new_deal`/`stopped_client`/
  `renewal_client`) is individually `GROUP BY client_id` (plus
  `deal_id`/`client_id` for `new_deal`, which is 1 row per deal by
  design), so **within one kind a client_id can't repeat** — the React
  key can't collide, and "counts = list lengths" can't drift from the
  true row count. A client legitimately appearing in *two* kinds (e.g.
  both `stopped_client` and `renewal_client` in the same month) is fine
  by design and doesn't affect either kind's own count. 5d's mutually-
  exclusive per-client reconciliation (61-client candidate pool: 44 in the
  output, 5 correctly excluded by the "no other open job" clause, 12
  drag-then-End, 0 unexplained) confirms the 44-row `stopped_client` set
  from a route that doesn't touch the RPC's own `GROUP BY` at all — the
  count the UI shows (44) is correct and stable, not just internally
  self-consistent.
- **€ size:** n/a.
- **Decision needed: N.**
- **Verdict: 🟢 verified correct.**

### 5f — The 3→44 `stopped_client` jump (IMPORTANT 5)

- **What the UI would show:** a jump from August's 3 to September's 44
  (9 days in) reads, on its face, like something's wrong — either a bug
  inflating the count, or a genuinely alarming mass client loss.
- **What the DB says:** neither. It's one real, one-day operational batch.
  - September's 124 `job_archived` comments are almost entirely
    concentrated on **2026-09-08**: **122** of the 124 (I5-d), split
    **59** deferred-local_seo-End comments + **60** disconnect-completion
    comments (the trigger from `20260908120000` firing when the operator
    disconnected each client's Google Business Profile the same day) + a
    handful (**3**) of ordinary immediate-End comments for non-local_seo
    services.
  - Distribution of the 44 September `stopped_client` set by `end_date` ×
    `service_type` (I5-a): 1 on Sept 1, 1 on Sept 4, and on **Sept 8
    alone**: `local_seo` 40 clients, `ads` 2, `social_media` 2, `ai_seo` 1
    — **40 of the 44 (91%)** are the local_seo batch (that 40 is a correct
    `count(distinct client_id)` within its own group). **Loose end,
    fixed:** summing the "clients" column across every `(end_date,
    service_type)` group gives 1+1+2+1+40+2 = **47**, not 44 — don't read
    that as a total. Two clients have jobs ending in more than one
    `service_type` group the same day and get counted once per group:
    `ΙΩΑΝΝΗΣ ΛΥΡΑΣ ΙΔΙΩΤΙΚΟ ΙΑΤΡΕΙΟ ΙΑΤΡΙΚΗ ΜΟΝΟΠΡΟΣΩΠΗ ΕΠΕ` (`ads` +
    `social_media`) and `ΠΑΛΗΚΥΡΑΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΓΕΡΑΣΙΜΟΣ` (`ads` +
    `local_seo` + `social_media`) — both entirely on 2026-09-08. 47 − 3
    (the extra appearances) = 44, confirmed directly by
    `count(distinct client_id)` over the whole matched set (`task5_fix2`).
  - This ties directly to `20260908120000_end_defers_archive_until_
    disconnect.sql`, shipped that same day: local_seo Ends since 9/4 had
    been silently stuck pending a GBP disconnect that nobody remembered to
    do (the owner-reported bug the migration fixes); once shipped, the
    operator visibly worked through the backlog — pressing End (or simply
    disconnecting an already-deferred one) for dozens of local_seo clients
    within about a 45-minute window (10:16–11:14 UTC per the comment
    timestamps) and then disconnecting each one roughly 2.5 hours later
    (12:53–13:24 UTC), completing the archive same day. 99 jobs total had
    `updated_at` touched on 2026-09-08 (I5-c) — a genuinely busy day, not
    an isolated anomaly.
  - This is exactly the kind of real, human-driven batch the migration's
    own backfill step (step 5 of `20260908120000`) was written to surface
    correctly, not to hide — a stopped-client count spike on the day a
    backlog gets cleared is the intended, honest behavior of the metric,
    not a defect in it.
- **€ size:** n/a — informational, not a € finding.
- **Suggestion:** flag this for Task 7/the owner as context when they see
  "44" on the live screen for the first time — it's one day's cleanup of a
  real backlog, not 44 independent client losses spread across the month.
- **Decision needed: N.**
- **Verdict: 🟢** — fully explained by real, verifiable operational
  activity; not a bug, not a data artifact.

### 5g — Reconciling the 50→52 `renewal_client` delta (IMPORTANT 6)

- **What the UI would show:** the same "September, this month" range
  should return a stable count if queried twice in a row; a same-day
  50→52 move (this morning's ship-day sanity check vs this run) needs an
  explanation or it looks like non-determinism.
- **Limitation, stated plainly:** the ship-day sanity script
  (`deploy_client_flow.mjs`) did not save its output to a log file, and
  none exists in the scratchpad — there is no byte-exact "50" result set
  to diff against. What follows is the strongest reconciliation the
  available evidence supports: a complete, by-id account of every PAID
  `deal_payments` row that changed today, which fully accounts for a
  same-day increase of this size, but cannot name the *exact* 2 rows that
  crossed whatever instant the ship-day script ran at.
- **What the DB says (`task5_fix` I6-a/I6-b, `task5_fix_counts`):** **7**
  clients currently in the September `renewal_client` set (52) have a
  qualifying payment whose `deal_payments.updated_at` (row-touch time) is
  **today**, 2026-09-09, at times spread from 06:22 to 10:38 UTC:
  `ΣΠΑΝΟΣ ΦΟΥΣΚΑΡΙΝΗΣ…` (06:22), `ΒΑΣΙΛΑΣ ΕΜΜΑΝΟΥΗΛ…` (06:25),
  `ΠΑΝΟΥΣΗΣ ΓΕΩΡΓΙΟΣ…` (06:26), `Chalkidiki Yachts…` (06:28),
  `ΧΑΡΤΕΡΟΥ ΒΑΣΙΛΙΚΗ…` (06:48), `ΚΑΡΑΜΠΟΙΚΗ ΝΙΚΗ…` (10:37), and
  `Derma Life` (10:22, two rows). All 7 confirmed still present in the
  live `renewal_client` set with `event_date=2026-09-09` (the confirm
  query at the end of `task5_fix_counts`). Every one of these clients'
  qualifying September payment was marked `status='paid'` at some point
  *today* — none of them could have counted toward *any* renewal-count
  snapshot taken before its own `updated_at` instant, including a ship-day
  check earlier this morning. (A separate row — `Tsopanas Holidays`' Aug-31
  payment, also touched today at 10:00 UTC — turned out to be a red
  herring for this specific reconciliation: checked individually, that
  client has no September payment at all, so marking an older payment paid
  today has no effect on September's renewal count.)
- **€ size:** n/a — count reconciliation.
- **Suggestion:** none — this is the expected behavior of an in-progress
  month; if a stable intra-day count is ever needed for a report snapshot,
  it would need to be taken at a fixed cutoff and labeled as such, not
  compared casually across different times of day.
- **Decision needed: N.**
- **Verdict: 🟢** — the delta is real, explained by real same-day payment
  activity (at least 6 of the 7 clients found are net-new candidates for
  the count; the exact 2 that crossed the ship-day script's specific
  execution instant can't be pinned down without its saved output, which
  doesn't exist), and is the expected shape of a partial-month metric, not
  a bug.

### Summary — Task 5

| # | Item | Verdict | € / count impact | Decision needed |
|---|---|---|---|---|
| 5a | Timezone boundary handling verified row-by-row (not tautologically): the 12 real Aug-31 payments and 1 Aug-31 job-end traced by id to correct exclusion; direct search for real midnight-crossing rows at both month edges found **zero** — tz conversion verified structurally only, not against a live crossing case | 🟢 | 0 misattributed rows; 1 honest untestable gap | N |
| 5b | `stopped_client` reverse check vs today's live job state, both directions, relabeled: catches gross transcription errors, cannot certify business-definition correctness or true month-end state | 🟢 | 0 mismatches | N |
| 5c | `renewal_client` (52) + first-ever-payers (5) = all Sept payers (57), exact, holds at every instant of a partial month | 🟢 | n/a | N |
| 5d | Redone twice: first from a genuinely independent trail (comments/notifications + pipeline-stage position), then re-review found that pass's arithmetic was asserted, not queried — closed with ONE mutually-exclusive per-client reconciliation query: 61-client candidate pool = 44 (bucket a, in output, matches RPC exactly) + 5 (bucket b, excluded by open-job clause, each blocking job named) + 12 (bucket c, drag-then-End) + 0 (bucket d, unexplained) | 🟢 | n/a | N |
| 5e | Frontend grouping/counts/keys faithfully reflect the RPC; per-kind uniqueness guaranteed by `GROUP BY`, confirmed by 5d's independent count | 🟢 | n/a | N |
| 5f | 3→44 `stopped_client` jump fully explained: 40/44 (91%) trace to one real one-day batch (2026-09-08, local_seo disconnect-deferral backlog clearance tied to `20260908120000`) | 🟢 | n/a — informational for Task 7 | N |
| 5g | 50→52 `renewal_client` same-day delta: 7 real payments marked paid today (06:22–10:38 UTC) fully account for the size of the move; exact 2 rows unidentifiable without the ship-day script's (unsaved) raw output | 🟢 | n/a | N |

**No bugs found in Task 5, across all three rounds. September 2026 kind
counts for Task 7 (partial month, will still move): new_deal=4,
stopped_client=44 (91% = one 2026-09-08 batch, see 5f; reconciliation
confirms exactly 44 via a mutually-exclusive bucket table, not asserted —
see 5d), renewal_client=52 (see 5g for the same-day 50→52 move).**

<!-- ============================== TASK 6 ============================== -->

## Task 6 — Export CSV/PDF & period locks

Read-only code review of `src/features/accounting_report/components/ExportMenu.tsx`,
`api/report-pdf.ts`, `src/features/accounting_report/utils/exportCSV.ts`,
`src/features/accounting_report/components/PeriodLockControl.tsx`,
`supabase/migrations/20260827190000_accounting_period_locks.sql`, plus a new
`task6` query group in `<scratchpad>/report_audit.mjs` (SELECT-only, token
from `sbp.token`, `node report_audit.mjs task6`). No lock/unlock RPC was
called at any point — hard constraint honored.

### 6a — CSV/PDF: `includePendingExpenses` handling

`ReportPage.tsx` computes `expenseRows` once, already filtered by the
toggle (`status==='paid' || (includePendingExpenses && status==='pending')`),
and hands the *same* array to both `ExpenseBreakdown` and `ExportMenu`.
`ExportMenu.csv()` does no further filtering — it just concatenates
`incomeRows` + `expenseRows` and writes them out, so the CSV correctly
reflects the toggle. `api/report-pdf.ts` does not receive `expenseRows` at
all — it re-fetches the full `accounting_ledger_v` for the date range
server-side (paged past PostgREST's 1000-row cap) and applies the
identical rule itself: `direction==='in' ? status==='paid' : status==='paid'
|| (includePending && status==='pending')`, driven by the `includePending`
query param the client sends from its current toggle state. Both exports
verified correct (🟢).

Cross-reference to Task 4/5c's finding: because `ExpenseBreakdown`'s own
internal grouping hard-codes `status==='paid'` (dropping pending rows the
toggle already includes in its input array), turning the toggle on now
produces a CSV/PDF that includes more expense rows than the on-screen
breakdown table shows for the same period — the export is *correct*, the
breakdown table is the thing that's wrong (already captured as its own
finding in Task 4; noted here only because it also means "what you exported"
and "what the table showed" can diverge while the toggle is on).

The CSV carries no explicit "pending included: Y/N" summary line, but every
row carries its own `status` column, so pending rows are distinguishable
in the file itself — acceptable, no bug.

Minor: `ExportMenuProps.summary: PLSummary` is declared and passed in from
`ReportPage` but never read inside `ExportMenu` (not destructured, not
used) — a dead prop. No functional effect; the CSV never renders a totals
row at all, so `summary` isn't needed for it.

### 6b — CSV escaping

`exportCSV.ts`:
```ts
function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
```
Standard RFC4180-shaped quoting (quote-wrap + double internal quotes,
triggered by comma/quote/LF). Checked against real prod data via SQL
(`task6.risky_ledger_text_values`, `task6.risky_client_deal_names`):

- No `counterparty`/`category_key` value currently present in
  `accounting_ledger_v` contains a comma, quote, or newline (0 rows) — so
  no row exported *today* exercises the escaping path.
- Real risky values do exist one join upstream, in `clients.name` (which
  becomes `counterparty` for any `deal_payments` income row against that
  client): `"ΠΟΛΙΤΙΚΟΣ ΜΗΧΑΝΙΚΟΣ, CIVIL ENGINEERING"`, `"Tassos Bay
  Εστιατόριο , Πιτσαρία , Καφέ , Coctail Bar"`, `"Oia Sunset Villas,
  private villas resort, Santorini"`, and one long free-text name with an
  embedded comma. All contain commas that `escape()`'s regex correctly
  catches and quote-wraps — verified by inspection of the logic (not by
  generating a live payment for that client), so this is a real risky name
  that the code handles correctly, not a live bug.
- One theoretical gap: the regex `/[",\n]/` does not match a bare `\r`
  (CR without LF). A value containing only `\r` would not be quoted, and
  some CSV/Excel parsers treat a lone CR as a row terminator. SQL search
  for bare-CR characters across `counterparty`/`category_key` in the
  ledger view and `vendor`/`clients.name`/`deals.code` in the source
  tables found **zero** matches — theoretical only, no live instance.

No CSV formula-injection guard (a field starting with `=`, `+`, `-`, `@`
would be written verbatim, which Excel can interpret as a formula on
open) — mentioned for completeness; no real risky value found in current
data, low priority, not scored as a finding requiring a decision here.

### 6c — Number formatting

`LedgerRow.amount_net`/`vat_amount`/`amount_gross` are typed (and returned
by PostgREST) as plain JS `number`, not locale-formatted strings — Postgres
`numeric` is serialized as an unquoted JSON number, and `String(value)`
always renders it with `.` as the decimal separator regardless of the UI's
`el`/`en` locale. The "decimal comma breaks the CSV's comma-delimited
columns" scenario the brief asked about does not occur — there is no
locale formatting anywhere between the DB and the CSV (🟢, no bug).

### 6d — PDF endpoint auth

`api/report-pdf.ts`: rejects (400) if `from`/`to` aren't valid ISO dates or
no bearer token is present; resolves the caller via
`userClient.auth.getUser(token)` and rejects (401) if that fails; **then**
does an explicit admin check — `admin.from('profiles').select('is_admin')`
against the caller's own `user_id`, using the service-role client, not the
user's RLS-scoped session — and rejects (403) if `!profile?.is_admin`. The
code comment explains why this is deliberately not inherited from RLS:
`deal_payments` is readable by several non-admin roles, so relying on RLS
would silently hand a non-admin a half-empty document (income visible,
expenses denied) instead of a clean denial. Verified this is a real,
independent gate — an anonymous caller gets 400/401, an authenticated
non-admin gets 403, only an authenticated admin gets the PDF (🟢, no gap).

### 6e — Export totals: recomputed vs reused

- **CSV**: no totals row is written at all — `ledgerRowsToCSV()` emits a
  header line and one line per row, nothing else. It cannot drift because
  it never computes an aggregate; every number in the file is a per-row
  value taken straight from the same `incomeRows`/`expenseRows` arrays
  that feed the on-screen breakdown tables (verified correct in Task 4).
- **PDF**: does not reuse `summary`/`incomeRows`/`expenseRows` props at
  all. It performs its own paged fetch of `accounting_ledger_v` (same
  1000-row-page-safety pattern as `useLedger`), applies the same
  paid/pending counting rule as `pl_summary_for_range`/`ReportPage`, and
  accumulates totals in integer cents (`Math.round(Number(v)*100)`,
  divided back by 100 once at the end) — the same cent-safe pattern used
  elsewhere in the financial-correctness program. Zero drift risk by
  construction: the PDF's numbers can never disagree with a fresh SQL
  query over the same range/toggle, because that's exactly what it runs
  (🟢, no gap, no decision needed).

### 6f — Period locks: current state

`accounting_period_locks` (read-only SQL, `task6.period_locks_recent`):

| period | locked_at (UTC) | locked_by |
|---|---|---|
| 2025-11 | 2026-09-09 07:15:45 | `61b53075-…` |
| 2025-10 | 2026-09-09 07:15:43 | `61b53075-…` |
| 2025-09 | 2026-08-28 10:45:25 | `61b53075-…` |

3 months locked total (`min=2025-09`, `max=2025-11`). 2025-09 was locked
on the financial-correctness program's ship day (2026-08-28); 2025-10 and
2025-11 were both locked this morning (2026-09-09, ~2 minutes before this
audit step ran) by the same user — unrelated to this audit (no lock/unlock
call was ever issued from `report_audit.mjs`; the script has no such call
in any group). Flagged here as context for Task 7/8, not a finding.

- **Decision needed: N.**
- **Verdict: 🟢 informational** — current lock state read correctly; no
  action needed, no bug.

### 6g — `money_period_lock_guard` trigger: coverage (current, live)

**Correction:** the first pass of this section described the guard as
shipped in `20260827190000_accounting_period_locks.sql` only — `BEFORE
UPDATE OR DELETE`, OLD-period-only. That is not the guard's current
state. `20260828120000_lock_guard_hardening.sql` (the very next day,
2026-08-28) rewrote `money_period_lock_guard()` and added two more
triggers. Verified live on prod (`task6.live_period_lock_triggers`), not
re-read from a migration file:

| trigger | table | fires on |
|---|---|---|
| `deal_payments_period_lock_ins_trg` | `deal_payments` | BEFORE INSERT |
| `deal_payments_period_lock_trg` | `deal_payments` | BEFORE UPDATE OR DELETE |
| `expenses_period_lock_ins_trg` | `expenses` | BEFORE INSERT |
| `expenses_period_lock_trg` | `expenses` | BEFORE UPDATE OR DELETE |

All 4 present and enabled, all pointing at the same function. Live
`md5(pg_get_functiondef('public.money_period_lock_guard()'))`
(`task6.live_guard_function_md5`) = `8e0e2f5d0d2bd1fc3bbba4e675f5be0e` —
matches `docs/tech/accounting/financial-controls.md`'s recorded
post-hardening value exactly (line ~406 of that doc; pre-hardening was
`ab233e3b93f945e5f6dd8d18467f9606`). No migration after
`20260828120000_lock_guard_hardening.sql` touches
`money_period_lock_guard` or any `*period_lock*` trigger name (checked:
`grep -l money_period_lock_guard supabase/migrations/*.sql` returns only
the two migrations already named here).

Current body, per row:
```
INSERT:
  if new.status = 'paid':
    v_new_period := to_char(coalesce(new.paid_at::date, new.start_date), 'YYYY-MM')
    if v_new_period is locked: raise  -- blocks writing a paid row straight into a closed month

UPDATE / DELETE:
  v_old_period := to_char(coalesce(old.paid_at::date, old.start_date), 'YYYY-MM')
  v_old_locked := v_old_period is locked

  DELETE:
    if old.status = 'paid' and v_old_locked: raise

  UPDATE:
    v_new_period := to_char(coalesce(new.paid_at::date, new.start_date), 'YYYY-MM')
    v_new_locked := v_new_period is locked
    if (old.status='paid' or new.status='paid') and (v_old_locked or v_new_locked):
        raise if amount_net, vat_rate, status, paid_at, start_date,
                 service_type (deal_payments) / vendor, category_id (expenses)
                 changed between old and new
```

Field coverage unchanged from round 1's check and still holds: `vat_amount`
and `amount_gross` are `GENERATED ALWAYS ... STORED` on both tables
(`round(amount_net + amount_net*vat_rate/100, 2)` and
`round(amount_net*vat_rate/100, 2)`, `task6.generated_amount_columns`) —
they cannot move independently of `amount_net`/`vat_rate`, both already
guarded. No uncovered field (🟢).

### 6h — Event-date convention match (brief's key question)

Pulled `accounting_ledger_v`'s live definition via SQL
(`task6.ledger_view_event_date_definition`): both arms use
`COALESCE(paid_at::date, start_date)` — textually identical to the
guard's period computation on both OLD and NEW. **The convention
matches.** This specific bug hypothesis from the brief (guard using a
different event-date rule than the view) does not hold (🟢).

### 6i — RETRACTED: "directional asymmetry" was a round-1 evidence gap, not a live bug

**Round 1 of this section claimed the guard was directionally
asymmetric** — that it checked only the row's OLD period and only fired
when `old.status='paid'`, leaving three paths (fresh INSERT, pending→paid
promotion, and reattribution from an open month) able to silently move
money into a locked month. **That characterization was wrong, and is
retracted.** It was built entirely from
`20260827190000_accounting_period_locks.sql`, the single migration the
brief named — round 1 never checked whether a later migration touched
the same function, and one did, the very next day.

`20260828120000_lock_guard_hardening.sql`'s own header names this exact
gap and closes it (see 6g above for the resulting live behavior):

> *"(a) UPDATE only ever computed the row's period from OLD... Fixed by
> computing v_old_period AND v_new_period and gating on `v_old_locked or
> v_new_locked`... (b) INSERT was not guarded at all... Fixed by teaching
> the SAME function an INSERT branch... and attaching it via two NEW
> triggers."*

Re-checked against the actual current guard (6g) and live prod state,
each of round 1's three claimed paths is now closed:

| Round-1 claimed gap | Current status |
|---|---|
| Fresh INSERT of a paid row dated into a locked month | **Closed** — `BEFORE INSERT` arm raises if `new.status='paid'` and its period is locked |
| Pending row in a locked month promoted to paid | **Closed** — UPDATE now gates on `old.status='paid' OR new.status='paid'`, not `old.status='paid'` alone |
| Paid row in an open month re-dated into a locked month | **Closed** — UPDATE now checks `v_old_locked OR v_new_locked`, not just `v_old_locked` |

Round 1's "0 rows created after lock" spot-check
(`task6.locked_period_insert_gap_spotcheck`) is still true, but it does
**not** mean "an unexploited gap" as round 1 framed it — with the INSERT
trigger live since 2026-08-28, that query most likely shows the trigger
*working* (nothing gets through to be counted), not a gap sitting open
and merely unused. `financial-controls.md`'s Layer 2 section already
states the correct, current guarantee: **"no paid money enters, leaves,
or changes in a locked month"** — verified live above, not just
documented (🟢, **no decision needed — already hardened, 2026-08-28**).

**Methodology note for Task 8:** this is a single-migration evidence gap,
not a misreading of the code that was read. The brief pointed at
`20260827190000_accounting_period_locks.sql` by name for this step, and
round 1 treated that pointer as the complete picture instead of checking
whether the named object (`money_period_lock_guard`) was touched again
later. The fix here was mechanical once flagged: `grep -l
money_period_lock_guard supabase/migrations/*.sql` immediately surfaces
both migrations. Any future step that reviews a named trigger/function
from a named migration should run that grep first, before concluding
what the object currently does.

### 6j — Realtime invalidation: `accountingClientFlow`

`src/features/accounting_report/hooks/useDealPaymentsRealtime.ts` calls
the shared `invalidateFinancialReports(qc)`
(`src/lib/financialInvalidations.ts`), which invalidates:
`['accounting-ledger']`, `['accounting-pl-summary']`, `['accounting-mrr']`,
`['dashboard-monthly-pl']`, `['dashboard-recurring-collected']`.

`src/features/accounting_report/hooks/useExpensesRealtime.ts` invalidates
its own inline, *shorter* list: `['expenses']`, `['expense']`,
`['accounting-ledger']`, `['accounting-pl-summary']` — missing
`accounting-mrr` and both dashboard keys that the deal-payments hook
covers. Noted in passing as a related, separate minor finding: an expense
INSERT/UPDATE/DELETE does not live-refresh the MRR tile or the Dashboard's
monthly-P&L/recurring-collected widgets, only a deal-payments change does.

Neither hook's list — nor `financialInvalidations.ts`'s
`FINANCIAL_REPORT_KEYS` — includes `queryKeys.accountingClientFlow(from,
to)` (`['accounting-client-flow', from, to]`, confirmed via
`src/features/accounting_report/hooks/useClientFlow.ts` /
`src/lib/queryKeys.ts`). The Client Flow section (Task 5) does not
auto-refresh when a payment is marked paid, an expense changes, a deal is
created, or a client is stopped — it only reflects fresh data on a manual
page reload or the next natural refetch. Confirmed as the brief
anticipated (🟡, minor, decision needed — most likely an accepted gap
given Client Flow is a lower-cadence, retrospective view rather than a
live counter, but flagging per the brief's instruction rather than
silently deciding it's fine).

### Summary — Task 6

| # | Item | Verdict | € / exposure | Decision needed |
|---|---|---|---|---|
| 6a | CSV/PDF both correctly honor `includePendingExpenses`; unused `summary` prop on `ExportMenu` (dead code, no effect) | 🟢 | n/a | N |
| 6b | CSV escaping correct against real risky prod names (commas in client names); bare-`\r` not covered by the escaping regex but zero live instances found | 🟢 | 0 rows affected today | N |
| 6c | Amounts are plain JS numbers end-to-end — no locale decimal-comma CSV corruption risk | 🟢 | n/a | N |
| 6d | `api/report-pdf.ts` has a real, independent admin gate (bearer auth + explicit `profiles.is_admin` check against service-role client, not RLS-inherited) | 🟢 | n/a | N |
| 6e | CSV has no totals row (nothing to drift); PDF independently re-fetches and recomputes totals server-side — zero drift risk in either export | 🟢 | n/a | N |
| 6f | 3 months currently locked (2025-09/10/11); 2025-10/11 locked this morning, unrelated to this audit | 🟢 informational | n/a | N |
| 6g | Guard's field list is complete — `vat_amount`/`amount_gross` are `GENERATED ALWAYS` from already-guarded `amount_net`/`vat_rate`. Guard is the hardened version live: `BEFORE INSERT` + `BEFORE UPDATE OR DELETE` on both tables, 4/4 triggers confirmed live, function md5 matches `financial-controls.md`'s documented post-hardening value | 🟢 | n/a | N |
| 6h | Guard's `coalesce(paid_at::date, start_date)` period convention textually matches the ledger view's, on both old and new period — brief's specific mismatch hypothesis does not hold | 🟢 | n/a | N |
| 6i | **RETRACTED.** Round 1 claimed a directional asymmetry (OLD-period-only, `old.status='paid'`-only) sourced entirely from `20260827190000`, the single migration the brief named. `20260828120000_lock_guard_hardening.sql` (next day) already closed all 3 claimed paths (INSERT arm + both-sides period check + `old-or-new status='paid'` gate) — verified live on prod, matching `financial-controls.md`'s documented guarantee. No migration after it touches the guard | 🟢 | 0 € impact, and the design gap itself no longer exists | N — already hardened 2026-08-28 |
| 6j | Neither realtime hook (nor the shared `financialInvalidations` helper) invalidates `accountingClientFlow` — Client Flow doesn't auto-refresh on payment/expense changes; `useExpensesRealtime`'s own list is also narrower than `useDealPaymentsRealtime`'s (missing MRR/dashboard keys) | 🟡 | UX staleness only, no € impact | Y |

**No CSV/PDF export bugs found — both correctly honor the toggle, escape
real risky prod data correctly, and never trust client-supplied totals.
Period locks are fully hardened as of 2026-08-28 (`20260828120000_lock_
guard_hardening.sql`): the guard now blocks paid money from entering,
leaving, or changing in a locked month, on INSERT, UPDATE, and DELETE
alike — verified live against prod (4/4 triggers, function md5 match),
not just against migration files. Round 1 of this section had wrongly
flagged this as an open structural gap by only reading the single
migration the brief named; that finding is retracted in 6i, with the
methodology note carried to Task 8 (always `grep` for later touches to a
named function before concluding what it currently does). Realtime
invalidation for Client Flow is the one remaining minor gap in this task
— 1 decision needed on whether it's worth wiring up.**

<!-- ============================== TASK 7 ============================== -->

## Task 7 — Live-site visual confirmation (UI vs fresh DB)

Browser: `claude-in-chrome`, admin session already logged in (per the
brief), one new tab, navigated to `https://www.itdevcrm.com/accounting/
report`. **Only navigation, clicks on non-destructive rows/tiles/checkbox,
and screenshots were performed — no Lock/Unlock button, no delete/edit
button, and no expense-creation button was ever clicked.** The report
page's own "This month" default is September 2026
(`2026-09-01`..`2026-09-30`), identical to every other task's range.

**Timing discipline:** every SQL comparison below was re-run via `node
report_audit.mjs <task2|task3|task4|task5>` (full groups, read-only,
`assertReadOnly`-guarded) within seconds to low-minutes of the matching
screenshot — never against the earlier tasks' now-hours-stale snapshots.
Raw logs: `<scratchpad>/task7_task2_fresh.log`, `task7_task3_fresh.log`,
`task7_task4_fresh.log`, `task7_task5_fresh.log` (all HTTP 201, 0
failures). Every comparison below tied out exactly on the first fresh
re-run — no drift was observed at any point in this pass, and no number
required a second re-query.

**Fix round (post-review):** task review of the original pass found 1
Important gap (item 34 had no SQL backing at all — see 7e) and 3 Minor
disclosure gaps (truncated raw logs not flagged; the Renewals bucket had
no row-level spot check; the toggle-ON timing gap wasn't itemized). A
`task7_fix` query group was added to the runner and re-run
(`<scratchpad>/task7_fix_run.log`, 4 queries, all HTTP 201) to close all
four — see the corrected 7e, the disclosure notes in 7c/7d, and the new
7g. No browser session was reopened for the fix round; the 10 stopped-
client rows already recorded from the screen were sufficient to check
against the new SQL.

### 7a — Four P&L KPI tiles + YTD strip

Screenshot: report page top, "This month" selected, toggle off
(`screenshot-1788955274465-1.jpg`).

| Tile | UI | Fresh SQL (`task2`, `pl_summary_for_range('2026-09-01','2026-09-30',false)`) | Match |
|---|---|---|---|
| Total income | €20373.58 (€16861.91 net) | gross 20373.58 / net 16861.91 | ✓ |
| Total expenses | €9626.54 | gross 9626.54 / net 9626.54 | ✓ |
| Net profit | €10747.04 (€7235.37 net) | gross 10747.04 / net 7235.37 | ✓ |
| MRR headline | €59984.81 | `useContractedMRR` total (task3, 2-contracted (c)): 59984.8075 → €59984.81 | ✓ |
| YTD income | €296600.24 | `pl_summary_for_range('2026-01-01','2026-12-31',false)`.total_income_gross = 296600.24 | ✓ |
| YTD expenses | €26019.94 | .total_expense_gross = 26019.94 | ✓ |
| YTD net profit | €270580.30 | .net_profit_gross = 270580.30 | ✓ |

All 7 figures match to the cent. Re-confirms 2a/2b's earlier finding: the
arithmetic is exact; 2b's YTD-label-vs-full-calendar-year mislabel is a
labeling issue, not a numbers issue, and is out of scope for a visual
number check (nothing on screen is wrong today — see 2b for the € detail).
(This pass's income net reads €16861.91, not 2a's earlier €16681.91 —
+€180.00, 71→72 rows — the same intraday ΚΑΡΑΜΠΟΙΚΗ ΝΙΚΗ ΚΩΝΣΤΑΝΤΙΝΟΣ
payment identified in 4a, landing between the two runs; normal partial-
month drift, not a discrepancy.)

- **Verdict: 🟢 all match.**

### 7b — MRR tile: headline (contracted) + "collected in period" caption

Same screenshot as 7a. Caption read as English "collected in period" (the
account's locale at the time of this pass), not the Greek "εισπράχθηκαν
στην περίοδο" quoted in the brief/Task 3 — same string, different i18n
locale, not a discrepancy.

| | UI | Fresh SQL (`task3`) | Match |
|---|---|---|---|
| Headline (contracted, NET) | €59984.81 | 2-contracted (c): 59984.8075 | ✓ |
| Caption (collected, GROSS) | €71511.66 | 1-collected "UI way" (billing-period overlap, exactly as `useMRR.ts`): 71511.66 | ✓ |

Both numbers match their respective hooks' queries exactly — confirms 3a/
3d's findings are about *definition*, not arithmetic: the €71511.66 is
correctly computed billing-period-overlap revenue, it just isn't what
"collected in the period" means to a reader (3a, 🔴, decision needed); the
tile mixes NET headline with GROSS caption with no basis label (3d, 🟡,
decision needed). Both already-recorded, nothing new found live.

- **Verdict: 🟢 (numbers correct)**, existing 🔴/🟡 definitional findings
  from Task 3 visually reconfirmed, not new.

### 7c — Income breakdown (per service) + Expense breakdown (per category) + pending-toggle bug

Screenshots: `screenshot-1788955324794-2.jpg` (income top rows + client
flow tiles), `screenshot-1788955369793-3.jpg` (income full 8 rows +
expense breakdown, toggle off), `screenshot-1788955390050-5.jpg` (toggle
ON — KPI expense tile changes to €9914.54), `screenshot-1788955402892-6.jpg`
(toggle still ON — expense breakdown table, byte-identical to the
toggle-off screenshot).

**Income by service** (UI vs fresh `task4` query `1-income`, direction=in
status=paid):

| Service (UI label) | Count | Net | VAT | Gross | Match |
|---|---|---|---|---|---|
| Local SEO | 30 | €5877.87 | €1276.30 | €7154.17 | ✓ |
| AI SEO | 10 | €3103.55 | €658.45 | €3762.00 | ✓ |
| Web SEO | 8 | €2429.85 | €475.16 | €2905.01 | ✓ |
| Web Dev | 6 | €2290.00 | €408.00 | €2698.00 | ✓ |
| Ads | 8 | €1370.97 | €329.03 | €1700.00 | ✓ |
| Social Media | 4 | €1229.03 | €258.97 | €1488.00 | ✓ |
| Hosting | 4 | €480.00 | €86.40 | €566.40 | ✓ |
| Support (= `maintenance` key) | 2 | €80.64 | €19.36 | €100.00 | ✓ |

All 8 rows match exactly (72 rows / €20373.58 gross total, ties to 7a's
income tile). "Support" is the UI's translated label for the
`maintenance` service key — same row, correct translation, not a
mismatch.

**Expenses by category, toggle OFF** (UI vs fresh `task4` query
`2-expense`, direction=out status=paid):

| Category (UI label) | Count | Net | VAT | Gross | Match |
|---|---|---|---|---|---|
| Salaries | 5 | €4376.18 | €0.00 | €4376.18 | ✓ |
| Software | 14 | €2818.36 | €0.00 | €2818.36 | ✓ |
| Rent | 1 | €1450.00 | €0.00 | €1450.00 | ✓ |
| Other | 5 | €502.00 | €0.00 | €502.00 | ✓ |
| Ads spend | 1 | €470.00 | €0.00 | €470.00 | ✓ |
| Hosting & Domains | 1 | €10.00 | €0.00 | €10.00 | ✓ |

All 6 rows match exactly (27 rows / €9626.54 gross, ties to 7a's expense
tile).

**Toggle "Include unpaid expenses" ON — the known bug (4b), confirmed
live:**

- KPI tile: Total expenses moved €9626.54 → **€9914.54**, Net profit
  €10747.04 → **€10459.04** (€7235.37 → €6947.37 net) — matches fresh
  `pl_summary_for_range('2026-09-01','2026-09-30', true)` exactly
  (`total_expense_gross=9914.54`, `net_profit_gross=10459.04`). YTD strip
  also moved (expenses €26019.94 → €84125.80, matches
  `pl_summary_for_range('2026-01-01','2026-12-31', true)` exactly).
- "Expenses by category" table: **unchanged** — same 6 rows, same counts,
  same €9626.54 total, screenshot-identical to the toggle-off state. The
  4 pending rows (€288.00: 3×software + 1×other, per Task 4's finding)
  that the KPI tile now includes never appear in this table.
- This is Task 4's finding 4b (`ExpenseBreakdown.tsx`'s own `groups`
  `useMemo` hard-codes `status !== 'paid'` exclusion, ignoring the toggle
  `ReportPage` already applied to the rows it hands down) — **visually
  confirmed live on the actual production screen**, not just in code, with
  a live screenshot pair as the record.

**Timing note (fix round, was Minor 3):** the toggle-ON screenshots were
taken at **15:03:10** (KPI tiles) and **15:03:22** (breakdown table
unchanged), but the `pl_summary_for_range(...,true)` SQL they were
compared against was fetched earlier, at **15:01:27** (`task2`'s single
run, which returns both toggle states in one pass) — a **~1m43s–1m55s
gap**. This was originally covered only by the pass's blanket timing
claim, not itemized. Closed in the fix round: `task7_fix`'s
`minor3-fix` query re-ran the identical `pl_summary_for_range('2026-09-01',
'2026-09-30', true)` call at **15:14:13**, ~13 minutes after the original
fetch (a strict superset of the 2-minute gap actually being checked).
Result: **expense figures were byte-identical** across the whole 13-minute
span (`total_expense_net`/`total_expense_gross` = 9914.5400/9914.54 both
times, `expense_rows` = 31 both times) — empirical proof, not just a
low-risk assumption, that the specific figures gated by the toggle (and
therefore the only figures this comparison depended on) did not move in
the 2-minute window between fetch and screen-read. **Income did move** in
that same 13-minute span (`total_income_gross` 20373.58 → 20593.58,
`income_rows` 72 → 73, +€220.00/+1 row — traced in 7d's fix-round note to
one new Local SEO payment, deal `005023`, dated 2026-09-09) — but income
is not gated by this toggle and was never part of the toggle-ON
comparison; it's normal same-day prod drift, landed sometime after the
last income comparison in this pass had already matched (7a, 15:01:14
screen vs 15:01:27 SQL, 13-second gap, exact match at the time), so it
does not affect any recorded verdict.

- **Verdict: 🟢** for both breakdown tables' own numbers (exact match to
  fresh SQL). **🔴 reconfirmed live** for the pending-toggle gap (4b) —
  same €288.00/4-row size as Task 4 found via SQL, now also visually
  proven on screen, with the toggle-ON timing gap empirically closed
  above.

### 7d — Local SEO income drawer

Screenshot: `screenshot-1788955377867-4.jpg`.

Clicked the "Local SEO" row in Income by service; drawer opened showing
"**30 transactions**", header sums **NET €5877.87 · VAT €1276.30 · GROSS
€7154.17** — matches 7c's Local SEO row and Task 4d's `3-drawer` fresh SQL
(30 rows, net 5877.87, vat 1276.30, gross 7154.17) exactly. Client codes
visible on every row (`005279`, `000866`, `000129`, `001318`, `000047`,
`000224`, `000261`, `000045`, `006827`, `000282`, …, 10 visible before
scroll) — confirms 4d's `deal_code` prefix finding (`e7f7010`) is real on
the live screen, not just in the SQL sample. Rows show status ("Paid"),
billing type ("Monthly"), and net/VAT split per row, all consistent with
`TransactionDrawer.tsx`'s known rendering.

- **Verdict: 🟢 verified correct** — drawer count, header sums, and client
  codes all match fresh SQL exactly.

**Disclosure (fix round, was Minor 1):** the header sums/count above are
solid (a separate, small aggregate query — `task4`'s `3-drawer` "group"
query — always returned intact). But `task4`'s companion **row-level**
listing query (`3-drawer: Local SEO Sept 2026 row-level detail`, meant to
back a manual click-through match) silently truncated mid-JSON in
`task7_task4_fresh.log` around line 546 — not a data-fetch failure, but
the runner's own `q()` helper hard-caps what it *prints* to the console
at `.slice(0, 8000)` characters; the fetched `parsed` result in memory was
always complete, only the printed log was cut, and the original report
never flagged this. This was not silently trusted as evidence for
anything scored above (the count/sum/`deal_code`-presence claims all rest
on separate, un-truncated aggregate queries), but it went undisclosed.
Fixed: `task7_fix`'s `minor1-fix` query re-ran the same listing with
narrower columns (dropped the two UUID columns and `status`) so nothing
is cut. Re-run at 15:14:13 (11 minutes after the original 15:02:57
screenshot) returned **31 rows / €7374.17 gross** — 1 more row and
+€220.00 than the original 30/€7154.17, which is the *same* new payment
(deal `005023`, "Θάνος Καραθάνος Μεταφορική Εταιρεία", net/gross €220.00,
0% VAT, dated 2026-09-09) already identified in 7c's timing note as the
cause of the income drift seen there — it is not in the original
screenshot's visible rows and was not counted in this section's 30-row
verdict, which remains correct **for the moment it was taken**. The
31-row re-run exists solely to demonstrate the truncation fix (intact
JSON, all rows present); it is not a re-verification of the original
screenshot, which would require reopening the browser (out of scope for
this fix round per the review's own instruction).

### 7e — Client flow section (September 2026)

Screenshots: `screenshot-1788955324794-2.jpg` (tile counts, collapsed),
`screenshot-1788955421099-7.jpg` (Clients stopped expanded, 10 of 44 rows
visible), plus one unsaved screenshot of the New deals tile expanded (4
rows) and one of a successful deal-link navigation.

| Tile | UI count | Fresh SQL (`task5`, "0: September 2026 kind counts") | Match |
|---|---|---|---|
| New deals | 4 | new_deal: 4 | ✓ |
| Clients stopped | 44 | stopped_client: 44 | ✓ |
| Renewals (clients) | 52 | renewal_client: 52 | ✓ |

All 3 tiles match Task 5's fully-reconciled counts exactly (5d/5f/5g) —
no further drift since Task 5's own last check.

**New deals, expanded (4/4 rows):** `006258 ΙΚΟΥΤΑΣ ΒΑΣΙΛΕΙΟΣ` (2026-09-04),
`006148 ΚΟΣΜΑΣ ΧΡΗΣΤΟΣ ΣΥΣΤΗΜΑΤΑ ΤΕΧΝΟΛΟΓΙΑΣ Ι.Κ.Ε` (2026-09-03), `007099
ΠΑΠΑΣΑΒΒΑΣ ΑΥΓΕΡΙΝΟΣ` (2026-09-04), `000991 PRAXIS HARMONY GROUP Ε.Ε.`
(2026-09-08) — client codes present on every row, and the dates match the
4 clients Task 5c/5f already identified as September's new-deal/first-ever
payers. **Clicked the `006258` code** — it is a real, working deal link:
navigated to `/deals/940628a3-bce8-4e18-90be-68b78aedb601` (a genuine
UUID deal route, not a dead link or a no-op).

**Clients stopped, expanded (10/44 rows visible without scrolling):**
`002105 Αλέξανδρος Βάκρινος Μηχανολόγος Μηχανικός`, `000341 ΒΑΙΤΣΟΥ
ΧΡΥΣΟΥΛΑ ΤΟΥ ΠΑΝΑΓΙΩΤΗ`, `000272 ΓΕΩΡΓΙΟΣ ΜΠΟΝΕΛΗΣ`, `005618 ΓΚΟΥΡΟΜΠΙΝΟΣ
ΜΑΡΙΟΣ ΔΗΜΗΤΡΙΟΣ`, `005240 ΔΑΤΣΕΡΗΣ ΝΙΚΟΛΑΟΣ ΙΩΑΝΝΗΣ`, `001286 Ελεύθερος
Επαγγελματίας`, `005599 Ι ΜΠΑΜΠΑΛΗΣ ΚΑΙ ΣΙΑ Ε.Ε.`, `000477 ΙΩΑΝΝΗΣ ΛΥΡΑΣ
ΙΔΙΩΤΙΚΟ ΙΑΤΡΕΙΟ ΙΑΤΡΙΚΗ ΜΟΝΟΠΡΟΣΩΠΗ ΕΠΕ`, `003117 ΚΑΡΑΤΖΟΓΙΑΝΝΗ ΑΘΗΝΑ
ΛΕΩΝΙΔΑΣ`, `000505 ΚΟΛΛΙΑΣ ΠΑΝΑΓΙΩΤΗΣ ΓΡΗΓΟΡΙΟΣ`, 9 of the 10 dated
`2026-09-08`, `001286 Ελεύθερος Επαγγελματίας` dated `2026-09-01`.

**Correction (fix round, was Important item 34):** as originally written,
this claim of "codes + dates match" had **zero SQL backing** — the only
query that could have supported it, `task5`'s combined "September 2026
full inline-RPC result set" (all 3 kinds together, ordered `kind,
client_name`), truncated in `task7_task5_fresh.log` at line 335 *before
reaching any `stopped_client` row at all* (`new_deal` sorts first
alphabetically, then `renewal_client`, then the 8000-character print cap
hit mid-`renewal_client`). The 10 rows/dates above were transcribed from
the screenshot only, never checked against the DB. **Fixed:**
`task7_fix`'s `34-fix` query selects `kind='stopped_client'` rows only
(client_code, client_name, event_date — 44 short rows, well under the
print cap) and was run fresh
(`<scratchpad>/task7_fix_run.log`, 15:14:13). **All 10 of the
screen-recorded rows above match the fresh SQL exactly, code for code,
name for name, date for date** — including the one distinct date,
`001286 Ελεύθερος Επαγγελματίας` → `2026-09-01` in both the screenshot and
the SQL. This is now genuine evidence, not merely internally-consistent
narrative matching 5d's already-published list.

The full 44-row fresh result also lets this section correct an imprecise
citation: the original text said "9 of the 10 visible rows show
`2026-09-08` (the mass End-batch day, **5f**)" and implied that ties to
5f's "40 of the 44 (91%)" figure. The two are related but not the same
count — 5f's 40/44 is specifically the **local_seo-service** subset of
the Sept-8 batch (its own per-service breakdown: local_seo 40 + ads 2 +
social_media 2 + ai_seo 1, before de-duplicating 3 double-appearances).
The fresh `34-fix` query counts *every* `stopped_client` row by its raw
`event_date`, any service: **42 of 44 (95%) are dated `2026-09-08`**, 1 is
`2026-09-01` (`001286`), and 1 is `2026-09-04` (`006210 ΠΑΠΑΔΑΚΗΣ
ΔΗΜΗΤΡΙΟΣ του ΑΝΤΩΝΙΟΥ` — not visible in the 10-row screen sample). 42 is
consistent with 5f's 40 (the 2 extra are the ads/social_media Sept-8
batch members 5f's own breakdown already names) — not a contradiction,
just a tighter, single-query confirmation that didn't exist before this
fix round.

Client codes are present on every row; **clicking a stopped-client row
did not navigate anywhere** — expected and correct, since
`stopped_client` (per 5e) is `GROUP BY client_id` with no `deal_id`,
unlike `new_deal`'s `client_id`/`deal_id` pair.

**Renewals — row-level spot check (fix round, was Minor 2):** the
original pass verified the Renewals tile at the **aggregate level only**
(count = 52, matches `task5`'s kind-count query) — the "Renewals (clients)"
tile was never clicked/expanded during the live browser pass, so **no
screenshot or recorded screen value exists for any individual renewal
row**. `task7_fix`'s `minor2-fix` query pulled a 10-row DB-side sample
(`kind='renewal_client'`, ordered by `client_code`, narrow columns) as a
spot check of what the RPC itself returns:

| Client code | Name | event_date |
|---|---|---|
| 000045 | ΚΑΝΑΚΗΣ ΝΙΚΟΛΑΟΣ ΔΗΜΗΤΡΙΟΣ | 2026-09-07 |
| 000047 | MEAT PP ΜΟΝΟΠΡΟΣΩΠΗ ΙΚΕ | 2026-09-08 |
| 000049 | ΥΔΡΑΥΛΙΚΑ ΜΑΡΓΕΤΗΣ | 2026-09-03 |
| 000060 | ΠΑΡΑΣΚΕΥΑΙΔΗΣ ΝΙΚΟΛΑΟΣ ΚΟΜΝΗΝΟΣ | 2026-09-07 |
| 000090 | www.dctrade.gr | 2026-09-02 |
| 000118 | SBOKOS DECO ART Ο Ε\|\|SBOKOS DECO ART | 2026-09-07 |
| 000129 | ΚΑΡΑΜΠΟΙΚΗ ΝΙΚΗ ΚΩΝΣΤΑΝΤΙΝΟΣ | 2026-09-09 |
| 000136 | ΚΑΝΑΚΗ ΜΑΡΙΑ ΧΡΙΣΤΟΦΟΡΟΣ | 2026-09-02 |
| 000158 | ΝΤΑΗΣ ΓΕΩΡΓΙΟΣ ΣΩΤΗΡΙΟΣ | 2026-09-07 |
| 000173 | Α. ΧΑΤΖΗΓΕΩΡΓΙΟΥ ΚΑΙ ΣΙΑ ΟΕ | 2026-09-03 |

**Stated plainly, as the review asked: this table is DB-side evidence
only — it was not, and cannot be, cross-checked against anything read
from the live screen in this pass**, since the Renewals tile was never
expanded/screenshotted. It confirms the RPC returns well-formed rows with
real client codes for the `renewal_client` kind (useful groundwork for a
future pass that does expand the tile), but it is **not** a UI-vs-DB
match for this pass the way 7e's `stopped_client`/`new_deal` checks are.

- **Verdict: 🟢 verified correct** — all 3 tile counts match fresh SQL
  exactly; `stopped_client` expand now has genuine row-level SQL backing
  (10/10 screen-recorded rows match, including the one distinct date);
  `new_deal` rows are working deal links (verified by clicking one);
  `stopped_client` rows correctly have no deal link (client-level metric,
  not deal-level, by design). **Renewals remain aggregate-only-verified**
  — the count matches, but no individual renewal row was ever compared
  screen-to-DB in this pass (disclosed above, not hidden).

### 7f — Period lock control (admin, visible only — nothing pressed)

Screenshot: `screenshot-1788955274465-1.jpg` (Open months) +
`screenshot-1788955421099-7.jpg`'s scroll position (Locked months).

"Period locks" section is visible with the admin-only explanatory text
("Locking a month freezes every paid row it contains…") and one row per
month with a **Lock**/**Unlock** button. September 2026 through December
2025 all show "Open" with a **Lock** button; November 2025, October 2025,
and September 2025 show "Locked" with an **Unlock** button — exactly
matching Task 6f's fresh `period_locks_recent` read (3 months locked:
2025-09/10/11). **No Lock or Unlock button was clicked at any point in
this pass** (hard constraint from the brief, honored).

- **Verdict: 🟢** control is visible and its state matches fresh SQL
  exactly; correctly not exercised.

### Summary — Task 7 (UI vs DB)

| # | Item | UI | Fresh SQL | Match | Verdict |
|---|---|---|---|---|---|
| 7a.1 | Total income tile | €20373.58 / €16861.91 net | task2 `1-sep` false: 20373.58 / 16861.91 | ✓ | 🟢 |
| 7a.2 | Total expenses tile | €9626.54 | task2 `1-sep` false: 9626.54 | ✓ | 🟢 |
| 7a.3 | Net profit tile | €10747.04 / €7235.37 net | task2 `1-sep` false: 10747.04 / 7235.37 | ✓ | 🟢 |
| 7a.4 | MRR headline | €59984.81 | task3 `2-contracted (c)`: 59984.8075 | ✓ | 🟢 |
| 7a.5 | YTD income/expense/net | €296600.24 / €26019.94 / €270580.30 | task2 `1-ytd` false: same 3 figures | ✓ | 🟢 |
| 7b | MRR "collected in period" caption | €71511.66 | task3 `1-collected` UI way: 71511.66 | ✓ | 🟢 (🔴/🟡 definitional findings from 3a/3d reconfirmed, not new) |
| 7c.1 | Income by service, 8 rows | see table 7c | task4 `1-income` | ✓ all 8 | 🟢 |
| 7c.2 | Expense by category, 6 rows (toggle off) | see table 7c | task4 `2-expense` | ✓ all 6 | 🟢 |
| 7c.3 | Toggle ON: KPI expense/net-profit/YTD-expense move, breakdown table frozen | €9626.54→€9914.54 (KPI); table unchanged | task2 `1-sep`/`1-ytd` true: 9914.54 / 84125.80; timing gap (15:01:27 fetch vs 15:03:10/22 screen) closed by `minor3-fix` re-run at 15:14:13 — expense figures unchanged across the full 13 min | ✓ (bug reconfirmed, timing gap closed empirically) | 🔴 (4b, pre-existing, now visually confirmed) |
| 7d | Local SEO drawer: count + net/vat/gross + client codes | 30 / €5877.87 / €1276.30 / €7154.17, codes visible | task4 `3-drawer` (aggregate, intact) + `minor1-fix` re-run (row-level, un-truncated) | ✓ (aggregate); row-level listing was truncated in the original log — re-run intact, showed 1 new drifted row (+€220, after this verdict's moment) | 🟢 |
| 7e.1 | Client flow tile counts (Sept 2026) | new 4 / stopped 44 / renewals 52 | task5 kind counts: 4 / 44 / 52 | ✓ | 🟢 |
| 7e.2 | New deals expand: codes + working deal link | 4 rows, codes present, `006258` navigates to a real deal | matches 5c/5f client list | ✓ | 🟢 |
| 7e.3 | Clients stopped expand: codes, dates, no deal link | 10/44 rows checked, codes+dates match, no navigation on click | `task7_fix` `34-fix` (fresh, `stopped_client`-only, un-truncated) — was previously cited to the truncated combined log with zero actual backing | ✓ (10/10 rows, now genuinely SQL-backed) | 🟢 |
| 7e.4 | Renewals expand: row-level check | **not performed** — tile never clicked/expanded in this pass, aggregate count only | `task7_fix` `minor2-fix`, 10-row DB-side sample (no screen counterpart) | N/A — no UI value exists to compare | 🟡 aggregate-only-verified (disclosed, not a defect) |
| 7f | Period lock control visible, correct state, not exercised | 3 Locked (Sep/Oct/Nov 2025), rest Open | task6 `period_locks_recent`: same 3 | ✓ | 🟢 |

**0 new bugs found in this pass** (the fix round's 4 items were review
gaps in this pass's own evidence trail, not newly-discovered product
defects). Every number checked against a fresh SQL re-run matched — no
persistent mismatch, no arithmetic surprise. The two pre-existing issues
this pass was told to expect (3a/3d's MRR caption/basis mismatch, 4b's
expense-breakdown pending-toggle gap) were both visually reconfirmed on
the actual production screen, with screenshots as the record, matching
their already-recorded € sizes exactly. The fix round closed 1 Important
gap (item 34/7e.3 had no SQL backing at all — now does, 10/10 match) and
3 Minor gaps (2 truncated logs disclosed and superseded by intact
re-runs; the Renewals tile's row-level state is now explicitly labeled
"aggregate-only-verified" rather than silently implied to be as thorough
as `new_deal`/`stopped_client`; the toggle-ON timing gap is now an
itemized, empirically-closed note rather than a blanket claim). One piece
of ordinary same-day prod drift surfaced by the fix round's re-runs (+1
Local SEO payment, deal `005023`, €220.00, landed after this pass's
relevant comparisons had already matched) — normal, not a finding, per
the same "prod moves during the day" pattern this whole audit already
expects and documents (Task 4a). The hard constraint (no lock/unlock, no
delete/edit, no expense creation) was honored throughout, in both rounds
— the only state-changing UI action taken in either round was toggling
"Include unpaid expenses" on and back off, a client-side display filter
with no server mutation; the fix round used no browser session at all.

**Screenshots taken (saved to disk):**
1. `screenshot-1788955274465-1.jpg` — KPI tiles, YTD strip, Period locks (Open months), toggle off.
2. `screenshot-1788955324794-2.jpg` — Client flow tiles (collapsed) + Income by service (top rows).
3. `screenshot-1788955369793-3.jpg` — Income by service (all 8 rows) + Expenses by category (toggle off).
4. `screenshot-1788955377867-4.jpg` — Local SEO income drawer open (30 transactions, header sums, client codes).
5. `screenshot-1788955390050-5.jpg` — Toggle "Include unpaid expenses" ON: KPI expense/net-profit/YTD tiles changed.
6. `screenshot-1788955402892-6.jpg` — Toggle still ON: Expenses by category table unchanged (bug 4b confirmed live).
7. `screenshot-1788955421099-7.jpg` — Client flow, "Clients stopped" tile expanded (10/44 rows, codes + dates).

(Several additional screenshots were taken during interaction — drawer
close, New deals expand, the deal-link click, period-lock scroll — but not
saved to disk; their content is described inline above.)

**Fix-round disclosure (was Minor 1):** two of the four original raw logs
truncated mid-JSON — `task7_task4_fresh.log` (~line 546, the Local SEO
row-level listing) and `task7_task5_fresh.log` (line 335, the combined
new_deal/renewal_client/stopped_client listing, cut before any
`stopped_client` row). Root cause: the runner's `q()` helper prints
`JSON.stringify(parsed, null, 1).slice(0, 8000)` to the console — a
hard 8000-character cap on the *printed log only*; the fetched `parsed`
result in memory was always complete and every aggregate figure sourced
from these two logs elsewhere in this report is correct, but the raw logs
themselves are incomplete records and the original write-up never said
so. Fixed going forward by adding narrower, targeted queries (fewer/
shorter columns, `kind`-filtered) in `task7_fix` rather than widening the
cap — `<scratchpad>/task7_fix_run.log` (4 queries, all HTTP 201, 0
truncation) supersedes the truncated portions of both original logs.
