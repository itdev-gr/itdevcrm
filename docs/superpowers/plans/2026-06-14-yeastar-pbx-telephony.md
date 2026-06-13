# Yeastar PBX Telephony Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the ITDevCRM to the agency's Yeastar PBX in two directions — an inbound caller-ID lookup endpoint (the PBX asks "who is +30 69…?" and the CRM answers with the contact) and outbound click-to-call (`tel:` links on every phone number so an agent's softphone dials with one click).

**Architecture:** Inbound is a single public Vercel serverless function (`api/pbx-lookup.ts`) guarded by a shared secret; it normalizes the incoming number to a Greek 10-digit "national key", matches it against `clients`/`leads` (incl. secondary numbers) via a Postgres RPC backed by indexed generated columns, and returns the exact `{ "contact": {…} }` JSON Yeastar specified. Outbound is a small reusable `<CallLink>` React component rendering `tel:` anchors, dropped into the ~5 places phone numbers display. All matching/mapping logic lives in pure, unit-tested helpers under `src/lib/phone/`; the handler and migration are verified by explicit curl/SQL checks because the repo does not unit-test Vercel handlers.

**Tech Stack:** Vite + React 19 (SPA, React Router 7), TypeScript strict, Vitest + Testing Library, Supabase Postgres, Vercel serverless (`@vercel/node`), Tailwind 4 + shadcn/ui, lucide-react icons.

---

## Scope

**In scope (v1):** inbound caller-ID lookup + outbound `tel:` click-to-call.
**Out of scope (later phase):** call logging (the `POST` call-data endpoint + call-history table/UI). Yeastar's team asked about it; it is deliberately deferred.

## Decisions locked

