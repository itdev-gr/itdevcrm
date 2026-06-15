# Meta Lead Ingestion (Zapier → CRM webhook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Facebook/Instagram lead-ad submissions in the CRM as `leads` rows via a secret-authenticated webhook that Zapier posts to — reusing the existing Zapier↔Meta connection, running alongside ClickUp.

**Architecture:** A single public Vercel function (`api/meta-lead.ts`) accepts a JSON payload (which the user maps from the Meta lead inside Zapier), authenticates with a shared secret, deduplicates on the Meta `leadgen_id`, and inserts a `lead` (`source='meta'`, raw payload in `source_data`) with the service-role client. Downstream is already built: the `leads_default_stage` trigger puts it in **New Lead**, and the welcome-email automation fires for `source='meta'`.

**Tech Stack:** Supabase Postgres, Vercel serverless (`@vercel/node`), Zapier (external, configured by the user).

**Chosen route:** Option ① (Zapier → CRM webhook). Option ② (direct Meta Lead Ads webhook, no Zapier) is a separate, much larger build (Facebook App + app review + Page-token lifecycle) and is **not** covered here.

**Assumptions:** ClickUp is unchanged — the user's existing Zap keeps sending to ClickUp and adds a step that also POSTs to this endpoint. Field mapping (Meta form fields → the JSON keys below) is configured **in Zapier**, so the CRM only defines the payload contract.

**Payload contract (what Zapier sends):**
```json
{
  "leadgen_id": "<Meta lead id, for dedup>",
  "full_name": "Maria Papadopoulou",
  "email": "maria@example.gr",
  "phone": "6912345678",
  "company": "Acme",            // optional
  "form_name": "Spring Promo",  // optional → becomes the lead title
  "campaign": "IG Reels",       // optional
  "notes": "Q: budget? A: 5k"   // optional → contact_info
}
```

**Note:** api functions must be self-contained (importing across `api/→src/` breaks Vercel bundling — see the PBX fix), so the mapping is inlined; the new `meta_leadgen_id` column isn't in generated types yet, so the insert casts `as never`.

---

## Task 1: Migration — `meta_leadgen_id` (idempotency)

**Files:** Create `supabase/migrations/20260615000007_lead_meta_leadgen_id.sql`. No unit test; verified by SQL.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260615000007_lead_meta_leadgen_id.sql
-- Dedup key for Meta lead-ad ingestion: the Facebook leadgen id. A partial
-- unique index lets the webhook be safely retried without duplicating a lead.
alter table public.leads add column meta_leadgen_id text;
create unique index leads_meta_leadgen_id_uniq
  on public.leads (meta_leadgen_id) where meta_leadgen_id is not null;

-- ROLLBACK:
--   drop index if exists public.leads_meta_leadgen_id_uniq;
--   alter table public.leads drop column if exists meta_leadgen_id;
```

- [ ] **Step 2: Apply it** (controller, Management API) and record version `20260615000007` (name `lead_meta_leadgen_id`) in `supabase_migrations.schema_migrations`.

- [ ] **Step 3: Verify**

```sql
select count(*) as has_col from information_schema.columns
 where table_name='leads' and column_name='meta_leadgen_id';
```
Expected: `has_col = 1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000007_lead_meta_leadgen_id.sql
git commit -m "feat(leads): meta_leadgen_id dedup column for Meta ingestion"
```

---

## Task 2: The webhook endpoint

**Files:** Create `api/meta-lead.ts`; Modify `vercel.json`. No unit test (Vercel handler, matching repo convention); verified by curl.

- [ ] **Step 1: Write the handler**

```ts
// api/meta-lead.ts
// Public Meta lead-ad ingestion. Zapier POSTs a mapped lead here.
//   POST /api/meta-lead?key=<secret>   (or header X-Meta-Secret)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function splitFullName(full: string): { first: string | null; last: string | null } {
  const t = (full ?? '').trim();
  if (!t) return { first: null, last: null };
  const parts = t.split(/\s+/);
  return { first: parts[0] ?? null, last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const secret = process.env.META_LEAD_SECRET;
  const provided = String(req.headers['x-meta-secret'] ?? req.query.key ?? '');
  if (!secret || provided.length !== secret.length || provided !== secret) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }

  const body = (typeof req.body === 'object' && req.body !== null)
    ? (req.body as Record<string, unknown>) : null;
  if (!body) { res.status(400).json({ error: 'invalid body' }); return; }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) { res.status(500).json({ error: 'server misconfigured' }); return; }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const leadgenId = str(body.leadgen_id);
  if (leadgenId) {
    const { data: existing } = await admin.from('leads').select('id').eq('meta_leadgen_id', leadgenId).limit(1);
    if (existing && existing.length > 0) {
      res.status(200).json({ ok: true, deduped: true, lead_id: existing[0].id }); return;
    }
  }

  const { first, last } = splitFullName(String(body.full_name ?? ''));
  const title = (str(body.form_name) ?? str(body.campaign) ?? 'Meta lead').slice(0, 200);

  const { data, error } = await admin
    .from('leads')
    .insert({
      source: 'meta',
      source_data: body,
      meta_leadgen_id: leadgenId,
      title,
      contact_first_name: first,
      contact_last_name: last,
      email: str(body.email),
      phone: str(body.phone),
      company_name: str(body.company),
      contact_info: str(body.notes),
    } as never)
    .select('id')
    .single();

  if (error || !data) { res.status(500).json({ error: error?.message ?? 'insert_failed' }); return; }
  res.status(200).json({ ok: true, lead_id: (data as { id: string }).id });
}
```

- [ ] **Step 2: Register in `vercel.json`**

Add `"api/meta-lead.ts": { "maxDuration": 10 }` to the existing `functions` object (alongside the offer-pdf / contract-pdf / pbx-lookup entries).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/meta-lead.ts vercel.json
git commit -m "feat(leads): public Meta lead webhook (Zapier ingestion)"
```

