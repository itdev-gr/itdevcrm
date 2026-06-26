# Hosting board (`/tech/hosting`)

Cards are **jobs** for hosting subscriptions (usually yearly).

## Current state — no stages

The hosting board has **no pipeline stages configured**, so hosting jobs
spawn with no stage and the kanban shows empty columns 0. Hosting clients
are managed from **Hosting → My Clients** (`/tech/hosting/clients`) and
through Accounting → Recurring (renewal dates, amounts, overdue flags),
which is where the real hosting workflow lives today.

## What still works

- Jobs are created normally on **Partial Payment** (🔒 blocked until Paid In
  Full) and carry their yearly/monthly amounts into the recurring revenue
  views.
- **Hosting is never blocked for non-payment.** When a client doesn't pay and
  accounting's deal goes **On Hold**, their other services are blocked but the
  hosting job keeps running (we don't take a server offline over an unpaid
  invoice). Accounting can still manually block/unblock it if needed.

## If the team wants a kanban later

Add stages for the `hosting` board in `pipeline_stages` (e.g. Setup → Active
→ Renewal due → Cancelled); jobs spawn into the lowest-position stage
automatically — no code change needed.