- Outbound mechanism: **`tel:` links** (no PBX API credentials; the agent's registered softphone handles the dial).
- Inbound match scope: **clients + leads**, including `additional_contacts` secondary phones on clients.
- Auth: **shared secret**, accepted as either `X-PBX-Secret` header **or** `?key=` query param (PBX uses whichever it supports). Optional source-IP allowlist left as a follow-up.
- Number matching: reduce every number to its **last 10 digits** (strips `+30` / `0030` / `30` country code and all separators). Greek mobiles and landlines are 10 national digits, so this is a reliable key.

## File Structure

| File | Responsibility | New/Modify |
| --- | --- | --- |
| `src/lib/phone/normalize.ts` | Pure helpers: `normalizePhone` (national key) + `phoneToTelHref` | Create |
| `src/lib/phone/normalize.test.ts` | Unit tests for both helpers | Create |
| `src/lib/phone/mapContact.ts` | Pure `toYeastarContact(row, appBase)` → Yeastar JSON shape | Create |
| `src/lib/phone/mapContact.test.ts` | Unit tests for the mapper | Create |
| `supabase/migrations/20260614000001_pbx_phone_lookup.sql` | `phone_normalized` generated columns + indexes + `find_contact_by_phone` RPC | Create |
| `api/pbx-lookup.ts` | Public lookup handler: auth, normalize, RPC, map, respond | Create |
| `vercel.json` | Register the new function (maxDuration) | Modify |
| `src/components/CallLink.tsx` | Reusable `tel:` link component | Create |
| `src/components/CallLink.test.tsx` | Component test | Create |
| `src/features/clients/ClientsListPage.tsx` | Use `CallLink` for phone cell | Modify |
| `src/features/accounting/AccountingClientsPage.tsx` | Use `CallLink` for phone cell | Modify |
| `src/features/sales/SalesKanbanPage.tsx` | Use `CallLink` on lead cards | Modify |
| `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx` | Use `CallLink` for client phone | Modify |
| `src/features/clients/ClientForm.tsx` | Call action next to phone input | Modify |
| `.env.example` | Document `PBX_LOOKUP_SECRET` / `PBX_DEEPLINK_BASE` | Modify |
| `docs/integrations/yeastar-pbx.md` | Runbook: PBX config URL, env, test checklist, REVERT | Create |

---

## Phase A — Inbound caller-ID lookup

### Task 1: Phone normalization + tel-href helpers

**Files:**
- Create: `src/lib/phone/normalize.ts`
- Test: `src/lib/phone/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/phone/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneToTelHref } from './normalize';

describe('normalizePhone', () => {
  it('reduces any Greek format to the last 10 national digits', () => {
    expect(normalizePhone('+30 691 234 5678')).toBe('6912345678');
    expect(normalizePhone('691 234 5678')).toBe('6912345678');
    expect(normalizePhone('00306912345678')).toBe('6912345678');
    expect(normalizePhone('+30 210 1234567')).toBe('2101234567');
  });
  it('returns empty string for withheld / junk / too-short numbers', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone('anonymous')).toBe('');
    expect(normalizePhone('123')).toBe('');
  });
});

describe('phoneToTelHref', () => {
  it('builds a tel: URI, assuming +30 for bare 10-digit numbers', () => {
    expect(phoneToTelHref('691 234 5678')).toBe('tel:+306912345678');
    expect(phoneToTelHref('+1 234 567 8900')).toBe('tel:+12345678900');
  });
  it('returns null when there is nothing dialable', () => {
    expect(phoneToTelHref('')).toBeNull();
    expect(phoneToTelHref(null)).toBeNull();
    expect(phoneToTelHref('12')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/phone/normalize.test.ts`
Expected: FAIL — `Failed to resolve import './normalize'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/phone/normalize.ts
// Reduce any phone string to its Greek "national key": the last 10 significant
// digits. This strips a +30 / 0030 / 30 country code and every separator, so a
// stored "69 1234 5678" and an inbound "+306912345678" collapse to the same key.
// Returns '' for anything under 10 digits (withheld / anonymous / junk).
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

// Build a tel: URI for a clickable call link. Bare 10-digit Greek numbers get a
// +30 prefix; numbers that already carry a + keep their country code. Returns
// null when there are too few digits to dial.
export function phoneToTelHref(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  const onlyDigits = trimmed.replace(/[^0-9]/g, '');
  if (onlyDigits.length < 7) return null;
  if (trimmed.startsWith('+')) return `tel:+${onlyDigits}`;
  if (onlyDigits.length === 10) return `tel:+30${onlyDigits}`;
  return `tel:${onlyDigits}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/phone/normalize.test.ts`
Expected: PASS (2 files? no — 1 file, 4 tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone/normalize.ts src/lib/phone/normalize.test.ts
git commit -m "feat(pbx): phone normalization + tel-href helpers"
```

---

### Task 2: Map a DB row to the Yeastar contact JSON

**Files:**
- Create: `src/lib/phone/mapContact.ts`
- Test: `src/lib/phone/mapContact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/phone/mapContact.test.ts
import { describe, it, expect } from 'vitest';
import { toYeastarContact } from './mapContact';

const row = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Acme SA',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
  email: 'maria@acme.gr',
  phone: '+30 210 1234567',
  source: 'client' as const,
};

describe('toYeastarContact', () => {
  it('maps a client row into the Yeastar contact envelope', () => {
    const out = toYeastarContact(row, 'https://crm.itdev.gr/');
    expect(out).toEqual({
      contact: {
        id: '11111111-2222-3333-4444-555555555555',
        firstname: 'Maria',
        lastname: 'Papadopoulou',
        company: 'Acme SA',
        email: 'maria@acme.gr',
        businessphone: '+30 210 1234567',
        mobilephone: '',
        url: 'https://crm.itdev.gr/clients/11111111-2222-3333-4444-555555555555',
      },
    });
  });

  it('points lead rows at the sales route and tolerates null fields', () => {
    const out = toYeastarContact(
      { ...row, source: 'lead', contact_first_name: null, contact_last_name: null, email: null },
      'https://crm.itdev.gr',
    );
    expect(out.contact.firstname).toBe('');
    expect(out.contact.email).toBe('');
    expect(out.contact.url).toBe(
      'https://crm.itdev.gr/sales/leads/11111111-2222-3333-4444-555555555555',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/phone/mapContact.test.ts`
Expected: FAIL — `Failed to resolve import './mapContact'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/phone/mapContact.ts
// Shape returned by the find_contact_by_phone RPC.
export type ContactRow = {
  id: string;
  name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  source: 'client' | 'lead';
};

// Exact envelope Yeastar's PBX expects back on a caller-ID lookup.
export type YeastarContact = {
  contact: {
    id: string;
    firstname: string;
    lastname: string;
    company: string;
    email: string;
    businessphone: string;
    mobilephone: string;
    url: string;
  };
};

export function toYeastarContact(row: ContactRow, appBase: string): YeastarContact {
  const base = appBase.replace(/\/+$/, '');
  const path = row.source === 'client' ? 'clients' : 'sales/leads';
  return {
    contact: {
      id: row.id,
      firstname: row.contact_first_name ?? '',
      lastname: row.contact_last_name ?? '',
      company: row.name ?? '',
      email: row.email ?? '',
      businessphone: row.phone ?? '',
      mobilephone: '',
      url: `${base}/${path}/${row.id}`,
    },
  };
}
```

> Note: Yeastar's example shows a numeric `id`; we send the CRM's UUID string. Yeastar treats `id` as opaque and uses `url` for the click-through, so this is fine. The `/sales/leads/:id` path must match the app's lead-detail route — if the router uses a different path, adjust `path` here and in the test together.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/phone/mapContact.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone/mapContact.ts src/lib/phone/mapContact.test.ts
git commit -m "feat(pbx): map DB row to Yeastar contact JSON"
```

---

### Task 3: Migration — normalized columns + lookup RPC

**Files:**
- Create: `supabase/migrations/20260614000001_pbx_phone_lookup.sql`

This task has no unit test (DB layer); it is verified by SQL queries in Step 3.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000001_pbx_phone_lookup.sql
-- =============================================================================
-- PBX caller-ID lookup: normalized phone keys + matcher RPC
-- =============================================================================

-- National key = last 10 digits after stripping non-digits (drops +30/0030/30).
alter table public.clients
  add column phone_normalized text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

alter table public.leads
  add column phone_normalized text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

create index clients_phone_normalized on public.clients (phone_normalized) where archived = false;
create index leads_phone_normalized on public.leads (phone_normalized);

-- Match a 10-digit national key against clients (primary + additional_contacts)
-- and leads. SECURITY DEFINER so the service-role caller bypasses RLS cleanly;
-- the calling endpoint enforces the shared-secret gate.
create or replace function public.find_contact_by_phone(p_key text)
returns table (
  id uuid,
  name text,
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.contact_first_name, t.contact_last_name, t.email, t.phone, t.source
  from (
    -- 1: client primary phone
    select 1 as pri, c.id, c.name, c.contact_first_name, c.contact_last_name,
           c.email, c.phone, 'client'::text as source
    from public.clients c
    where c.archived = false
      and char_length(p_key) = 10
      and c.phone_normalized = p_key

    union all

    -- 2: client additional_contacts secondary phone
    select 2 as pri, c.id, c.name,
           ac->>'full_name' as contact_first_name, '' as contact_last_name,
           ac->>'email' as email, ac->>'phone' as phone, 'client'::text as source
    from public.clients c,
         jsonb_array_elements(coalesce(c.additional_contacts, '[]'::jsonb)) ac
    where c.archived = false
      and char_length(p_key) = 10
      and right(regexp_replace(coalesce(ac->>'phone', ''), '[^0-9]', '', 'g'), 10) = p_key

    union all

    -- 3: lead primary phone
    select 3 as pri, l.id, l.name, l.contact_first_name, l.contact_last_name,
           l.email, l.phone, 'lead'::text as source
    from public.leads l
    where char_length(p_key) = 10
      and l.phone_normalized = p_key
  ) t
  order by t.pri
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run to fully revert this migration):
--   drop function if exists public.find_contact_by_phone(text);
--   drop index if exists public.leads_phone_normalized;
--   drop index if exists public.clients_phone_normalized;
--   alter table public.leads   drop column if exists phone_normalized;
--   alter table public.clients drop column if exists phone_normalized;
-- ---------------------------------------------------------------------------
```

> If the `leads` table has no `name` column, change line `select 3 as pri, l.id, l.name, …` to `l.company` or `null::text` to match the real column (confirm against `supabase/migrations/20260502000017_leads_table.sql`).

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or apply via the Supabase SQL editor against the project).
Expected: `Applying migration 20260614000001_pbx_phone_lookup.sql... done`.

