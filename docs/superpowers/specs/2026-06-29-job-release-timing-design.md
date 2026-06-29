# Job release timing: Web Dev + Hosting at Partial Payment, everything else at Fully Paid

- **Date:** 2026-06-29
- **Status:** Design — approved, ready for implementation
- **Builds on:** `2026-06-29-recurring-seo-first-paid-onboarding-design.md` (already shipped)

## Goal

Control **when each service's job is released to its tech board** (i.e. becomes visible/workable, and for SEO triggers the onboarding email):

| Service | Released at |
|---|---|
| `web_dev`, `hosting` | **Partial Payment** |
| `local_seo`, `web_seo`, `ai_seo` (children), `ads`, `social_media` | **Fully Paid** |

Consequence: SEO onboarding emails fire **only at first Fully-Paid** — never at New, Partial, or deal creation.

## Decisions

- AI SEO Web/Local child cards **defer to Fully Paid** (today they appear at deal creation).
- **Going-forward only** — no retroactive change to in-flight deals, no data backfill.

## Current behaviour (before)

- Deal INSERT (`release_billing_jobs_for_deal`): seeds every service off-board (`stage_id` null) **except AI SEO children**, which are placed on-board (new_project) immediately.
- Partial Payment (`deals_release_jobs_on_partial_payment` → `release_jobs_for_deal(deal, true)`): places **all** planned services on their boards (web_dev unblocked, others blocked). ← this is why SEO can email at partial.
- Fully Paid (`deals_hold_jobs_on_stage_change` paid_in_full branch → `release_deal_jobs`): onboards/renews SEO + unblocks; does **not** place still-off-board services. `complete_accounting` separately calls `release_jobs_for_deal(deal, false)` to place everything.

## Design — three changes (one migration)

### 1. Deal-creation seeder — defer AI SEO children off-board
`release_billing_jobs_for_deal()` AI SEO branch: create the Web/Local child jobs with `stage_id = null` (off-board) instead of each board's first stage. Everything else (parent billing record, owners via triggers, `parent_job_id` link, €0 amounts) unchanged. They get placed at Fully Paid like other SEO.

### 2. Partial-Payment release — only Web Dev + Hosting
`release_jobs_for_deal(target_deal_id, partial_payment_mode)`: when `partial_payment_mode = true`, process **only** `web_dev` and `hosting`; `continue` past all other services (they stay off-board until Fully Paid). Placed **unblocked**:
```
-- near the top of the services loop:
if partial_payment_mode and service_type_val not in ('web_dev','hosting') then continue; end if;
...
should_block := partial_payment_mode and service_type_val not in ('web_dev','hosting');  -- => false for web_dev/hosting
```
`partial_payment_mode = false` (Fully Paid / complete_accounting) is unchanged: it still places every service.

### 3. Fully-Paid handler — place everything not yet released
`deals_hold_jobs_on_stage_change()` `paid_in_full` branch: place any still-off-board services, then run the onboarding/renewal logic:
```
elsif new_code = 'paid_in_full' then
  perform public.release_jobs_for_deal(new.id, false);  -- place web_dev/hosting (if skipped partial) + SEO/ads/social/ai-children
  perform public.release_deal_jobs(new.id);             -- first-time SEO -> New project + email + mark ; onboarded -> Renewal
```
Idempotent: `release_jobs_for_deal(false)` skips services already on a board (existing-job branch), so the complete-accounting path (which already calls it) and the direct-drag path both converge correctly. AI SEO children (off-board) are placed by `release_deal_jobs` branch 1a (off-board SEO → New project + email + mark).

## Behaviour after, by path

- **Deal created (New):** all services off-board. No board cards, no email.
- **Partial Payment:** only Web Dev + Hosting appear (unblocked). SEO/Ads/Social/AI-SEO absent.
- **Fully Paid (first time):** Web Dev + Hosting present (placed now if Partial was skipped); Local/Web SEO + AI-SEO children land in New project and email fires once; Ads/Social placed; marker set.
- **Fully Paid (renewal):** already-onboarded SEO → Renewal, no email (unchanged).
- **Complete accounting:** unchanged — places everything at completion (= Fully Paid).

## Edge cases

- Deal jumps straight to Fully Paid (no Partial): change #3 places web_dev + hosting too. ✓
- AI SEO deal: both `webseo_gsc` and `localseo_gbp` access emails fire at Fully Paid (one per child), deduped per deal+service. ✓
- Hosting is recurring: its renewal behaviour is unchanged (release_deal_jobs branch 3 = unblock only). This change only affects initial release timing. 
- Existing in-flight deals: untouched.

## Testing & deploy

pgTAP files written for the record; verified for real via **rolled-back** assertion blocks against prod (no local Docker / no prod pgtap):
1. Partial Payment releases only web_dev + hosting; SEO/ads/social/ai_seo stay off-board.
2. AI SEO child jobs are off-board immediately after deal creation.
3. Fully Paid places all remaining services; first-time SEO → New project + email; web_dev/hosting placed if Partial was skipped.
4. Renewal path unchanged (already-onboarded SEO → Renewal, no dup email).
Apply via Management API; gated on explicit go-ahead. Going-forward only.

## Changes / Revert

**Changes:** `release_billing_jobs_for_deal` (AI SEO children off-board), `release_jobs_for_deal` (partial mode = web_dev/hosting only), `deals_hold_jobs_on_stage_change` (paid_in_full also calls `release_jobs_for_deal(false)`).

**Revert:** restore all three from their prior migrations (`20260629000000`, `20260624050000`, `20260626000010`). No data to restore (no backfill).
