# Domain expiry reconciliation — 2026-08-05

## Source file

`~/Downloads/Domains_Expiry_List_Final.xlsx`, sheet 1, 48 data rows, read 2026-08-05.

---

## Background — what discovery found (2026-08-05)

Read this before touching anything; it is the whole justification for the change.

**The source file.** `~/Downloads/Domains_Expiry_List_Final.xlsx` holds 48 domains in three columns
(`Domain`, `Expiry Date`, `Had Deal`). 21 rows carry `Had Deal = no` — no deal ever existed, so
there is nothing in accounting to correct; **they are out of scope** (owner decision, 2026-08-05).
The remaining 27 rows have a blank `Had Deal` cell and are the targets.

**The match.** Prod has exactly **27 non-archived `jobs` rows with `service_type = 'domains'`**, and
they map one-to-one onto the 27 target rows — a perfect bijection, no leftovers on either side.
`jobs.details` is `{}` on all 27 (the `domain` info field defined in
`src/features/jobs/serviceInfoFields.ts:57` was never filled in), so the match is made on
`clients.website`, corroborated independently by `deal_payments.label` (see below). Four needed
context rather than a URL comparison:

| Domain | Matched to | Why |
|---|---|---|
| `navergo.gr` | 000079 — NAVERGO ΝΑΥΠΗΓΟΕΠΙΣΚΕΥΑΣΤΙΚΗ Ε.Ε. | `clients.website` is null; client name + label `05/06/2028` matches the sheet exactly |
| `opawey.com` | 000404 — OPAWEY E E | `clients.website` is null; client name + label `29/03/2029` matches the sheet exactly |
| `servistasathens.gr` | 000431 — SERVISTAS Ι.Κ.Ε. | `clients.website` is `https://servistas.gr/` (different domain, same client); label `04/11/2027` matches the sheet exactly |
| `transfertoursthassos.com` | 000261 — ΧΡΙΣΤΟΔΟΥΛΟΥ ΗΛΙΑΝΑ | `clients.website` is `http://www.taxi-thassos.gr/` (different domain, same client); label `10/07/2027` matches the sheet exactly |

**The defect.** All 27 rows were seeded with `start_date` = roughly the deal-creation date
(2026-04-30 … 2026-08-05) and `end_date = start_date + 1 year`. None of those dates has anything to
do with when the domain actually expires. Consequences visible in prod today:

- 26 of 27 rows are `status = 'overdue'`, 1 is `pending`. All 27 are unpaid, €20.00 net each.
- `deal_next_due()` therefore returns a **past** date for all 27 deals.
- **18 of the 27 deals sit in `on_hold`**, and for **15 of them the domains row is the only reason**
  — there is no other unpaid non-`domains` row with a past due date. Their jobs are blocked and
  their clients are being chased for €20 that is not yet owed.
- All 27 jobs show a blank "Renewal due" column on the Domains board, because
  `period_due_date` derives from a **paid** row and none of these has ever been paid.

Note `mark_overdue_payments()` only flips `pending → overdue` when `end_date < current_date`
(`20260610000004`, section 3), and every `end_date` here is in 2027. So the `overdue` status was not
set by that cron — it was set at seed time or by hand, and **nothing in the system ever flips it
back**. The migration must reset it explicitly.

**Where the real dates were hiding.** Someone had already recorded the true expiry by typing it into
the free-text `deal_payments.label` field (editable at `src/features/deals/PaymentsPanel.tsx:108`).
26 of the 27 rows carry a `dd/mm/yyyy` string there. That gives an independent second source, and it
agreed with the spreadsheet on **20 of the 21 rows where both are unambiguous**.

**The six disagreements — and why five of them are an Excel bug, not a data conflict.** Exactly five
cells in the spreadsheet are stored as *numbers* (Excel serials) rather than text. All five decode
to the CRM label read **US-style (m/d/yyyy)** — 5 out of 5, exact:

