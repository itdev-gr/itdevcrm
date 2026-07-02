# SEO Jobs at Awaiting Payment + Per-Job Email-Status Badge — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** collaborative brainstorm (product owner + Claude)

## Goal

Two related changes to the job-onboarding flow:

- **Part A** — Create the SEO work jobs (and send their access-request emails) the **first time a deal reaches Awaiting Payment** (or Fully Paid, if it lands there directly), instead of waiting for Fully Paid. Onboarding starts as soon as the invoice is issued.
- **Part B** — Put a **per-job "onboarding email" status badge** on every job — on both the board card and the job detail page — showing whether that job's access email was **Sent**, **Not sent** (with a manual **Resend**), or **Coming soon** (services that have no onboarding email yet). So if the email system breaks, staff can see it at a glance and resend by hand.

## Background — how it works today

- Jobs are made from a deal's `services_planned` list, one per service, via `release_billing_jobs_for_deal` (at deal setup, SEO seeded off-board) and `release_jobs_for_deal` / `release_deal_jobs` (place on board).
- **Timing today:** Web Dev + Hosting placed at **Partial Payment** (`deals_release_jobs_on_partial_payment`); Local/Web/AI SEO + Ads + Social placed at **Fully Paid**; SEO access emails fire at first Fully Paid.
- **Access emails are already automatic:** trigger `jobs_seo_onboarding_email` on `public.jobs` (AFTER INSERT OR UPDATE OF stage_id) sends `webseo_gsc_access` (web_seo) / `localseo_gbp_access` (local_seo) when an SEO job lands on a board; `jobs.onboarded_at` marks it so it never double-sends; a 15-min `reconcile_seo_onboarding_emails` cron (gated by `seo_onboarding_config.cutover`) catches misses.
- A per-job on-demand resend already exists for **Local SEO** only (the ✉ GBP button + `gbp_access_sent_map` RPC), and it bypasses the OFF `dept_technical` toggle.
- **Departments/emails:** only `web_seo` (GSC) and `local_seo` (GBP) have onboarding/access emails; `ai_seo` uses both via its web+local children. `web_dev`, `hosting`, `ads`, `social_media` have **no** onboarding email.

## Part A — SEO jobs created at Awaiting Payment

**Scope:** `web_seo`, `local_seo`, `ai_seo` only (AI SEO = billing parent + web child + local child; the two children are the work jobs that get placed + emailed). Web Dev/Hosting keep their Partial-Payment trigger; Ads/Social keep Fully Paid; the AI SEO billing parent and the recurring payment system are untouched.

**Trigger:** a new trigger on `deals.accounting_stage_id` (AFTER UPDATE, when the stage changes) — when the new stage is `awaiting_payment` **or** `paid_in_full`, run a **SEO-scoped release** that places the deal's SEO work jobs on their Technical boards.

**Idempotency:** "already created" = the SEO job has already been **placed/onboarded** (on a board / `onboarded_at` set). The first Awaiting-Payment landing places it (+ auto-email); every later landing (including the eventual Fully Paid) is a no-op for SEO. Later payments feed the **existing recurring billing system** unchanged. The existing Fully-Paid release stays as-is — it becomes a no-op for SEO via this idempotency and continues to handle Ads/Social.

**Emails:** placement fires the existing `jobs_seo_onboarding_email` trigger automatically and idempotently (web→GSC, local→GBP, ai_seo→both children). No new email code in Part A.

**Timing note (intended):** a deal that is invoiced but not yet paid will now have SEO work started and access emails sent. If it later goes On Hold (overdue), the existing block lifecycle blocks those jobs (`account_on_hold`).

## Part B — Per-job onboarding-email status badge + resend

**Applies to every job, all services.** Three states:

| State | Condition | UI |
|---|---|---|
| ✅ **Sent** | the service has an onboarding email AND `email_log` shows it delivered/sent for this job | green badge + date |
| ⚠️ **Not sent** | the service has an onboarding email but there is no successful send for this job (failed, or not yet sent) | amber badge + **Resend** button |
| 🕒 **Coming soon** | the service has no onboarding email defined (`web_dev`, `hosting`, `ads`, `social_media`) | grey badge, no action |