- [ ] **Step 3: Verify with SQL**

Pick a real client that has a phone, then in the Supabase SQL editor:

```sql
-- replace with a digits-only national key from a known client
select * from public.find_contact_by_phone('6912345678');
```
Expected: exactly one row, `source = 'client'`, with that client's name/email.
Also confirm a miss returns zero rows:
```sql
select count(*) from public.find_contact_by_phone('0000000000');  -- expect 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000001_pbx_phone_lookup.sql
git commit -m "feat(pbx): normalized phone columns + find_contact_by_phone RPC"
```

---

### Task 4: Public lookup endpoint + Vercel config

**Files:**
- Create: `api/pbx-lookup.ts`
- Modify: `vercel.json`

No unit test (Vercel handler, matching repo convention); verified by curl in Step 4.

- [ ] **Step 1: Write the handler**

```ts
// api/pbx-lookup.ts
// Public caller-ID lookup for the Yeastar PBX.
//   GET /api/pbx-lookup?phone=<callerID>&key=<secret>
//   GET /api/pbx-lookup?phone=<callerID>           (with header X-PBX-Secret)
// Returns Yeastar's { "contact": {…} } envelope on a hit, 404 on a miss.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '../src/lib/phone/normalize';
import { toYeastarContact, type ContactRow } from '../src/lib/phone/mapContact';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.PBX_LOOKUP_SECRET;
  const provided = String(req.headers['x-pbx-secret'] ?? req.query.key ?? '');
  if (!secret || provided.length !== secret.length || provided !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const raw = String(req.query.phone ?? req.query.callerID ?? '');
  const key = normalizePhone(raw);
  if (!key) {
    res.status(400).json({ error: 'missing or invalid phone' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc('find_contact_by_phone', { p_key: key });
  if (error) {
    res.status(500).json({ error: 'lookup failed' });
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as ContactRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const appBase =
    process.env.PBX_DEEPLINK_BASE ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://crm.itdev.gr';
  res.status(200).json(toYeastarContact(row, appBase));
}
```