| Serial | Sheet decodes to | CRM label | Label read m/d | Match | True dd/mm |
|---|---|---|---|---|---|
| 46907 | 2028-06-03 | `06/03/2028` | 2028-06-03 | ✅ | **2028-03-06** |
| 47001 | 2028-09-05 | `09/05/2028` | 2028-09-05 | ✅ | **2028-05-09** |
| 46574 | 2027-07-06 | `07/06/2027` | 2027-07-06 | ✅ | **2027-06-07** |
| 46699 | 2027-11-08 | `11/08/2027` | 2027-11-08 | ✅ | **2027-08-11** |
| 47062 | 2028-11-05 | `11/05/2028` | 2028-11-05 | ✅ | **2028-05-11** |

These five are precisely the rows where **both** day and month are ≤ 12 — the only case where Excel
can silently reinterpret a `dd/mm/yyyy` string as a date. Rows like `28/11/2027` (day 28 > 12) could
not be reparsed and stayed text, which is exactly why only these five became serials. Owner decision
2026-08-05: **the CRM label wins for these five.**

The sixth, `tasy.gr` (deal 000247), is a genuine content difference — sheet `15/07/2027` vs label
`27/07/2027`, both plain text, nothing misparsed. Owner decision 2026-08-05: **the spreadsheet wins**
(2027-07-15).


---

## The resolved mapping (authoritative — 27 rows)

`new due` is the value written to `deal_payments.start_date`; `new end` to `end_date`.
`src` records which source won.