**Service → email map:** `web_seo`→`webseo_gsc_access`, `local_seo`→`localseo_gbp_access`, `ai_seo`→shown on its web+local children (the parent itself shows nothing or a roll-up). All others → Coming soon.

**Status source (backend):** a security-definer RPC returning a per-job status map (generalizing `gbp_access_sent_map`): for each job, join its service→template, look up the latest `email_log` row tied to that job's client + template (+ deal), and classify delivered/sent → ✅, failed/absent → ⚠️, no template → 🕒. Include the last-sent timestamp for the tooltip.

**Resend (backend):** generalize the existing on-demand GBP send into a per-job `job_resend_access_email(job_id)` RPC that sends the job's service access email (web→GSC, local→GBP), records it, and — like the GBP button today — **bypasses the OFF `dept_technical` toggle** (it's a deliberate manual action). Guarded to admin + technical/accounting.

**Frontend:** a small status dot on the **board card** (⚠️ stands out at a glance) and the full badge + Resend button on the **job detail page**. Reuse the existing job card/detail components and the GBP-button interaction pattern.

## Components & data flow

```
Deal stage → awaiting_payment / paid_in_full
  └─> [A] deals_release_seo_jobs_on_stage trigger  (NEW)
        └─> SEO-scoped release  → places web_seo/local_seo/ai_seo-children on boards (idempotent)
              └─> jobs_seo_onboarding_email trigger (EXISTING) → GSC/GBP email → email_log

Job card / Job detail (frontend)
  └─> job_onboarding_email_status(job_ids)  (NEW RPC) → ✅ / ⚠️ / 🕒 per job
  └─> [Resend] → job_resend_access_email(job_id) (NEW RPC) → send + log → badge flips to ✅
```

- **`deals_release_seo_jobs_on_stage`** — trigger; fires SEO placement at awaiting_payment/paid_in_full; depends on the existing release logic + idempotency guards.
- **`job_onboarding_email_status`** — read RPC; input job ids → status map; depends on service→template map + `email_log`.
- **`job_resend_access_email`** — write RPC; input job id → sends + logs the access email; bypasses dept toggle; admin/technical/accounting only.
- **Job badge component** — renders ✅/⚠️/🕒 + Resend; used on card + detail.

## Testing

- **A (SQL, savepoint-rollback via the RAISE-harness pattern):** deal → awaiting_payment first time → SEO jobs placed + access emails enqueued; second landing / Fully Paid → no new jobs, no new emails (idempotent); deal straight to paid_in_full → placed; web_dev/hosting still only at partial; ads/social still only at fully-paid; recurring unaffected.
- **B (SQL):** status RPC returns ✅ for a delivered SEO email, ⚠️ for a failed/absent one, 🕒 for web_dev/hosting/ads/social; resend RPC sends + flips status to ✅ and is idempotent-safe; resend works with `dept_technical` OFF; auth-gated.
- **Frontend:** pure helper for badge state (unit tests); badge renders correctly per state on card + detail.

## Changes / Revert

- **Part A migration:** new `deals_release_seo_jobs_on_stage` trigger + SEO-scoped release function; commented revert (drop trigger/function) restores today's Fully-Paid-only SEO behavior. No backfill — going-forward only (existing deals already have their SEO jobs).
- **Part B migration:** `job_onboarding_email_status` + `job_resend_access_email` RPCs (+ grants); frontend badge component + card/detail wiring; commented revert drops the RPCs and reverts the components.
- Push directly to `main`, no PR. Atomic commits. Migrations end with a commented revert block.

## Out of scope

- Onboarding emails for web_dev/hosting/ads/social (they stay "Coming soon" until such templates are designed).
- Changing Web Dev/Hosting (Partial) or Ads/Social (Fully Paid) creation timing.
- The recurring billing system, the AI SEO billing parent, and the stage-locked payment reminders (separate, already shipped).

## Open questions

None — scope (SEO only for Part A), timing (start at Awaiting Payment, before payment), badge states, and placement (card + detail) all confirmed with the product owner 2026-07-02.