- [ ] **Step 2: Register the function in `vercel.json`**

Add the `api/pbx-lookup.ts` entry to the existing `functions` object so it reads:

```json
  "functions": {
    "api/offer-pdf.ts": {
      "maxDuration": 60,
      "includeFiles": "node_modules/@sparticuz/chromium/**"
    },
    "api/contract-pdf.ts": {
      "maxDuration": 60,
      "includeFiles": "node_modules/@sparticuz/chromium/**"
    },
    "api/pbx-lookup.ts": {
      "maxDuration": 10
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the `../src/lib/phone/*` relative imports resolve from `api/`).

- [ ] **Step 4: Verify against a deploy preview**

Set `PBX_LOOKUP_SECRET` in the Vercel preview env, deploy, then (substitute the real secret + a known number):

```bash
# hit — expect 200 + {"contact":{…}}
curl -s "https://<preview>.vercel.app/api/pbx-lookup?phone=6912345678&key=$PBX_LOOKUP_SECRET"
# wrong secret — expect 401
curl -s -o /dev/null -w '%{http_code}\n' "https://<preview>.vercel.app/api/pbx-lookup?phone=6912345678&key=wrong"
# unknown number — expect 404
curl -s -o /dev/null -w '%{http_code}\n' "https://<preview>.vercel.app/api/pbx-lookup?phone=0000000000&key=$PBX_LOOKUP_SECRET"
```
Expected: JSON contact / `401` / `404` respectively.

- [ ] **Step 5: Commit**

```bash
git add api/pbx-lookup.ts vercel.json
git commit -m "feat(pbx): public caller-ID lookup endpoint"
```

---

## Phase B — Outbound click-to-call (`tel:` links)

### Task 5: `CallLink` component

**Files:**
- Create: `src/components/CallLink.tsx`
- Test: `src/components/CallLink.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/CallLink.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallLink } from './CallLink';

describe('CallLink', () => {
  it('renders a tel: anchor for a dialable number', () => {
    render(<CallLink phone="691 234 5678" />);
    const link = screen.getByRole('link', { name: /691 234 5678/ });
    expect(link).toHaveAttribute('href', 'tel:+306912345678');
  });

  it('renders a plain placeholder when there is nothing to dial', () => {
    render(<CallLink phone={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CallLink.test.tsx`
Expected: FAIL — `Failed to resolve import './CallLink'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/CallLink.tsx
import { Phone } from 'lucide-react';
import { phoneToTelHref } from '@/lib/phone/normalize';

type CallLinkProps = {
  phone: string | null | undefined;
  className?: string;
};

// Renders a phone number as a click-to-call tel: link (the agent's softphone
// handles the dial). Falls back to a plain placeholder when not dialable.
export function CallLink({ phone, className }: CallLinkProps) {
  const href = phoneToTelHref(phone);
  if (!href) return <span className={className}>{phone || '—'}</span>;
  return (
    <a
      href={href}
      className={className ?? 'inline-flex items-center gap-1 text-blue-600 hover:underline'}
      title="Κλήση"
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {phone}
    </a>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CallLink.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/CallLink.tsx src/components/CallLink.test.tsx
git commit -m "feat(pbx): CallLink tel: component"
```

---

### Task 6: Wire `CallLink` into the clients list

**Files:**
- Modify: `src/features/clients/ClientsListPage.tsx:53`

- [ ] **Step 1: Add the import**

After line 7 (`import { BlockBadge } …`), add:

```tsx
import { CallLink } from '@/components/CallLink';
```

- [ ] **Step 2: Swap the phone cell**

Replace:

```tsx
                <td className="py-2 pr-4">{c.phone}</td>
```

with:

```tsx
                <td className="py-2 pr-4">
                  <CallLink phone={c.phone} />
                </td>
```

- [ ] **Step 3: Verify build + existing tests pass**

Run: `npm run typecheck && npx vitest run src/features/clients`
Expected: typecheck clean; clients tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/ClientsListPage.tsx
git commit -m "feat(pbx): click-to-call in clients list"
```

---

### Task 7: Wire `CallLink` into the accounting clients table

**Files:**
- Modify: `src/features/accounting/AccountingClientsPage.tsx:137`

- [ ] **Step 1: Add the import**

Add near the other imports at the top of the file:

```tsx
import { CallLink } from '@/components/CallLink';
```

- [ ] **Step 2: Swap the phone cell**

Replace:

```tsx
                <td className="px-3 py-2 text-slate-600">{c.phone ?? '—'}</td>
```

with:

```tsx
                <td className="px-3 py-2 text-slate-600">
                  <CallLink phone={c.phone} />
                </td>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run src/features/accounting`
Expected: typecheck clean; tests PASS (or "no test files" for that path — acceptable).

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting/AccountingClientsPage.tsx
git commit -m "feat(pbx): click-to-call in accounting clients table"
```

---

### Task 8: Wire `CallLink` into sales lead cards

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx`

- [ ] **Step 1: Inspect the current phone render**

Run: `grep -n "phone" src/features/sales/SalesKanbanPage.tsx`
Identify the JSX expression that renders the lead's phone (e.g. `{lead.phone}` inside the card).

- [ ] **Step 2: Add the import**

Add near the top imports:

```tsx
import { CallLink } from '@/components/CallLink';
```

- [ ] **Step 3: Swap the render**

Replace the bare phone expression found in Step 1, e.g.:

```tsx
{lead.phone}
```

with:

```tsx
<CallLink phone={lead.phone} />
```

> Drag-and-drop note: the kanban card is draggable (`@dnd-kit`). If clicking the link is swallowed by a drag handler, add `onClick={(e) => e.stopPropagation()}` to the `CallLink`'s anchor by wrapping it in a `<span onClick={(e) => e.stopPropagation()}>`. Verify by clicking the number in the running app (Task 12 smoke test).

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run src/features/sales`
Expected: typecheck clean; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/SalesKanbanPage.tsx
git commit -m "feat(pbx): click-to-call on sales lead cards"
```

---

### Task 9: Wire `CallLink` into the assigned-task detail dialog

**Files:**
- Modify: `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx`
- Test: `src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx` (exists — keep green)

- [ ] **Step 1: Inspect the current phone render**

Run: `grep -n "phone" src/features/assigned_tasks/AssignedTaskDetailDialog.tsx`
Identify the JSX that renders `client.phone` (e.g. `{task.client?.phone}`).

- [ ] **Step 2: Add the import**

```tsx
import { CallLink } from '@/components/CallLink';
```

- [ ] **Step 3: Swap the render**

Replace the bare client-phone expression (from Step 1), e.g.:

```tsx
{task.client?.phone}
```

with:

```tsx
<CallLink phone={task.client?.phone} />
```

- [ ] **Step 4: Verify the existing dialog test still passes**

Run: `npx vitest run src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`
Expected: PASS. If the test asserted the raw phone text and now finds it inside a link, the text query still matches (link text contains the number); if it broke, update the assertion to `getByRole('link', { name: /<number>/ })`.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/AssignedTaskDetailDialog.tsx
git commit -m "feat(pbx): click-to-call in assigned task detail"
```

---

### Task 10: Call action next to the client edit form phone field

**Files:**
- Modify: `src/features/clients/ClientForm.tsx` (phone input around lines 122–129)

- [ ] **Step 1: Add the import**

```tsx
import { CallLink } from '@/components/CallLink';
```

- [ ] **Step 2: Render a call action under the phone input**

Immediately after the `<PermissionAwareInput … id="phone" … />` block, add:

```tsx
{phone ? (
  <div className="mt-1 text-xs">
    <CallLink phone={phone} />
  </div>
) : null}
```

(`phone` is already in component state at line 34: `const [phone, setPhone] = useState(initial?.phone ?? '')`.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run src/features/clients`
Expected: typecheck clean; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/ClientForm.tsx
git commit -m "feat(pbx): click-to-call beside client form phone"
```

---

## Phase C — Config, docs, handoff

### Task 11: Env documentation + PBX runbook

**Files:**
- Modify: `.env.example`
- Create: `docs/integrations/yeastar-pbx.md`

- [ ] **Step 1: Document env vars in `.env.example`**

Append:

```
# Yeastar PBX caller-ID lookup (set the secret value only in Vercel, never commit it)
PBX_LOOKUP_SECRET=
# Base URL used to build the deep-link back into the CRM from the PBX popup
PBX_DEEPLINK_BASE=https://crm.itdev.gr
```

- [ ] **Step 2: Write the runbook**

```markdown
# Yeastar PBX Integration — Runbook

## Inbound caller-ID lookup
- Endpoint: `GET https://<crm-domain>/api/pbx-lookup?phone={CALLER_NUMBER}&key=<PBX_LOOKUP_SECRET>`
  - The PBX may instead send the secret as header `X-PBX-Secret`.
- Response on a hit (HTTP 200): `{ "contact": { id, firstname, lastname, company, email, businessphone, mobilephone, url } }`
- Miss → HTTP 404; bad/blank number → 400; wrong/missing secret → 401.
- Matching: number reduced to its last 10 digits, checked against client primary phones,
  client additional-contact phones, and lead phones.

## Config to give Yeastar's tech department
- The URL template above, with their caller-number variable substituted for `{CALLER_NUMBER}`.
- The shared secret value (kept only in Vercel env `PBX_LOOKUP_SECRET`).
- (Optional) their PBX public IP, if we later add an IP allowlist.

## Outbound click-to-call
- Phone numbers in the CRM render as `tel:` links. The dial is handled by whatever
  softphone is registered as the `tel:` handler on the agent's machine (e.g. Yeastar Linkus).
- Each agent must have that softphone installed and set as the default tel handler.

## Env vars
- `PBX_LOOKUP_SECRET` (Vercel) — shared secret for the lookup endpoint.
- `PBX_DEEPLINK_BASE` (Vercel) — base URL for the CRM deep-link in the popup.

## Smoke test
1. `curl` the endpoint with a known number + secret → expect the contact JSON.
2. Place a real call from a phone whose number is on a client → the call-center app shows the contact.
3. In the CRM, click a phone number → the softphone dials.

## Changes / Revert
- Code: revert commits tagged `feat(pbx): …` on `main`.
- DB: run the ROLLBACK block at the bottom of
  `supabase/migrations/20260614000001_pbx_phone_lookup.sql`.
- Vercel: remove `PBX_LOOKUP_SECRET` / `PBX_DEEPLINK_BASE` and the `api/pbx-lookup.ts`
  entry from `vercel.json`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/integrations/yeastar-pbx.md
git commit -m "docs(pbx): env + Yeastar integration runbook"
```

---

### Task 12: Full-suite gate + push

- [ ] **Step 1: Run the whole test suite + lint + typecheck**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all green, 0 lint warnings.

- [ ] **Step 2: Push to main**

```bash
git push origin main
```

- [ ] **Step 3: Production smoke test**

Follow the runbook smoke test against production with a real inbound call and a click-to-call.

---

## Changes / Revert (summary)

- **New code:** `src/lib/phone/*`, `src/components/CallLink.tsx`, `api/pbx-lookup.ts`, migration `20260614000001_pbx_phone_lookup.sql`, runbook.
- **Modified:** `vercel.json`, `.env.example`, 5 feature components (phone render → `CallLink`).
- **Revert:** `git revert` the `feat(pbx)`/`docs(pbx)` commits; run the migration ROLLBACK block; delete the two Vercel env vars.

## Human prerequisites (not code — see chat for the split)

1. Confirm with Yeastar's tech dept whether the PBX can send a header vs only a templated URL (defaults cover both).
2. Provide the CRM's production domain for `PBX_DEEPLINK_BASE` (ties into the pending APP_BASE roadmap item).
3. Set `PBX_LOOKUP_SECRET` in Vercel and hand the same value to the tech dept.
4. Ensure each agent's softphone is installed and registered as the `tel:` handler; tell me which softphone if it needs a non-`tel:` scheme.
5. Configure the PBX with the endpoint URL once deployed, and do the live test call.