---

## Task 3: Env docs + Zapier runbook

**Files:** Modify `.env.example`; Create `docs/integrations/meta-leads.md`.

- [ ] **Step 1: Document the env var**

Append to `.env.example`:
```
# Shared secret for the Meta lead webhook (set the value only in Vercel)
META_LEAD_SECRET=
```

- [ ] **Step 2: Write the runbook**

```markdown
# Meta Lead Ingestion (Zapier) — Runbook

## Endpoint
`POST https://itdevcrm.vercel.app/api/meta-lead?key=<META_LEAD_SECRET>`
(or send the secret as header `X-Meta-Secret`). JSON body.

## Zapier setup
1. In your existing Facebook/Instagram Lead Ads Zap, add an action **Webhooks by Zapier → POST**.
2. URL: the endpoint above. Payload type: **JSON**.
3. Map the Meta lead fields to these keys: `leadgen_id` (the Meta lead/leadgen id — required for dedup), `full_name`, `email`, `phone`, `company` (optional), `form_name` (optional), `campaign` (optional), `notes` (optional, any extra Q&A).
4. Keep the existing ClickUp action — both run from the same Zap.

## Behaviour
- Creates a lead with `source='meta'`, the full payload in `source_data`, lands it in **New Lead**, and (if enabled) sends the welcome email.
- Retries are safe: a repeat `leadgen_id` returns `{ deduped: true }` and creates nothing.
- Wrong/missing secret → 401; non-POST → 405.

## Env
- `META_LEAD_SECRET` (Vercel) — shared secret. The webhook returns 401 until it's set.

## Changes / Revert
- Code: revert the `feat(leads): … Meta …` commits.
- DB: run the ROLLBACK in `20260615000007_lead_meta_leadgen_id.sql`.
- Vercel: remove `META_LEAD_SECRET` and the `api/meta-lead.ts` entry from `vercel.json`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/integrations/meta-leads.md
git commit -m "docs(leads): Meta lead webhook env + Zapier runbook"
```

---

## Task 4: Gate, push, go-live verify

- [ ] **Step 1: Gate**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all green.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Confirm the endpoint is live + gated** — `curl -s -o /dev/null -w '%{http_code}' -X POST https://itdevcrm.vercel.app/api/meta-lead` → expect `401`.

- [ ] **Step 4 (human prereq): Set `META_LEAD_SECRET` in Vercel** (generate a strong value), then redeploy.

- [ ] **Step 5: End-to-end test** — POST a sample Zapier-shaped payload with the secret:
```bash
curl -s -X POST "https://itdevcrm.vercel.app/api/meta-lead?key=$META_LEAD_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"leadgen_id":"TEST-1","full_name":"Test Meta","email":"t@example.test","phone":"6900000000","form_name":"Smoke Test"}'
```
Expect `{ "ok": true, "lead_id": "…" }`. Confirm the lead shows on the Sales board in **New Lead** (source = Meta). POST the same payload again → expect `{ "deduped": true }`. Delete the test lead afterward.

- [ ] **Step 6: Wire Zapier** per the runbook and send one real test lead.

---

## Human prerequisites (not code)
1. Generate `META_LEAD_SECRET`, set it in Vercel, redeploy.
2. Add the **Webhooks → POST** action to the existing Zap (per the runbook) with the field mapping.
