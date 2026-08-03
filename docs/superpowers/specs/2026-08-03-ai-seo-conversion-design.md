# AI SEO Job Conversion (v2) — Design / Spec

- **Date:** 2026-08-03
- **Status:** Design — owner decided both directions + teardown-from-parent. Extends the shipped v1 conversion.
- **Builds on:** `2026-08-03-job-service-type-conversion-design.md` (v1, shipped). Reuses the same `convert_job_service_type` RPC, `convertibleTargets` helper, and `ConvertServiceDialog`.

## Greek TL;DR

Επεκτείνουμε τη «Μετατροπή υπηρεσίας» ώστε να δουλεύει και με AI SEO — που είναι **τριάδα** (parent χρέωσης + web child + local child):
- **single → AI SEO:** ένα αυτόνομο web_seo/local_seo γίνεται child μιας νέας τριάδας· φτιάχνεται parent που παίρνει τη χρέωση + τα payment lines, και το δεύτερο child.
- **AI SEO → single:** από τον parent διαλέγεις web ή local· το επιζών child γίνεται αυτόνομο με τη χρέωση (& τα payment lines), σβήνονται το άλλο child + ο parent. **Τα λεφτά μένουν ίδια.**

## 1. The trio (recap, from live `release_billing_jobs_for_deal`)

- **Parent:** `service_type='ai_seo'`, `billing_only=true`, `billing_active=true`, `stage_id=null` (off-board), title `'AI SEO'`, carries `amount_net`/`one_time_amount`/`monthly_amount`/`setup_fee`/`billing_type`/`vat_rate`. **Owns all `deal_payment_lines`** (via `job_id`).
- **Web child:** `service_type='web_seo'`, `parent_job_id=parent`, `amount_net=0`, `billing_active=false`, `is_custom=true`, title `'AI SEO — Web'`, group=web_seo, code `<deal>-AISEOWEB` (via set_job_code).
- **Local child:** same shape, `service_type='local_seo'`, title `'AI SEO — Local'`, code `-AISEOLOC`.

## 2. Scope (v2)

Extend the allowed conversions with AI SEO, keeping v1 intact:
- **Upgrade:** a standalone `web_seo` **or** `local_seo` job (no parent, no children) → `ai_seo`.
- **Teardown:** an `ai_seo` **parent** → `web_seo` or `local_seo` (the survivor).

Still refused: web_dev/franchise/maintenance/other; converting an ai_seo **child** directly (must act on the parent); social_media/ads → ai_seo (not a child type); a deal that already has an ai_seo trio when upgrading (dedup).

## 3. Conversion semantics

### 3.1 Upgrade — `web_seo`/`local_seo` standalone → `ai_seo`
Preconditions: source is standalone (`parent_job_id is null`, no children); the deal has **no existing ai_seo parent** (`not exists ai_seo job on deal`).
Atomic steps:
1. **Create the parent** — insert `ai_seo` billing job copying the source's billing fields (`amount_net`, `one_time_amount`, `monthly_amount`, `setup_fee`, `billing_type`, `vat_rate`), `billing_only=true`, `billing_active=true`, `stage_id=null`, title `'AI SEO'`, `is_custom=true`.
2. **Move billing to the parent:** `deal_payment_lines` currently on the source job → re-point `job_id` to the parent. Update the source's matching `deal_payments.service_type` → `ai_seo`; update the `services_planned` entry → `ai_seo`.
3. **Demote the source into the matching child:** set `parent_job_id=parent`, `amount_net=0`, `billing_active=false`, `billing_only=true`, `is_custom=true`, title `'AI SEO — Web'`/`'AI SEO — Local'`, regen code (set_job_code produces `-AISEOWEB`/`-AISEOLOC`), keep it on its current board (`stage_id` unchanged — the work is ongoing), owner via the SEO owner rule.
4. **Create the sibling child** (web if source was local, local if source was web) — €0, `billing_active=false`, `parent_job_id=parent`, on the sibling's board (first stage), owner via the sibling's SEO owner rule, monthly_tasks from the sibling template.

