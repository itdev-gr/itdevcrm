# Meta lead ingestion — columnar (COL$) mapping (design)

**Date:** 2026-06-22
**Status:** Approved (user delegated: "do what's best so this works smooth")
**Author:** Marios + Claude

## Problem

Meta leads now arrive **Meta → Excel → Zapier → `/api/meta-lead`** as a **positional,
prefixed spreadsheet row**, with payload keys `COL$A`…`COL$S` (+ `id`, `row`). The webhook
expects named fields, so it parses **nothing**: every Meta lead since 2026-06-15 (36 rows
checked) landed with **empty name / phone / email** and title "Meta lead". Meta intake is
effectively broken. Dedup is also wrong — it keys on the sheet row number (`id`=1188), not
the real Meta lead id.

## Goal

Teach the webhook to read the `COL$` format: land Name/Phone/Email/Form-title in their
cells, dedup on the real Meta lead id, and put the campaign context + form answers into the
lead-info field — without breaking the existing named-field path.

## Ground truth (from live `source_data`)

```
COL$A l:987882727319006        -> Meta lead id (dedup)        strip "l:"
COL$B 2026-06-22T00:51:45-05:00-> submitted time
COL$C ag:120240335093640494    -> ad id
COL$D Προώθηση ανεύρεσης…       -> ad name
COL$E as:120240335093500494    -> ad set id
COL$F [20/12/2025] Προωθείται… -> ad set name
COL$G c:120240335093400494     -> campaign id
COL$H [20/12/2025] Προωθείται… -> campaign name
COL$I f:711549071695221        -> form id
COL$J AI SEO για σύγχρονες…     -> form name (-> Title)
COL$K false                    -> is_organic
COL$L fb | ig                  -> platform (Facebook/Instagram)
COL$M ναι | δεν_είμαι_σίγουρος  -> form answer
COL$N Maria Ziarou             -> full name (-> Name)
COL$O p:+306940702133          -> phone (-> Phone)  strip "p:"
COL$P mziarou@gmail.com        -> email (-> Email)
COL$Q Αυτοαπασχολούμενος        -> form answer
COL$R https://matinaspell.com/ -> form answer / website if URL
COL$S CREATED                  -> status (ignore)
id/row 1188                    -> sheet row number (NOT a lead id)
```

## Design

### Approach — hybrid parser in `api/meta-lead.ts`

A pure, exported helper `parseColumnarMetaLead(data)` returns a normalized object when the
payload is the COL$ format (detected by presence of `COL$A`/`COL$N`), else `null`. The
handler uses it when present; otherwise it keeps the existing `pick()`-based named-field
resolution unchanged. This fixes the columnar case now and stays compatible with any future
named/header payload (so labeled "Question: Answer" would flow automatically if the user
later enables sheet headers in Zapier — no code change).

### `parseColumnarMetaLead(data)` → fields

- `leadgenId` = strip `l:` from `COL$A`
- `fullName` = `COL$N`; `email` = `COL$P`; `phone` = strip `p:` from `COL$O`
- `formName` = `COL$J` (→ lead title)
- `website` = `COL$R` when it looks like a URL (`^https?://` or `domain.tld`), else null
- `platform` = `COL$L` mapped `fb`→`Facebook`, `ig`→`Instagram`, else raw
- campaign context = `COL$H` (campaign), `COL$F` (ad set), `COL$D` (ad)
- `submitted` = date part of `COL$B` formatted `DD/MM/YYYY`
- `answers` = non-empty of [`COL$M`, `COL$Q`, `COL$R` (only if not used as website)]
- `noteBlock` (→ `contact_info`):
  ```
  Form: <J>
  Campaign: <H>
  Ad set: <F>
  Ad: <D>
  Platform: <Facebook/Instagram>
  Submitted: <DD/MM/YYYY>
  Answers:
  - <answer>
  - <answer>
  ```
  (each line only when its value exists)

### Handler wiring

After building `data`, call `parseColumnarMetaLead(data)`:
- if non-null → use its `leadgenId/fullName/email/phone/website/formName/noteBlock`
  (company = null; there is no company column).
- else → existing `pick()` resolution + generic notes builder (unchanged).
Then the shared path continues as today: `payload.leadgen_id = leadgenId` (now the real id),
dedup on `source_data->>leadgen_id`, split name, `title = formName ?? 'Meta lead'`,
`find_lead_duplicates`, insert into `lead_intake` (held for review).

The full raw payload is still stored in `source_data` (nothing lost), so the answers remain
recoverable even before labels exist.

## Data flow

```
Zapier row {COL$A..S,id,row} -> /api/meta-lead
  -> parseColumnarMetaLead -> {name,phone,email,website,formName,leadgenId,noteBlock}
  -> dedup on real leadgenId (COL$A)
  -> insert lead_intake (held, duplicates flagged as today)
```

## Error handling

- Missing/blank columns → that field is null (no crash); a row with no name/phone/email
  still inserts (held for review) as today.
- Non-columnar payloads are untouched (fall back to the named-field path).
- Auth, dedup, and the intake insert are unchanged.

## Testing

- **Unit (vitest)** on `parseColumnarMetaLead` with a real captured payload:
  strips `l:`/`p:`, maps name/phone/email/form, maps `fb`→Facebook, builds the note block
  with campaign + answers, treats a URL `COL$R` as website (and omits it from answers),
  returns `null` for a non-columnar payload.
- **Post-deploy live check:** confirm the next real Meta lead lands in `lead_intake` with
  name/phone/email populated and `source_data->>leadgen_id` = the `l:` id (not the row #).

## Changes / Revert

- Only `api/meta-lead.ts` (add `parseColumnarMetaLead` + the handler branch) + a unit test.
- No DB migration. Ships via push → Vercel deploy. Revert = revert the commit.

## Out of scope

- Labeled "Question: Answer" for M/Q/R (needs sheet headers in Zapier; hybrid parser already
  supports it when/if added).
- Backfilling the 36 already-blank Meta rows (they remain in the queue; can be re-sent or
  discarded manually).
- Mapping ad/adset/campaign IDs to dedicated columns (kept in `source_data` only).
