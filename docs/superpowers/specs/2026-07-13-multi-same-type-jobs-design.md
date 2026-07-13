# Multiple same-service jobs per deal — design

**Date:** 2026-07-13 · **Trigger:** deal 005906 sold Local SEO one-time (€112.90) + Local SEO monthly (€233.87); only one job spawned (one-per-service_type dedupe), the monthly plan has billing but no job/board card.

## Scope decision (the robustness boundary)

Support **one job per (service_type, billing_type) pair** per deal — i.e. the same
service may coexist as one-time AND recurring (the real-world case: 005906 and
the 41 parked ClickUp multi-service deals). Two same-type chains with the SAME
billing_type remain unsupported and are skipped exactly as today. Rationale:
chain identity `(deal_id, service_type, billing_type)` is what the entire
recurring machinery already keys on (`ensure_recurring_payments` successor
guard, `deal_payments_recurring_period_key_unique`, the no-dup-period trigger)
— the 2026-07-02 idempotency hardening. Widening identity further would mean
re-keying that machinery (the flip-flop class of bugs we eliminated). Within
this boundary NO identity/guard changes are needed at all.

## Changes (7 precise touch points, from the machinery fact-find)

1. **`release_billing_jobs_for_deal`** (latest body: 20260702160000:15): dedupe
   `exists(... service_type=st ...)` becomes `exists(... service_type=st and
   billing_type = <service's billing_type> ...)`. ai_seo branch unchanged
   (parent+children special case keeps its own type-only dedupe).
2. **`release_jobs_for_deal`** (20260702160000:85): reuse-or-insert lookup adds
   `and billing_type = <service's billing_type>` to the existing-job match.
3. **`seed_deal_jobs_and_payments`** (20260617000013:49): payment→job line-link
   adds `and j.billing_type = <payment's billing_type>` to the LIMIT 1 match.
4. **`ensure_recurring_payments`** (20260702000000:22): candidate's
   job-existence check and the successor's line-link job lookup both add
   `and j.billing_type = dp.billing_type` — the successor line then binds to the
   recurring job, never the one-time sibling. Successor guard/dedupe unchanged.
5. **`recompute_job_period_dates`** (20260703000000:12): the service-type match
   arm becomes `(dp.service_type = j.service_type and dp.billing_type =
   j.billing_type)`; the line-link arm stays. One-time job gets one-time
   payment dates; recurring job gets its own.
6. **Frontend:** `AccountingKanbanCard.tsx:120` service chips keyed
   `key={service_type}` → `key={`${s.service_type}-${idx}`}` (React key
   collision for dual-type deals).
7. **Job codes:** NO change — `generate_job_code` already suffixes repeats
   (`005906-LOCALSEO`, then `005906-LOCALSEO-2`), unique index `jobs_code_unique`.

## Unaffected by design (verified against the fact sheet)

`reconcile_deal_stage` (per-deal min due date — correct across chains),
paid-in-full/on-hold movers, block lifecycle (per-deal), SEO onboarding email
(per-deal dedupe key — second job won't re-send), pricing summary
(`sync_deal_pricing_from_jobs` buckets by billing_type), `create_custom_job`
web_dev guard (kept), installments (`service_index` per row, not identity).

## Repair of 005906

After the functions ship: re-run `release_billing_jobs_for_deal(deal)` — the new
dedupe spawns the missing recurring job (`005906-LOCALSEO-2`, €233.87 monthly,
billing_active), then link the recurring payment's line to it and
`recompute_job_period_dates`. Its board placement then follows the normal
Fully-Paid flow. The 41 ClickUp multi-service deals are NOT auto-migrated —
the same re-run repairs any of them on demand (owner decides later).

## Testing

Rolled-back SQL probes on a synthetic dual-type deal: spawn produces 2 jobs w/
suffixed code; line-links bind by billing_type; ensure_recurring_payments
successor links to the recurring job; recompute gives each job its own dates;
one_time-only and single-service deals byte-identical behavior (regression
probes). Frontend: existing accounting tests + build.

## Changes / Revert

Fn bodies: each migration names its base file; revert = re-apply base (drift-
check live first, per standing rule). Frontend: git revert. 005906 repair:
archive the spawned job + unlink line (SQL noted in the migration header).