| Deal | Domain | payment id | old due | **new due** | new end | src |
|---|---|---|---|---|---|---|
| 000041 | `allinmykonos.com` | `a8a611ec-b93e-4b41-9f32-f7963c16ddeb` | 2026-05-28 | **2027-05-28** | 2028-05-28 | sheet |
| 000054 | `bluesearestaurantafitos.com` | `8d41caad-0d4f-489f-b7e1-9a06ab23e8fe` | 2026-08-05 | **2026-09-03** | 2027-09-03 | sheet |
| 000079 | `navergo.gr` | `0df209c8-da86-4795-9f07-fb8b13a19f5e` | 2026-05-11 | **2028-06-05** | 2029-06-05 | sheet |
| 000090 | `dctrade.gr` | `b5b9c215-2d79-40cc-afd7-dbed82f501e3` | 2026-05-29 | **2027-11-28** | 2028-11-28 | sheet |
| 000114 | `authenticsantorinitours.com` | `a3cc1fbc-112e-42cd-a584-2b4c09aa6b61` | 2026-06-10 | **2027-03-09** | 2028-03-09 | sheet |
| 000136 | `themaedu.gr` | `7a55543a-861f-42db-8026-9de407dcedb2` | 2026-06-08 | **2028-03-14** | 2029-03-14 | sheet |
| 000178 | `eleftheriadisteletes.gr` | `22ba9ca5-442c-43a7-9412-a0abd4c415a6` | 2026-06-18 | **2028-03-17** | 2029-03-17 | sheet |
| 000205 | `resetgym.gr` | `611bc893-21b3-4b60-82ec-98c6cd8c219e` | 2026-06-05 | **2028-03-17** | 2029-03-17 | sheet |
| 000222 | `juniorcatering.gr` | `bb3a97cf-285d-45b4-8ddf-54877173e208` | 2026-06-17 | **2028-03-06** | 2029-03-06 | **label** |
| 000247 | `tasy.gr` | `b96ce006-dccd-4411-a715-22a0aa8c04d9` | 2026-06-10 | **2027-07-15** | 2028-07-15 | sheet |
| 000249 | `epikentroedu.gr` | `5837cd06-78a9-4e75-8f2f-52c6f51ea1c5` | 2026-04-30 | **2028-06-19** | 2029-06-19 | sheet |
| 000261 | `transfertoursthassos.com` | `5843f008-aac4-4d0b-b474-272de124ed69` | 2026-06-10 | **2027-07-10** | 2028-07-10 | sheet |
| 000270 | `rentaboatzakynthos.com` | `801b5305-dee9-426e-8f77-ff86e181785e` | 2026-05-22 | **2027-03-27** | 2028-03-27 | sheet |
| 000277 | `interoil.gr` | `f8cedeb0-2f4f-462a-88c4-328ae7732cb6` | 2026-06-12 | **2026-11-19** | 2027-11-19 | sheet |
| 000289 | `thronosyachtingserifos.gr` | `ecc8fe0b-67f4-490a-a8c2-30a31718b993` | 2026-05-13 | **2028-05-09** | 2029-05-09 | **label** |
| 000294 | `imperialsantorini.com` | `20534b79-c2c0-485e-8689-347cd2d0df66` | 2026-06-03 | **2027-05-21** | 2028-05-21 | sheet |
| 000298 | `funeralskostas.com` | `9b2cefe6-9d2d-47f0-8f18-c8385fbf8068` | 2026-05-06 | **2027-04-23** | 2028-04-23 | sheet |
| 000314 | `aegeansafran.com` | `ab76a3c2-fe42-47b4-86bc-7a54fe383baf` | 2026-05-18 | **2027-06-07** | 2028-06-07 | **label** |
| 000316 | `drkarakalpakis.gr` | `6e91fc7c-0fb7-49f0-826f-31ae632d7a92` | 2026-05-13 | **2027-08-11** | 2028-08-11 | **label** |
| 000338 | `tritonasmarinepatmos.gr` | `9edfce7c-970f-4fa0-87dd-149a3af99683` | 2026-05-21 | **2028-05-11** | 2029-05-11 | **label** |
| 000404 | `opawey.com` | `63c5b02a-b032-4bdb-8012-f3296812767e` | 2026-05-26 | **2029-03-29** | 2030-03-29 | sheet |
| 000406 | `emamonoseis.gr` | `fec3c44c-eeac-4966-8c46-c8699bb739b4` | 2026-06-17 | **2027-02-24** | 2028-02-24 | sheet |
| 000431 | `servistasathens.gr` | `537e8414-1896-4c27-9617-40c13476bcd0` | 2026-06-15 | **2027-11-04** | 2028-11-04 | sheet |
| 000447 | `transferincorfu.com` | `6707755a-0131-4c0c-b91e-2be167456f77` | 2026-06-17 | **2027-05-19** | 2028-05-19 | sheet |
| 000473 | `freedomwheels.gr` | `32f81a51-6f6b-40ea-9eae-2f1aa3bf9657` | 2026-05-29 | **2027-05-13** | 2028-05-13 | sheet |
| 000513 | `vassilisexarchos.com` | `3f54c93c-9a4b-4a78-9c31-c3c372c09ee4` | 2026-06-11 | **2027-06-08** | 2028-06-08 | sheet |
| 005042 | `mpfurs.com` | `d74be127-b1bd-4db5-9cd2-4414c4c38e8f` | 2026-07-03 | **2028-02-15** | 2029-02-15 | sheet |

**Out of scope — the 21 `Had Deal = no` domains** (recorded so a future reader knows they were
considered, not missed): `pawsly.gr`, `ourfarmoils.com`, `dncandles.gr`, `crazy-fireworks.gr`,
`lueurclothes.gr`, `mykonoscar-rental.com`, `gotruckhellas.gr`, `theatroathinonothespis.gr`,
`ebrandone.gr`, `panstelvillas.gr`, `aristavern.gr`, `andreasvapsimata.gr`, `apofraxeiszyfis.gr`,
`nasupremeservices.com`, `sfakianakiselectric.gr`, `transferspleasure.com`, `myluggagespotspata.com`,
`rentavanathens.com`, `garagecaferhodes.com`, `lptaxinheraklio.com`, `arginontasunset.com`.


---

## ⚠️ Corrected — this prediction did not happen (see Task 6 hand-off below)

