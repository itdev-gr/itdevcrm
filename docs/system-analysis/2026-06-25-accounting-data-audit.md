# Accounting data audit — 2026-06-25

Read-only audit of billing data across **all 478 non-archived deals** (242 active + 236 closed).
Closed deals are clean (230/236 have no jobs — historical/old-CRM, expected; 0 errors of the types below),
so every finding is on the **242 active billing deals**. Nothing was changed.

"Active stages" = new / awaiting_payment / on_hold / partial_payment / paid_in_full / done.
The billing source of truth is **jobs + deal_payment_lines** (the app's totals view reads the lines).

---

## Summary (grouped by error type)

| Group | Issue | Count | Severity |
|---|---|---|---|
| 1 | Jobs priced at **€0** (recurring won't bill) | 21 jobs / ~19 deals | **High** |
| 2 | Under-billed / missing payment | 2 deals | **High** |
| 3 | True **double-billing** duplicate | 1 deal | **High** |
| 4 | **VAT** wrong for Cyprus clients (24% vs 0%) | 2 deals | **High** |
| 5 | Wrong accounting **stage** (paid but not marked / overdue while "paid in full") | 8 deals | Medium |
| 6 | Data hygiene (stale payment header field; empty new deal) | 36 payments + 1 deal | Low |

Note: "duplicate same-service jobs" (7 deals) looked alarming but **6 are legitimate** (one-time GBP/setup
+ monthly retainer, or already-reviewed web-dev) — only **1** (000415) is a real duplicate. Detail below.

---

## GROUP 1 — Jobs priced at €0 (revenue not billed)  · HIGH

These billing-active jobs have amount €0, so they generate €0 invoices. The **recurring** ones are the
serious ones — they bill €0 every month/year.

**Recurring €0 (bill €0 on every cycle):**
| Deal | Client | Service | Cadence | Stage |
|---|---|---|---|---|
| 000245 | ΜΠΟΥΤΖΕΛΙΟΓΛΟΥ ΙΟΡΔΑΝΗΣ | ads | monthly | paid_in_full |
| 000136 | ΚΑΝΑΚΗ ΜΑΡΙΑ | ai_seo | monthly | paid_in_full |
| 000299 | ΖΥΓΟΥΡΗΣ ΙΑΚΩΒΟΣ | hosting | yearly | done |
| 000084 | Afuera | local_seo | monthly | paid_in_full |
| 000289 | THRONOS YACHTING | local_seo | monthly | paid_in_full |
| 000294 | HAJDINI HAMIT | local_seo | monthly | paid_in_full |
| 000408 | ΑΞΙΟΝ ΕΣΤΙ | local_seo | monthly | paid_in_full |
| 000216 | Casa di Gusto | social_media | monthly | on_hold |
| 000277 | Interoil - ΞΑΝΘΟΠΟΥΛΟΣ | social_media | monthly | paid_in_full |
| 000306 | ΠΑΛΗΚΥΡΑΣ | social_media (meta ads) | monthly | onboarding |
| 000408 | ΑΞΙΟΝ ΕΣΤΙ | social_media | monthly | paid_in_full |
| 000473 | FREEDOM WHEELS | social_media | monthly | paid_in_full |
| 000403 | ΥΔΡΑΙΟΣ ΙΩΑΝΝΗΣ | web_seo | monthly | on_hold |
| 000416 | Κ ΧΑΡΔΑΛΗΣ ΚΑΙ ΣΙΑ ΑΕ | web_seo | monthly | paid_in_full |

**One-time web_dev at €0 (no price set — likely the unassigned "New Project" backlog):**
000203 ΝΤΙΜΠ, 000205 FITNESS EVOLUTION, 000233 ΑΝΤΩΝΙΟΥ, 000270 ΣΟΤΑ, 000280 O.H.ORTHOHOUSE,
000298 ΚΑΤΣΟΥΛΟΓΙΑΝΝΑΚΗΣ, 000420 SERGIANI TRAVEL.

→ **Fix:** set the correct price on each job (recurring ones first — they're actively under-billing).

---

## GROUP 2 — Under-billed / missing payment  · HIGH

- **000041 — ΜΑΡΙΝΟ ΕΣΜΕΡΑΛΝΤΑ ΠΕΤΡΟ**: web_dev job is **€1900** (50/50 plan) but only **€950** of payments
  exist (one half is missing). The €950 present is marked paid, and the deal sits in *partial_payment* —
  so it looks settled but **€950 was never billed**.
- **000090 — www.dctrade.gr**: web_seo job **€300/month** has **no payment generated at all** → not being
  billed. (It's the only priced job in the whole system with zero payments.)

---

## GROUP 3 — True double-billing  · HIGH

- **000415 — ΦΑΡΜΑΚΕΙΟ ΑΓΓΕΛΙΚΗ ΒΟΓΙΑΤΖΗ Ο Ε**: has **two identical** Local SEO jobs, both
  "local seo" **€200/month** (`000415-LOCALSEO` + `000415-LOCALSEO-2`). The client is being billed
  **€400/month instead of €200** — duplicate payments of €200 appear on 2026-05-28 and 2026-06-28.
  → **Fix:** archive one of the two €200/mo Local SEO jobs (keep the one with the real payment history).

(Already fixed earlier today: the web-dev per-payment duplicates on Imperial Crystals, NIOVI, ΒΑΣΙΛΗΣ ΕΞΑΡΧΟΣ.)

**Looked like duplicates but are LEGITIMATE (no action):**
- 000035 ΜΠΕΚΑ — Local SEO €200/mo + one-time "GBP" €100 (setup + retainer)
- 000338 ΠΑΝΑΓΙΩΤΑΚΗΣ — Local SEO €200/mo + one-time "new gbp" €100
- 003557 THELOURAS — Local SEO €217.74/mo + one-time "new gbp" €113
- 000306 ΠΑΛΗΚΥΡΑΣ — social "basic edit" €450 one-time + "meta ads" recurring (the meta-ads is €0 → Group 1)
- 000066 ΦΟΥΡΝΑΡΗ / 000098 ΜΗΤΡΟΓΙΑΝΝΗΣ — web_dev pairs already reviewed & intentionally kept

---

## GROUP 4 — VAT wrong for Cyprus clients  · HIGH

Cyprus clients must be **0% VAT**; these are charged **24%** (over-charging the customer):
- **000216 — Casa di Gusto - Roteus LTD** (Cyprus) — social_media job at 24%
- **000280 — O.H.ORTHOHOUSE LTD** (Cyprus) — web_dev job at 24%

→ **Fix:** set these jobs' VAT to 0% and regenerate their payments. (Worth a wider check of every Cyprus client.)

---

## GROUP 5 — Wrong accounting stage  · MEDIUM (process, not money)

**Fully paid but NOT moved to "Paid In Full"** (sitting in awaiting_payment / new):
000064, 000100, 000103, 000138, 000331, 000432, 003557.
→ should be dragged to Paid In Full. (000041 also shows "all paid" but only because half is unbilled — see Group 2.)

**Marked "Paid In Full" but has an overdue payment:**
- **000277 — Interoil**: a payment due **2026-06-12** is still pending while the deal is in Paid In Full.
  (This deal also has the €0 social_media job from Group 1.)

---

## GROUP 6 — Data hygiene  · LOW (no customer/UI impact)

- **36 payments**: the denormalized header field `deal_payments.amount_net` is out of sync with its
  (correct) line totals, and the legacy `amount` column is 0. The app reads the **line** totals, so the
  UI and customer figures are correct — but a one-time resync would clean up raw reporting. Two flavours:
  (a) installment headers showing a flat figure vs the correct split lines (mostly the messy deals
  000044/000048/000088), and (b) cent-level VAT-rounding diffs from the ClickUp migration (e.g. €104.84 vs €105).
- **004583**: an active deal in *new* with no billing jobs yet — probably just unfinished setup.

---

## Suggested fix order
1. **Group 4 (VAT)** + **Group 3 (000415 double-bill)** — customer-facing money errors, fix first.
2. **Group 1 recurring €0** + **Group 2** — revenue we're not collecting.
3. **Group 1 web_dev €0** — set prices (or confirm they're intentional backlog).
4. **Group 5** — stage tidy-up.
5. **Group 6** — optional data resync.

All fixes are reversible (backups + the existing RPCs). None applied yet — awaiting your go-ahead per group.
