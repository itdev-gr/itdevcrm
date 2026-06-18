# Country backfill from phone (leads + clients)

Date: 2026-06-18
Type: one-time production data backfill (no schema change)

## What

Set `country` (Greece / Cyprus) from the stored phone number on every lead and
every client. Deals have no `country` column — a deal's country comes from its
client — so "deals" were covered by backfilling `clients`.

## Rule

Classify the raw phone:
- `+357` / `00357` / leading `357`, **or** a bare 8-digit number starting `9`
  (Cypriot mobile) → **Cyprus**.
- `+30` / `0030`, **or** a 10-digit Greek national number (`2x…` / `6x…`) →
  **Greece**.
- Anything else (wrong length / junk / non-GR-CY) → **left unchanged** (NULL).
  NULL already defaults to Greece VAT (24%) in billing, so this is safe.

Only rows whose detected value differed from the current value were written.
A pre-write scan found **0 conflicts** (no existing country value disagreed with
its phone), so no manually-entered data was overwritten.

## Result

| Table | Rows | → Greece (new) | → Cyprus (new) | Left blank | Final: Greece / Cyprus / blank |
|---|---|---|---|---|---|
| leads | 3,987 | 3,491 | 456 | 18 | 3,509 / 460 / 18 |
| clients | 478 | 422 | 40 | 3 | 435 / 40 / 3 |

Prior non-null values (preserved, untouched): 23 leads, 13 clients.

## Changes / Revert

- Only the `country` column on `public.leads` and `public.clients` was changed.
- Full prior snapshot (every row's id + prior country) saved at
  `docs/superpowers/backups/2026-06-18-country-backfill-prior-values.json`.
- **Revert:** restore each row's `country` to the value in the snapshot. Because
  every changed row was previously NULL (0 conflicts), the revert is equivalent
  to setting `country = NULL` for all rows now set, while leaving the 23 + 13
  prior-set rows as they are.