**This section originally predicted roughly 15 deals would leave `on_hold` when this migration
applied. That did not happen — 0 did — and the prediction was wrong, not the migration.**
`reconcile_deal_stage()` has never auto-lifted a hold since
`20260702150150_reconcile_deal_stage_respect_holds.sql` (lines 26-29): a deal already in `on_hold`
returns `false` immediately and only re-runs `block_deal_jobs()` — "never auto-lift a hold. Keep
jobs blocked; leave the column to the accountant." The `deal_payments_reconcile_stage` trigger does
fire `AFTER UPDATE` on every row this migration touches, and `deal_next_due()` does change, but the
guard above means `target_accounting_stage()` is never consulted for an already-`on_hold` deal, so
none of the 18 held deals moved. The one stage move in the whole migration was **000054**
(`awaiting_payment` → `paid_in_full`, a deal that was never on hold). See "Applied to prod" in
`docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md` for the full before/after
breakdown, and the "Accountant hand-off" section below for the 16 deals that now owe nothing but
are still sitting on hold and blocked.

The **000289** (2026-06-30) genuinely-past-due claim below was also wrong — 000289 has no unpaid
non-`domains` row today; it is one of the 16 in the hand-off table, not one of the two genuinely
held deals.

Two deals did not move at all, for known reasons — this part of the prediction was correct:
- **000041** is in `partial_payment`, which `reconcile_deal_stage` does not allow-list — open
  finding **A2** in `docs/system-analysis/2026-08-04-accounting-full-audit.md`. Its dates still get
  corrected; only the stage move is suppressed. Expected, not a failure.
- **000298** is in `closed`. Same — dates corrected, no stage move.

---

## Accountant hand-off — 2026-08-05 (Task 6)

Re-verified directly against prod on 2026-08-05. **18 deals with a `domains` service sit in
`on_hold`.** All 18 are still `on_hold` and all their previously-blocked jobs are still blocked —
this migration corrected the dates but, by design (see the correction above), never touches the
`on_hold` column or unblocks a job. That is the accountant's decision to make, not the system's.

### 16 deals that owe nothing today — move these off `on_hold` manually if you agree

For each: the corrected domain renewal due date this migration wrote (`deal_payments.start_date`
for the `domains` row), how many of the deal's jobs are currently blocked and by which service
type, and `deal_next_due()` — the earliest unpaid due date across *all* of the deal's payments,
domains or not. Every value below is a **future** date (none is null, none is past), which is the
proof the deal owes nothing today.