### 3.2 Teardown — `ai_seo` parent → `web_seo` or `local_seo`
Preconditions: source is the `ai_seo` parent (`billing_only`, has ≥1 child); `p_target` ∈ {web_seo, local_seo} and a child of that type exists.
Atomic steps:
1. **Pick the survivor** = the child with `service_type = p_target`.
2. **Promote survivor to standalone:** `parent_job_id=null`, copy the parent's billing fields onto it (`amount_net`, `one_time_amount`, `monthly_amount`, `setup_fee`, `billing_type`, `vat_rate`), `billing_active=true`, `billing_only=false`, retitle to the deal/business name (normal title, not 'AI SEO — …'), regen code (normal abbr), keep its board/stage. Owner unchanged (already correct service).
3. **Move billing to survivor:** `deal_payment_lines` on the parent → re-point `job_id` to survivor. Update `deal_payments.service_type` `ai_seo`→`p_target`; `services_planned` `ai_seo`→`p_target`.
4. **Delete** the other child and the parent (`delete from jobs where id in (other_child, parent)`).

## 4. Billing invariant

Amounts and payment rows are never changed — only **which job owns them** moves (source↔parent). `deal_payment_lines.job_id` re-pointing + `deal_payments.service_type` + `services_planned` keep the billing linkage consistent. Period-date triggers recompute unchanged (same amounts/dates).

## 5. Where it lives (UI)

Same **«Μετατροπή υπηρεσίας»** button + `ConvertServiceDialog` on `JobDetailPage` (the ai_seo parent has a detail/billing record view). Extend `convertibleTargets`:
- source `web_seo`/`local_seo`, standalone → existing Group-A targets **plus** `ai_seo`.
- source `ai_seo` **and** the job is a parent (`billing_only`, has children) → `['web_seo','local_seo']` (teardown).
- ai_seo **child** (`parent_job_id` set) → still `[]` (act on the parent).
The dialog copy explains trio create/teardown (extra i18n strings). The RPC re-validates everything.

## 6. Implementation shape

Extend the existing `convert_job_service_type(p_job_id, p_target)` RPC with two new branches BEFORE the v1 same-group logic:
- if `p_target='ai_seo'` → upgrade path (§3.1).
- if `j.service_type='ai_seo'` → teardown path (§3.2).
- else → existing v1 path.
Keep it one atomic function. Guards raise distinct messages. Frontend `convertibleTargets` gains the ai_seo rules; the button already gates on admin/accounting.

## 7. Testing (isolated disposable data, like v1)

- **Upgrade:** seed standalone local_seo (amount 100) → convert to ai_seo → assert: a parent ai_seo (amount 100, billing_only), the source is now local child (amount 0, parent set, title 'AI SEO — Local', code -AISEOLOC), a new web child exists, payment lines moved to parent, deal_payments/services_planned = ai_seo. Same from web_seo.
- **Teardown:** seed a full trio → convert parent to local_seo → assert: local child is standalone (amount 100, billing_active, no parent), web child + parent deleted, payment lines on survivor, deal_payments/services_planned = local_seo.
- **Guards:** child job → refused; upgrade when deal already has ai_seo → refused (dedup); teardown to a non-existent child type → refused; sales user → not authorized.
- **Billing invariant:** total amount + payment-line sum identical before/after both directions.
- **Frontend:** `convertibleTargets` returns ai_seo for standalone web/local, [web,local] for an ai_seo parent, [] for a child.

## 8. Rollback

Extends the v1 RPC + `convertibleTargets`. Rollback = restore the v1-only RPC body (drop the two ai_seo branches) and the v1 `convertibleTargets` (remove ai_seo rules). No schema change. A wrong conversion is reversed by converting the other way (both directions exist).

## 9. Open items (recommended defaults; confirm)

1. **Child board placement on upgrade:** children go **on their boards** (active), assuming the converted job's work is ongoing — not off-board-until-paid like a fresh release. (Assumed.)
2. **Survivor title on teardown:** reset to the client/business name (normal job title), not 'AI SEO — …'. (Assumed.)
3. **Dedup on upgrade:** refuse if the deal already has any ai_seo job. (Assumed.)