| Deal | Client | Domain renewal due | Blocked jobs | `deal_next_due()` |
|---|---|---|---|---|
| 000114 | ΓΑΒΡΙΗΛΙΔΗΣ ΣΤΕΦΑΝΟΣ ΓΕΩΡΓΙΟΣ | 2027-03-09 | 1 (`other`) | 2026-08-10 |
| 000136 | ΚΑΝΑΚΗ ΜΑΡΙΑ ΧΡΙΣΤΟΦΟΡΟΣ | 2028-03-14 | 1 (`ai_seo`) | 2028-03-14 |
| 000178 | ΕΛΕΥΘΕΡΙΑΔΗΣ ΑΠΟΣΤΟΛΟΣ ΤΟΥ ΔΗΜΗΤΡΙΟΥ | 2028-03-17 | 1 (`web_seo`) | 2028-03-17 |
| 000247 | ΑΔΑΜΙΔΗΣ ΓΕΩΡΓΙΟΣ ΙΩΑΝΝΗΣ | 2027-07-15 | 3 (`ai_seo`, `local_seo`, `web_seo`) | 2027-07-15 |
| 000249 | ΤΡΑΠΑΛΗ ΒΑΣΙΛΙΚΗ & ΣΙΑ Ε.Ε. | 2028-06-19 | 2 (`ai_seo`, `web_seo`) | 2028-06-19 |
| 000261 | ΧΡΙΣΤΟΔΟΥΛΟΥ ΗΛΙΑΝΑ ΧΡΙΣΤΟΔΟΥΛΟΣ | 2027-07-10 | 1 (`local_seo`) | 2027-07-10 |
| 000270 | ΣΟΤΑ ΗΛΙΑ ΙΩΣΗΦ | 2027-03-27 | 3 (`ads`, `ai_seo`, `web_seo`) | 2027-03-27 |
| 000277 | ΞΑΝΘΟΠΟΥΛΟΣ ΙΩΑΝΝΗΣ ΑΘΑΝΑΣΙΟΣ | 2026-11-19 | 1 (`web_seo`) | 2026-08-12 |
| 000289 | THRONOS YACHTING ΜΟΝΟΠΡΟΣΩΠΗ Ι.Κ.Ε. | 2028-05-09 | 1 (`local_seo`) | 2028-05-09 |
| 000294 | HAJDINI HAMIT RRAPI | 2027-05-21 | 3 (`ads` ×1, `local_seo` ×2) | 2027-05-21 |
| 000314 | ΕΤΖΙΑΝ ΣΑΦΡΑΝ ΕΕ | 2027-06-07 | 2 (`ai_seo`, `web_seo`) | 2027-06-07 |
| 000404 | OPAWEY E E | 2029-03-29 | 3 (`ads` ×1, `maintenance` ×2) | 2029-03-29 |
| 000406 | Ema Monoseis | 2027-02-24 | 3 (`ads`, `social_media`, `web_seo`) | 2027-02-24 |
| 000431 | SERVISTAS ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ ΕΤΑΙΡΙΑ | 2027-11-04 | 2 (`ads`, `web_seo`) | 2026-08-10 |
| 000473 | FREEDOM WHEELS ΜΟΝΟΠΡΟΣΩΠΗ Ι Κ Ε | 2027-05-13 | 0 | 2027-05-13 |
| 005042 | ΠΑΤΣΙΑΣ ΑΝΑΣΤΑΣΙΟΣ ΜΙΧΑΗΛ | 2028-02-15 | 3 (`ai_seo`, `local_seo`, `web_seo`) | 2028-02-15 |

30 blocked jobs total across these 16 deals. Note 000114, 000277 and 000431 have `deal_next_due()`
only a few days out (2026-08-10 / 2026-08-12) — not past due today, but check them first if you
work down this list over several days, since they will become genuinely due soon.

### 2 deals that are genuinely still held — do not touch these

Each has an unpaid, non-`domains` row whose `start_date` is on or before today (2026-08-05); that is
the row `deal_next_due()` is reporting and the reason the hold is legitimate.

| Deal | Client | Past-due row (service, status, due date) | `deal_next_due()` |
|---|---|---|---|
| 000090 | www.dctrade.gr | `web_seo` overdue since 2026-05-29 (plus a second `web_seo` row overdue since 2026-06-29 and a `social_media` row overdue since 2026-07-29) | 2026-05-29 |
| 000205 | ΓΑΒΡΙΗΛΙΔΗΣ ΜΠΑΝΤΑΒΑΣ FITNESS EVOLUTION Ο Ε | `web_dev` overdue since 2026-06-05 | 2026-06-05 |

000090 has 2 blocked jobs; 000205 has 0 blocked jobs — its hold is on the accounting stage, not on
a blocked job.

### Step 3 — renewal generator will not fire early

`ensure_recurring_payments()` creates the next period once `end_date <= current_date + 7 days`.
Re-run 2026-08-05 against every `domains` row (not just the 27 touched by this migration):

```sql
select count(*) as would_generate
  from public.deal_payments dp
 where dp.service_type = 'domains'
   and dp.end_date <= current_date + interval '7 days';
```

Result: **`0`**, as expected — every corrected `end_date` is at least a year out.

### Out-of-scope 28th row — confirmed still untouched

Deal **002154** (client "HN travel", `hntravelcorfu.com`), payment
`96afc085-7489-44d5-a1b5-534bfccf1dd4`: re-checked 2026-08-05, still `status = 'paid'`,
`start_date = 2026-07-06`, `end_date = 2027-07-06`, unchanged by this migration. It was considered
during discovery and deliberately excluded because it postdates the mapping freeze (see the
migration header's SCOPE NOTE); this entry is the record that it was checked again, not missed.

