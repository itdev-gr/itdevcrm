# Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contracts feature: admin-managed contract templates with `{{placeholders}}`, per-client contracts auto-filled from the client card, branded PDF generation, and one-click "send PDF to client" via the existing Resend email pipeline.

**Architecture:** Mirrors the offers feature throughout. Two new tables (`contract_templates`, `contracts`) with RLS gated on the existing `clients` board permissions. PDF rendering reuses the Puppeteer-on-Vercel pattern (`api/offer-pdf.ts` → new `api/contract-pdf.ts`, bucket `contract-pdfs`). Sending extends the `send-email` edge function with storage-backed attachments (allowlisted buckets) and a new seeded `contract_send` email template. Placeholder resolution is a pure client-side function: picking a template snapshots the resolved text onto the contract, which stays editable.

**Tech Stack:** React + TypeScript + TanStack Query, Supabase (Postgres/RLS/Storage/Edge Functions), Resend, Puppeteer + @sparticuz/chromium on Vercel, i18next (en/el), Vitest + Testing Library.

**Decisions (confirmed with product owner):** templates + placeholders; PDF attached to the email (from `sales@itdev.gr`); contracts live on a client-card tab AND a global `/contracts` page; lifecycle `draft → sent → signed/declined` (manual status, no e-signature).

---

## Changes / Revert

**Changes:**
- New migration `supabase/migrations/20260611120000_contracts_schema.sql` (tables `contract_templates`, `contracts`, bucket `contract-pdfs`, seed row in `email_templates`)
- `send-email` edge function: new `attachments.ts` + wiring in `index.ts` (additive, backward-compatible)
- New Vercel functions `api/contract-pdf.ts`, `api/_contract-pdf-template.ts`
- New feature folder `src/features/contracts/` (pages, tab, badge, hooks)
- New lib `src/lib/contracts/placeholders.ts`
- Modified: `src/lib/queryKeys.ts`, `src/lib/i18n.ts`, `src/app/router.tsx`, `src/app/AdminLayout.tsx`, `src/components/layout/Sidebar.tsx`, `src/features/clients/ClientDetailPage.tsx`, `src/features/deals/DealDetailPage.tsx`, `src/i18n/locales/{en,el}/admin.json`, new `src/i18n/locales/{en,el}/contracts.json`, regenerated `src/types/supabase.ts`

**Revert:**
- `git revert` the commits (each task commits separately, all prefixed `feat(contracts)` / `feat(email)`)
- DB rollback SQL is in the migration header (drop tables, delete seed row, delete bucket)
- Redeploy `send-email` from the reverted tree: `npx supabase functions deploy send-email`

---

### Task 1: Database migration — contracts schema, storage bucket, email template seed

**Files:**
- Create: `supabase/migrations/20260611120000_contracts_schema.sql`
- Regenerate: `src/types/supabase.ts`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Contracts: admin-editable templates + per-client contracts with PDF + send.
-- Template bodies are plain text with {{placeholders}} resolved from the
-- client card at create time; the resolved body is snapshotted onto the
-- contract row and remains editable. PDFs land in the private
-- `contract-pdfs` bucket; sending goes through the send-email edge function
-- with the PDF attached (template key `contract_send`, seeded below).
--
-- Rollback:
--   delete from public.email_templates where key = 'contract_send';
--   drop table public.contracts;
--   drop table public.contract_templates;
--   drop function public.contracts_set_number();
--   drop sequence if exists contracts_seq;
--   delete from storage.objects where bucket_id = 'contract-pdfs';
--   delete from storage.buckets where id = 'contract-pdfs';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reusable contract templates (admin-managed, like email_templates).
-- ---------------------------------------------------------------------------
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contract_templates_set_updated_at
  before update on public.contract_templates
  for each row execute function public.set_updated_at();

alter table public.contract_templates enable row level security;
create policy contract_templates_select on public.contract_templates
  for select to authenticated using (true);
create policy contract_templates_mutate_admin on public.contract_templates
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Contracts. Access rides the `clients` board permissions.
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid references public.contract_templates(id) on delete set null,
  contract_number text,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft','sent','signed','declined')),
  pdf_path text,
  created_by uuid references public.profiles(user_id) default auth.uid(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_client on public.contracts (client_id);
create index contracts_status_recent on public.contracts (status, created_at desc);

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- contract_number generator: CTR-YYYYMM-#### (mirrors offers_set_number)
create sequence if not exists contracts_seq;
create or replace function public.contracts_set_number()
returns trigger language plpgsql as $$
begin
  if new.contract_number is null then
    new.contract_number := 'CTR-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('contracts_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger contracts_set_number_t before insert on public.contracts
  for each row execute function public.contracts_set_number();

alter table public.contracts enable row level security;

create policy contracts_select on public.contracts for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  );
create policy contracts_insert on public.contracts for insert to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  );
create policy contracts_update on public.contracts for update to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  );
create policy contracts_delete on public.contracts for delete to authenticated
  using (public.current_user_is_admin());

-- Realtime so client tabs pick up new contracts immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contracts'
  ) then
    execute 'alter publication supabase_realtime add table public.contracts';
  end if;
end $$;

-- Private storage bucket for generated PDFs (mirrors offer-pdfs).
insert into storage.buckets (id, name, public)
values ('contract-pdfs', 'contract-pdfs', false)
on conflict (id) do nothing;

drop policy if exists storage_contract_pdfs_select on storage.objects;
create policy storage_contract_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'contract-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  ));

-- ---------------------------------------------------------------------------
-- Email template for the send flow (admin-editable like the others).
-- ---------------------------------------------------------------------------
insert into public.email_templates (key, description, subject, body, variables, client_facing)
values (
  'contract_send',
  'Αποστολή σύμβασης σε πελάτη (PDF συνημμένο)',
  'Σύμβαση συνεργασίας {{contract_number}} — ITDEV',
  'Αγαπητέ/ή {{client_name}},

Σας αποστέλλουμε συνημμένη τη σύμβαση συνεργασίας «{{contract_title}}» ({{contract_number}}) σε μορφή PDF.

Παρακαλούμε διαβάστε την προσεκτικά και επιστρέψτε μας υπογεγραμμένο αντίγραφο.

Με εκτίμηση,
ITDEV',
  'client_name, contract_title, contract_number',
  true
)
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: `Applying migration 20260611120000_contracts_schema.sql... Finished supabase db push.`

- [ ] **Step 3: Regenerate DB types**

Run: `npm run types:gen`
Then: `grep -c "contract_templates\|contracts:" src/types/supabase.ts`
Expected: non-zero count (both tables present in the generated types).

- [ ] **Step 4: Verify the app still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260611120000_contracts_schema.sql src/types/supabase.ts
git commit -m "feat(contracts): schema — templates + contracts tables, pdf bucket, contract_send email template"
```

---

### Task 2: Placeholder resolver (pure lib, TDD)

**Files:**
- Create: `src/lib/contracts/placeholders.ts`
- Test: `src/lib/contracts/placeholders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  CONTRACT_PLACEHOLDERS,
  buildPlaceholderData,
  resolvePlaceholders,
} from './placeholders';

const client = {
  name: 'Acme SA',
  email: 'billing@acme.gr',
  phone: '2101234567',
  vat_number: 'EL123456789',
  address: 'Stadiou 1',
  city: 'Athens',
  postcode: '10564',
  country: 'Greece',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
};

describe('buildPlaceholderData', () => {
  it('maps client card fields to placeholder values', () => {
    const d = buildPlaceholderData(client, new Date(2026, 5, 11));
    expect(d.client_name).toBe('Acme SA');
    expect(d.contact_full_name).toBe('Maria Papadopoulou');
    expect(d.vat_number).toBe('EL123456789');
    expect(d.date).toBe('11/06/2026');
  });

  it('turns null fields into empty strings', () => {
    const d = buildPlaceholderData(
      { ...client, phone: null, contact_first_name: null, contact_last_name: null },
      new Date(2026, 5, 11),
    );
    expect(d.phone).toBe('');
    expect(d.contact_full_name).toBe('');
  });
});

describe('resolvePlaceholders', () => {
  it('replaces {{key}} tokens, tolerating inner whitespace', () => {
    const out = resolvePlaceholders(
      'Μεταξύ της ITDEV και της {{client_name}} ({{ vat_number }}), {{date}}.',
      buildPlaceholderData(client, new Date(2026, 5, 11)),
    );
    expect(out).toBe('Μεταξύ της ITDEV και της Acme SA (EL123456789), 11/06/2026.');
  });

  it('replaces unknown placeholders with an empty string', () => {
    expect(resolvePlaceholders('x {{nope}} y', {})).toBe('x  y');
  });
});

describe('CONTRACT_PLACEHOLDERS', () => {
  it('every advertised placeholder resolves to a defined value', () => {
    const d = buildPlaceholderData(client, new Date(2026, 5, 11));
    for (const key of CONTRACT_PLACEHOLDERS) {
      expect(d[key], key).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/contracts/placeholders.test.ts`
Expected: FAIL — cannot resolve `./placeholders`.

- [ ] **Step 3: Write the implementation**

```typescript
// Contract-template placeholder resolution. Values come from the client card;
// resolution happens once when a contract is created from a template — the
// resolved text is snapshotted onto the contract and stays editable.

export type ClientPlaceholderFields = {
  name: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
};

export const CONTRACT_PLACEHOLDERS = [
  'client_name',
  'contact_first_name',
  'contact_last_name',
  'contact_full_name',
  'email',
  'phone',
  'vat_number',
  'address',
  'city',
  'postcode',
  'country',
  'date',
] as const;

function formatDateGr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function buildPlaceholderData(
  client: ClientPlaceholderFields,
  today: Date = new Date(),
): Record<string, string> {
  const first = client.contact_first_name ?? '';
  const last = client.contact_last_name ?? '';
  return {
    client_name: client.name ?? '',
    contact_first_name: first,
    contact_last_name: last,
    contact_full_name: [first, last].filter(Boolean).join(' '),
    email: client.email ?? '',
    phone: client.phone ?? '',
    vat_number: client.vat_number ?? '',
    address: client.address ?? '',
    city: client.city ?? '',
    postcode: client.postcode ?? '',
    country: client.country ?? '',
    date: formatDateGr(today),
  };
}

export function resolvePlaceholders(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => data[key] ?? '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/contracts/placeholders.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contracts/
git commit -m "feat(contracts): placeholder resolver — client card fields into template bodies"
```

---

### Task 3: send-email edge function — attachment support (TDD)

The Resend API accepts `attachments: [{ filename, content }]` where `content` is base64. We add an additive, allowlisted `attachments` field to the send-email input: refs point at storage objects, the function downloads them with its service-role client and base64-encodes them. Buckets are allowlisted so a staff JWT cannot exfiltrate arbitrary storage objects through this path.

**Files:**
- Create: `supabase/functions/send-email/attachments.ts`
- Test: `supabase/functions/send-email/attachments.test.ts`
- Modify: `supabase/functions/send-email/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { validateAttachmentRefs, toBase64, fetchAttachments } from './attachments';

describe('validateAttachmentRefs', () => {
  it('accepts refs in allowlisted buckets', () => {
    const refs = validateAttachmentRefs([
      { bucket: 'contract-pdfs', path: 'contracts/abc.pdf', filename: 'CTR-202606-0001.pdf' },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].filename).toBe('CTR-202606-0001.pdf');
  });

  it('rejects non-allowlisted buckets', () => {
    expect(() =>
      validateAttachmentRefs([{ bucket: 'avatars', path: 'x', filename: 'x.pdf' }]),
    ).toThrow(/bucket not allowed/);
  });

  it('rejects more than 3 attachments and malformed refs', () => {
    const ref = { bucket: 'contract-pdfs', path: 'p', filename: 'f.pdf' };
    expect(() => validateAttachmentRefs([ref, ref, ref, ref])).toThrow(/too many/);
    expect(() => validateAttachmentRefs([{ bucket: 'contract-pdfs' }])).toThrow(/invalid attachment/);
    expect(() => validateAttachmentRefs('nope')).toThrow(/invalid attachment/);
  });
});

describe('toBase64', () => {
  it('encodes bytes, including > 32KB inputs (chunked)', () => {
    expect(toBase64(new TextEncoder().encode('hello'))).toBe(btoa('hello'));
    const big = new Uint8Array(100_000).fill(65);
    expect(toBase64(big)).toBe(btoa('A'.repeat(100_000)));
  });
});

describe('fetchAttachments', () => {
  const blobOf = (s: string) => ({
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(s).buffer as ArrayBuffer),
  });

  it('downloads each ref and returns Resend-shaped attachments', async () => {
    const storage = {
      from: (bucket: string) => ({
        download: (path: string) =>
          Promise.resolve({ data: blobOf(`${bucket}/${path}`), error: null }),
      }),
    };
    const out = await fetchAttachments(storage, [
      { bucket: 'contract-pdfs', path: 'contracts/a.pdf', filename: 'a.pdf' },
    ]);
    expect(out).toEqual([{ filename: 'a.pdf', content: btoa('contract-pdfs/contracts/a.pdf') }]);
  });

  it('throws when a download fails', async () => {
    const storage = {
      from: () => ({
        download: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
      }),
    };
    await expect(
      fetchAttachments(storage, [{ bucket: 'contract-pdfs', path: 'x', filename: 'x.pdf' }]),
    ).rejects.toThrow(/attachment download failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/send-email/attachments.test.ts`
Expected: FAIL — cannot resolve `./attachments`.

- [ ] **Step 3: Write the implementation**

```typescript
// Storage-backed email attachments for the send-email function.
// Refs are validated against a bucket allowlist (callers hold staff JWTs, but
// the download below runs service-role — never let arbitrary buckets through).

export type AttachmentRef = { bucket: string; path: string; filename: string };
export type ResendAttachment = { filename: string; content: string };

const ALLOWED_BUCKETS = new Set(['contract-pdfs', 'offer-pdfs']);
const MAX_ATTACHMENTS = 3;

export function validateAttachmentRefs(input: unknown): AttachmentRef[] {
  if (!Array.isArray(input)) throw new Error('invalid attachments: not an array');
  if (input.length > MAX_ATTACHMENTS) throw new Error('too many attachments (max 3)');
  return input.map((raw) => {
    const r = raw as Partial<AttachmentRef> | null;
    if (!r || typeof r.bucket !== 'string' || typeof r.path !== 'string' || typeof r.filename !== 'string') {
      throw new Error('invalid attachment ref');
    }
    if (!ALLOWED_BUCKETS.has(r.bucket)) throw new Error(`attachment bucket not allowed: ${r.bucket}`);
    return { bucket: r.bucket, path: r.path, filename: r.filename };
  });
}

export function toBase64(bytes: Uint8Array): string {
  // String.fromCharCode(...big) overflows the arg limit — chunk it.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

type StorageLike = {
  from(bucket: string): {
    download(path: string): Promise<{
      data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
      error: { message: string } | null;
    }>;
  };
};

export async function fetchAttachments(
  storage: StorageLike,
  refs: AttachmentRef[],
): Promise<ResendAttachment[]> {
  const out: ResendAttachment[] = [];
  for (const ref of refs) {
    const { data, error } = await storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      throw new Error(`attachment download failed (${ref.bucket}/${ref.path}): ${error?.message ?? 'no data'}`);
    }
    out.push({ filename: ref.filename, content: toBase64(new Uint8Array(await data.arrayBuffer())) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/send-email/attachments.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into `index.ts`**

Three exact edits to `supabase/functions/send-email/index.ts`:

Edit 1 — add the import (after the `templates.ts` import on line 4):

```typescript
import { renderTemplate, renderDbTemplate } from './templates.ts';
import { validateAttachmentRefs, fetchAttachments, type AttachmentRef, type ResendAttachment } from './attachments.ts';
```

Edit 2 — extend `SendInput`:

```typescript
type SendInput = {
  identity: Identity;
  to: string;
  templateKey: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  dryRun?: boolean;
  attachments?: AttachmentRef[];
};
```

Edit 3 — in `sendOne`, after the `if (dry) { ... }` block and before the `fetch('https://api.resend.com/emails', ...)` call, resolve attachments; then include them in the Resend body. Replace:

```typescript
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: id.from, reply_to: id.replyTo, to, subject: rendered.subject, html: rendered.html, text: rendered.text }),
  });
```

with:

```typescript
  let attachments: ResendAttachment[] = [];
  if (input.attachments && input.attachments.length > 0) {
    try {
      attachments = await fetchAttachments(admin.storage, validateAttachmentRefs(input.attachments));
    } catch (e) {
      await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error: String(e) });
      return { status: 'failed', error: String(e) };
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: id.from, reply_to: id.replyTo, to,
      subject: rendered.subject, html: rendered.html, text: rendered.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });
```

(`drain()` passes outbox rows without attachments — unaffected.)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — including the pre-existing `send-email/templates.test.ts`.

- [ ] **Step 7: Deploy the function**

Run: `npx supabase functions deploy send-email`
Expected: `Deployed Function send-email`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-email/
git commit -m "feat(email): send-email supports storage-backed attachments (allowlisted buckets)"
```

---

### Task 4: Query keys + data hooks (TDD on create)

**Files:**
- Modify: `src/lib/queryKeys.ts` (append after the `offersForDeal` entry, line 55)
- Create: `src/features/contracts/hooks/useContracts.ts`
- Create: `src/features/contracts/hooks/useCreateContract.ts`
- Create: `src/features/contracts/hooks/useUpdateContract.ts`
- Create: `src/features/contracts/hooks/useContractTemplates.ts`
- Test: `src/features/contracts/hooks/useCreateContract.test.tsx`

- [ ] **Step 1: Add query keys**

In `src/lib/queryKeys.ts`, after the `offersForDeal` line, add:

```typescript
  contracts: ['contracts'] as const,
  contract: (id: string) => ['contracts', 'detail', id] as const,
  contractsForClient: (clientId: string) => ['contracts', 'client', clientId] as const,
  contractTemplates: ['contract_templates'] as const,
```

- [ ] **Step 2: Write the failing test for useCreateContract**

`src/features/contracts/hooks/useCreateContract.test.tsx` (same mocking pattern as `src/features/clients/hooks/useUpsertClient.test.tsx`):

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, insert, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { single, insert, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useCreateContract } from './useCreateContract';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCreateContract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a draft contract and returns its id', async () => {
    single.mockResolvedValue({ data: { id: 'k1' }, error: null });
    const { result } = renderHook(() => useCreateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({
      client_id: 'c1', template_id: 't1', title: 'Σύμβαση Web', body: 'κείμενο',
    });
    expect(from).toHaveBeenCalledWith('contracts');
    expect(insert).toHaveBeenCalledWith({
      client_id: 'c1', template_id: 't1', title: 'Σύμβαση Web', body: 'κείμενο', status: 'draft',
    });
    expect(id).toBe('k1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const { result } = renderHook(() => useCreateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({ client_id: 'c1', template_id: null, title: 'x', body: 'y' }),
    ).rejects.toThrow('rls denied');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/contracts/hooks/useCreateContract.test.tsx`
Expected: FAIL — cannot resolve `./useCreateContract`.

- [ ] **Step 4: Implement the hooks**

`src/features/contracts/hooks/useCreateContract.ts`:

```typescript
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = {
  client_id: string;
  template_id: string | null;
  title: string;
  body: string;
};

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Input>({
    mutationFn: captureMutation('contracts', 'create', async (input: Input): Promise<string> => {
      const { data, error } = await supabase
        .from('contracts')
        .insert({ ...input, status: 'draft' })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create contract');
      return data.id;
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
```

`src/features/contracts/hooks/useContracts.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ContractRow = Database['public']['Tables']['contracts']['Row'];
export type ContractWithClient = ContractRow & {
  clients: { name: string | null; email: string | null } | null;
};

export function useContractsForClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.contractsForClient(clientId),
    enabled: !!clientId,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useContracts() {
  return useQuery({
    queryKey: queryKeys.contracts,
    queryFn: async (): Promise<ContractWithClient[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractWithClient[];
    },
  });
}

export function useContract(contractId: string) {
  return useQuery({
    queryKey: queryKeys.contract(contractId),
    enabled: !!contractId,
    queryFn: async (): Promise<ContractWithClient> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(name, email)')
        .eq('id', contractId)
        .single();
      if (error) throw error;
      return data as ContractWithClient;
    },
  });
}
```

`src/features/contracts/hooks/useUpdateContract.ts`:

```typescript
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Patch = {
  title?: string;
  body?: string;
  status?: 'draft' | 'sent' | 'signed' | 'declined';
  sent_at?: string | null;
};

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; patch: Patch }>({
    mutationFn: captureMutation('contracts', 'update', async ({ id, patch }) => {
      const { error } = await supabase.from('contracts').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    }),
    // All contract keys share the ['contracts'] root — one invalidation covers
    // the list, the client tab, and the detail view.
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
```

`src/features/contracts/hooks/useContractTemplates.ts`:

```typescript
import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { Database } from '@/types/supabase';

export type ContractTemplateRow = Database['public']['Tables']['contract_templates']['Row'];

export function useContractTemplates() {
  return useQuery({
    queryKey: queryKeys.contractTemplates,
    queryFn: async (): Promise<ContractTemplateRow[]> => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertContractTemplate() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, { id?: string; name: string; body: string }>({
    mutationFn: captureMutation('contracts', 'upsert_template', async ({ id, name, body }) => {
      if (id) {
        const { error } = await supabase.from('contract_templates').update({ name, body }).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from('contract_templates')
        .insert({ name, body })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create template');
      return data.id;
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contractTemplates }),
  });
}

export function useDeleteContractTemplate() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('contracts', 'delete_template', async (id: string) => {
      const { error } = await supabase.from('contract_templates').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contractTemplates }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/contracts/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queryKeys.ts src/features/contracts/
git commit -m "feat(contracts): query keys + data hooks (list, detail, create, update, templates CRUD)"
```

---

### Task 5: i18n — contracts namespace (en + el)

**Files:**
- Create: `src/i18n/locales/en/contracts.json`
- Create: `src/i18n/locales/el/contracts.json`
- Modify: `src/lib/i18n.ts`
- Modify: `src/i18n/locales/en/admin.json`, `src/i18n/locales/el/admin.json`

> Caution: never put literal `{{...}}` examples in translation strings — i18next would interpolate them away. Placeholder hints are rendered from `CONTRACT_PLACEHOLDERS` in code.

- [ ] **Step 1: Create `en/contracts.json`**

```json
{
  "nav": { "title": "Contracts" },
  "tab": { "title": "Contracts" },
  "status": { "draft": "Draft", "sent": "Sent", "signed": "Signed", "declined": "Declined" },
  "actions": {
    "new": "New contract",
    "view": "View",
    "save": "Save",
    "download_pdf": "Download PDF",
    "send": "Send to client",
    "create": "Create contract"
  },
  "list": {
    "title": "Contracts",
    "empty": "No contracts yet.",
    "client": "Client",
    "number": "Number",
    "contract_title": "Title",
    "status": "Status",
    "created": "Created",
    "pick_client": "Select client…"
  },
  "builder": {
    "title": "New contract",
    "missing_client": "Missing client — open this page from a client card.",
    "template": "Template",
    "pick_template": "Pick a template…",
    "contract_title": "Title",
    "body": "Contract text",
    "hint": "Client fields were filled in from the client card. Review and edit the text before saving."
  },
  "detail": {
    "confirm_send": "Send this contract as a PDF to {{email}}?",
    "sent_ok": "Contract sent.",
    "no_email": "The client card has no email address — add one to send.",
    "status": "Status"
  },
  "templates_admin": {
    "title": "Contract templates",
    "name": "Name",
    "body": "Body",
    "new": "New template",
    "save": "Save",
    "delete": "Delete",
    "empty": "No templates yet.",
    "placeholders_hint": "Available placeholders (filled from the client card):"
  }
}
```

- [ ] **Step 2: Create `el/contracts.json`**

```json
{
  "nav": { "title": "Συμβάσεις" },
  "tab": { "title": "Συμβάσεις" },
  "status": { "draft": "Πρόχειρη", "sent": "Απεσταλμένη", "signed": "Υπογεγραμμένη", "declined": "Απορρίφθηκε" },
  "actions": {
    "new": "Νέα σύμβαση",
    "view": "Προβολή",
    "save": "Αποθήκευση",
    "download_pdf": "Λήψη PDF",
    "send": "Αποστολή στον πελάτη",
    "create": "Δημιουργία σύμβασης"
  },
  "list": {
    "title": "Συμβάσεις",
    "empty": "Δεν υπάρχουν συμβάσεις ακόμα.",
    "client": "Πελάτης",
    "number": "Αριθμός",
    "contract_title": "Τίτλος",
    "status": "Κατάσταση",
    "created": "Δημιουργήθηκε",
    "pick_client": "Επιλέξτε πελάτη…"
  },
  "builder": {
    "title": "Νέα σύμβαση",
    "missing_client": "Λείπει ο πελάτης — ανοίξτε τη σελίδα από την καρτέλα πελάτη.",
    "template": "Πρότυπο",
    "pick_template": "Επιλέξτε πρότυπο…",
    "contract_title": "Τίτλος",
    "body": "Κείμενο σύμβασης",
    "hint": "Τα στοιχεία πελάτη συμπληρώθηκαν από την καρτέλα. Ελέγξτε και επεξεργαστείτε το κείμενο πριν την αποθήκευση."
  },
  "detail": {
    "confirm_send": "Αποστολή της σύμβασης σε PDF στο {{email}};",
    "sent_ok": "Η σύμβαση εστάλη.",
    "no_email": "Η καρτέλα πελάτη δεν έχει email — προσθέστε ένα για αποστολή.",
    "status": "Κατάσταση"
  },
  "templates_admin": {
    "title": "Πρότυπα συμβάσεων",
    "name": "Όνομα",
    "body": "Κείμενο",
    "new": "Νέο πρότυπο",
    "save": "Αποθήκευση",
    "delete": "Διαγραφή",
    "empty": "Δεν υπάρχουν πρότυπα ακόμα.",
    "placeholders_hint": "Διαθέσιμα placeholders (συμπληρώνονται από την καρτέλα πελάτη):"
  }
}
```

- [ ] **Step 3: Register the namespace in `src/lib/i18n.ts`**

Add imports after the `email.json` imports (lines 28-29):

```typescript
import enContracts from '@/i18n/locales/en/contracts.json';
import elContracts from '@/i18n/locales/el/contracts.json';
```

Add `'contracts'` to the `ns` array (line 38), `contracts: enContracts,` to the `en` resources block, and `contracts: elContracts,` to the `el` resources block.

- [ ] **Step 4: Add the admin nav label**

In `src/i18n/locales/en/admin.json`, inside the `nav` object, add: `"contract_templates": "Contract templates"`.
In `src/i18n/locales/el/admin.json`, inside the `nav` object, add: `"contract_templates": "Πρότυπα συμβάσεων"`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/ src/lib/i18n.ts
git commit -m "feat(contracts): en/el translations + namespace registration"
```

---

### Task 6: Contract templates admin page

**Files:**
- Create: `src/features/contracts/ContractTemplatesPage.tsx`
- Modify: `src/app/router.tsx` (admin children)
- Modify: `src/app/AdminLayout.tsx` (`SETTINGS_TABS`)

- [ ] **Step 1: Implement the page**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CONTRACT_PLACEHOLDERS } from '@/lib/contracts/placeholders';
import {
  useContractTemplates,
  useUpsertContractTemplate,
  useDeleteContractTemplate,
} from './hooks/useContractTemplates';

export function ContractTemplatesPage() {
  const { t } = useTranslation('contracts');
  const { data: templates = [], isLoading } = useContractTemplates();
  const upsert = useUpsertContractTemplate();
  const del = useDeleteContractTemplate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  function pick(id: string | null) {
    setSelectedId(id);
    const tpl = templates.find((x) => x.id === id);
    setName(tpl?.name ?? '');
    setBody(tpl?.body ?? '');
  }

  async function onSave() {
    const id = await upsert.mutateAsync({ id: selectedId ?? undefined, name, body });
    setSelectedId(id);
  }

  async function onDelete() {
    if (!selectedId) return;
    if (!window.confirm(t('templates_admin.delete') + '?')) return;
    await del.mutateAsync(selectedId);
    pick(null);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="w-full space-y-2 md:w-64">
        <Button size="sm" variant="outline" onClick={() => pick(null)}>
          + {t('templates_admin.new')}
        </Button>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('templates_admin.empty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => pick(tpl.id)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    tpl.id === selectedId ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'
                  }`}
                >
                  {tpl.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex-1 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-name">{t('templates_admin.name')}</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">{t('templates_admin.body')}</Label>
          <textarea
            id="tpl-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="text-xs text-slate-500">
          {t('templates_admin.placeholders_hint')}{' '}
          {CONTRACT_PLACEHOLDERS.map((p) => (
            <code key={p} className="mr-1 rounded bg-slate-100 px-1 py-0.5">{`{{${p}}}`}</code>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={!name.trim() || upsert.isPending}>
            {t('templates_admin.save')}
          </Button>
          {selectedId && (
            <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>
              {t('templates_admin.delete')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `src/app/router.tsx`, add with the other `lazyPage` declarations:

```typescript
const ContractTemplatesPage = lazyPage(
  () => import('@/features/contracts/ContractTemplatesPage'),
  'ContractTemplatesPage',
);
```

and in the `admin` children array, after `email-automations`:

```typescript
          { path: 'contract-templates', element: <ContractTemplatesPage /> },
```

- [ ] **Step 3: Add the admin tab**

In `src/app/AdminLayout.tsx`, append to `SETTINGS_TABS`:

```typescript
  { to: '/admin/contract-templates', key: 'contract_templates' },
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/features/contracts/ContractTemplatesPage.tsx src/app/router.tsx src/app/AdminLayout.tsx
git commit -m "feat(contracts): admin page for contract templates"
```

---

### Task 7: PDF generation — HTML template, Vercel API route, download hook

**Files:**
- Create: `api/_contract-pdf-template.ts`
- Create: `api/contract-pdf.ts`
- Create: `src/features/contracts/hooks/useDownloadContractPdf.ts`

- [ ] **Step 1: HTML template (`api/_contract-pdf-template.ts`)**

```typescript
export type ContractPdfInput = {
  contractNumber: string | null;
  title: string;
  body: string;
  clientName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: string | null;
  createdAt: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderContractHtml(input: ContractPdfInput): string {
  const bodyHtml = escapeHtml(input.body).replace(/\n/g, '<br/>');
  const date = new Date(input.createdAt).toLocaleDateString('el-GR');
  const clientLines = [
    input.clientName,
    input.contactName,
    [input.email, input.phone].filter(Boolean).join(' · '),
    input.vatNumber ? `ΑΦΜ: ${input.vatNumber}` : null,
    input.address,
  ]
    .filter((l): l is string => !!l && l.trim() !== '')
    .map(escapeHtml)
    .join('<br/>');

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0f172a; margin: 0; }
  .page { padding: 48px 56px; }
  .head { display: flex; justify-content: space-between; align-items: baseline;
          border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .num { font-size: 12px; color: #64748b; }
  h1 { font-size: 18px; margin: 28px 0 4px; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 24px; }
  .parties { display: flex; gap: 32px; margin: 24px 0; font-size: 12px; }
  .party { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; }
  .party b { display: block; margin-bottom: 6px; font-size: 11px;
             text-transform: uppercase; color: #64748b; }
  .body { font-size: 13px; line-height: 1.7; }
  .sigs { display: flex; gap: 48px; margin-top: 64px; font-size: 12px; }
  .sig { flex: 1; border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; }
  </style></head><body><div class="page">
  <div class="head"><div class="brand">ITDEV</div><div class="num">${escapeHtml(input.contractNumber ?? '')}</div></div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">${escapeHtml(date)}</div>
  <div class="parties">
    <div class="party"><b>Πάροχος / Provider</b>ITDEV<br/>itdev.gr<br/>sales@itdev.gr</div>
    <div class="party"><b>Πελάτης / Client</b>${clientLines}</div>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="sigs"><div class="sig">Για τον Πάροχο</div><div class="sig">Για τον Πελάτη</div></div>
  </div></body></html>`;
}
```

- [ ] **Step 2: API route (`api/contract-pdf.ts`)** — mirrors `api/offer-pdf.ts` exactly (deferred imports, user-JWT RLS read, service-role upload, single tall page):

```typescript
// All runtime imports are deferred until inside the handler so a failed
// dependency surfaces as a 500 with a real stack instead of Vercel's
// opaque FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('contract-pdf handler error:', e);
    if (!res.headersSent) {
      res.status(500).json({
        error: e?.message ?? 'unknown error',
        stack: e?.stack?.split('\n').slice(0, 8).join('\n') ?? null,
      });
    }
  }
}

async function runHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const contractId = typeof req.query.id === 'string' ? req.query.id : null;
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!contractId || !token) {
    res.status(400).json({ error: 'missing contract id or token' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const { renderContractHtml } = await import('./_contract-pdf-template.js');

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the contract.
  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { data: contract, error } = await userClient
    .from('contracts').select('*').eq('id', contractId).single();
  if (error || !contract) {
    res.status(404).json({ error: error?.message ?? 'not found' });
    return;
  }

  const { data: client } = await userClient
    .from('clients')
    .select('name, email, phone, vat_number, address, city, contact_first_name, contact_last_name')
    .eq('id', contract.client_id)
    .single();
  const contactName = client
    ? [client.contact_first_name, client.contact_last_name].filter(Boolean).join(' ')
    : '';

  const html = renderContractHtml({
    contractNumber: contract.contract_number,
    title: contract.title,
    body: contract.body,
    clientName: client?.name ?? null,
    contactName: contactName || null,
    email: client?.email ?? null,
    phone: client?.phone ?? null,
    vatNumber: client?.vat_number ?? null,
    address: [client?.address, client?.city].filter(Boolean).join(', ') || null,
    createdAt: contract.created_at,
  });

  const puppeteer = await import('puppeteer-core');
  const chromium = await import('@sparticuz/chromium');
  const executablePath = await chromium.default.executablePath();
  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    defaultViewport: chromium.default.defaultViewport,
    executablePath,
    headless: chromium.default.headless as boolean | 'new',
  });
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Single tall page; A4 height floor (see offer-pdf for the px→mm ratio).
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const pageHeightMm = Math.max(bodyHeight / 3.779527559, 297);
    pdf = await page.pdf({
      width: '210mm',
      height: `${pageHeightMm}mm`,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  } finally {
    await browser.close();
  }

  const path = `contracts/${contract.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('contract-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    res.status(500).json({ error: 'upload failed: ' + uploadErr.message });
    return;
  }

  await admin.from('contracts').update({ pdf_path: path }).eq('id', contract.id);

  const { data: signed } = await admin.storage
    .from('contract-pdfs').createSignedUrl(path, 60 * 5);
  res.status(200).json({ url: signed?.signedUrl ?? null });
}
```

- [ ] **Step 3: Download hook (`src/features/contracts/hooks/useDownloadContractPdf.ts`)**

```typescript
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDownloadContractPdf() {
  return useMutation({
    mutationFn: captureMutation('contracts', 'pdf', async (contractId: string): Promise<string> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/contract-pdf?id=${encodeURIComponent(contractId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PDF generation failed (${res.status}): ${text}`);
      }
      const { url } = (await res.json()) as { url: string | null };
      if (!url) throw new Error('signed URL was null');
      return url;
    }),
  });
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (The API route only runs on Vercel — it's smoke-tested after deploy in Task 13.)

- [ ] **Step 5: Commit**

```bash
git add api/contract-pdf.ts api/_contract-pdf-template.ts src/features/contracts/hooks/useDownloadContractPdf.ts
git commit -m "feat(contracts): puppeteer PDF endpoint + branded contract template + download hook"
```

---

### Task 8: Send-to-client hook (TDD)

Flow: regenerate the PDF (so it matches the latest saved text) → invoke `send-email` with the attachment ref → mark the contract `sent`.

**Files:**
- Create: `src/features/contracts/hooks/useSendContract.ts`
- Test: `src/features/contracts/hooks/useSendContract.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from, invoke, getSession } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const invoke = vi.fn();
  const getSession = vi.fn();
  return { eq, update, from, invoke, getSession };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from, functions: { invoke }, auth: { getSession } },
}));

import { useSendContract } from './useSendContract';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

const input = {
  contractId: 'k1',
  contractNumber: 'CTR-202606-0001',
  title: 'Σύμβαση Web',
  to: 'client@acme.gr',
  clientName: 'Acme SA',
};

describe('useSendContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ url: 'https://signed' }) }));
    invoke.mockResolvedValue({ data: { status: 'sent' }, error: null });
    eq.mockResolvedValue({ error: null });
  });

  it('regenerates the PDF, sends the email with the attachment, marks sent', async () => {
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync(input);

    expect(fetch).toHaveBeenCalledWith(
      '/api/contract-pdf?id=k1',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: {
        identity: 'sales',
        to: 'client@acme.gr',
        templateKey: 'contract_send',
        data: {
          client_name: 'Acme SA',
          contract_title: 'Σύμβαση Web',
          contract_number: 'CTR-202606-0001',
        },
        attachments: [
          { bucket: 'contract-pdfs', path: 'contracts/k1.pdf', filename: 'CTR-202606-0001.pdf' },
        ],
      },
    });
    expect(from).toHaveBeenCalledWith('contracts');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', sent_at: expect.any(String) }),
    );
  });

  it('throws and does not mark sent when the email fails', async () => {
    invoke.mockResolvedValue({ data: { status: 'failed', error: 'boom' }, error: null });
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync(input)).rejects.toThrow(/boom/);
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when PDF generation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('pdf err') }));
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync(input)).rejects.toThrow(/PDF generation failed/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/contracts/hooks/useSendContract.test.tsx`
Expected: FAIL — cannot resolve `./useSendContract`.

- [ ] **Step 3: Implement**

```typescript
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = {
  contractId: string;
  contractNumber: string;
  title: string;
  to: string;
  clientName: string;
};

export function useSendContract() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Input>({
    mutationFn: captureMutation('contracts', 'send', async (input: Input) => {
      // 1. Regenerate the PDF so the attachment matches the saved text.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/contract-pdf?id=${encodeURIComponent(input.contractId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PDF generation failed (${res.status}): ${text}`);
      }

      // 2. Email it via send-email with the storage-backed attachment.
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: 'sales',
          to: input.to,
          templateKey: 'contract_send',
          data: {
            client_name: input.clientName,
            contract_title: input.title,
            contract_number: input.contractNumber,
          },
          attachments: [
            {
              bucket: 'contract-pdfs',
              path: `contracts/${input.contractId}.pdf`,
              filename: `${input.contractNumber}.pdf`,
            },
          ],
        },
      });
      if (error) throw new Error(error.message);
      const status = (data as { status?: string; error?: string } | null)?.status;
      if (status !== 'sent' && status !== 'skipped') {
        throw new Error((data as { error?: string } | null)?.error ?? 'send failed');
      }

      // 3. Mark the contract as sent.
      const { error: updErr } = await supabase
        .from('contracts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', input.contractId);
      if (updErr) throw new Error(updErr.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/contracts/hooks/useSendContract.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/contracts/hooks/useSendContract.ts src/features/contracts/hooks/useSendContract.test.tsx
git commit -m "feat(contracts): send-to-client hook — regenerate PDF, email with attachment, mark sent"
```

---

### Task 9: Status badge + ContractsTab, wired into client card and deal page

**Files:**
- Create: `src/features/contracts/ContractStatusBadge.tsx`
- Create: `src/features/contracts/ContractsTab.tsx`
- Modify: `src/features/clients/ClientDetailPage.tsx`
- Modify: `src/features/deals/DealDetailPage.tsx`

> The client card redirects to the live deal when one exists (`ClientDetailPage.tsx:40-43`), so active clients are reached via the deal page — the tab must exist on BOTH pages.

- [ ] **Step 1: `ContractStatusBadge.tsx`**

```tsx
import { useTranslation } from 'react-i18next';

const COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  signed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
};

export function ContractStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('contracts');
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal ${COLORS[status] ?? COLORS.draft}`}>
      {t(`status.${status}`)}
    </span>
  );
}
```

- [ ] **Step 2: `ContractsTab.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { useContractsForClient } from './hooks/useContracts';
import { ContractStatusBadge } from './ContractStatusBadge';

export function ContractsTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation('contracts');
  const { data: contracts = [], isLoading } = useContractsForClient(clientId);

  return (
    <div className="space-y-3">
      <Button asChild size="sm">
        <Link to={`/contracts/new?clientId=${clientId}`}>+ {t('actions.new')}</Link>
      </Button>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {c.contract_number ?? c.id.slice(0, 8)}
                  <ContractStatusBadge status={c.status} />
                </div>
                <div className="text-[11px] text-slate-500">
                  {c.title} · {formatDate(c.created_at)}
                </div>
              </div>
              <Link to={`/contracts/${c.id}`} className="text-xs text-blue-600 underline">
                {t('actions.view')} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ClientDetailPage.tsx`**

Add the import next to the other feature-tab imports:

```typescript
import { ContractsTab } from '@/features/contracts/ContractsTab';
```

In the `TabsList` (after the `attachments` trigger, line ~107):

```tsx
          <TabsTrigger value="contracts">{t('contracts:tab.title')}</TabsTrigger>
```

After the `attachments` `TabsContent` (line ~124):

```tsx
        <TabsContent value="contracts" className="pt-4">
          <ContractsTab clientId={clientId} />
        </TabsContent>
```

- [ ] **Step 4: Wire into `DealDetailPage.tsx`**

Add the import next to the `OffersTab` import (line 22):

```typescript
import { ContractsTab } from '@/features/contracts/ContractsTab';
```

In the `TabsList` after the `offers` trigger (line ~220):

```tsx
          <TabsTrigger value="contracts">{t('contracts:tab.title')}</TabsTrigger>
```

After the offers `TabsContent` (find `<OffersTab dealId={dealId} />` at line ~256 and add below its closing `</TabsContent>`):

```tsx
        <TabsContent value="contracts" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          {deal.client_id && <ContractsTab clientId={deal.client_id} />}
        </TabsContent>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/contracts/ src/features/clients/ClientDetailPage.tsx src/features/deals/DealDetailPage.tsx
git commit -m "feat(contracts): contracts tab on client card and deal page"
```

---

### Task 10: Contract builder page + routes

**Files:**
- Create: `src/features/contracts/ContractBuilderPage.tsx`
- Modify: `src/app/router.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClient } from '@/features/clients/hooks/useClient';
import { buildPlaceholderData, resolvePlaceholders } from '@/lib/contracts/placeholders';
import { useContractTemplates } from './hooks/useContractTemplates';
import { useCreateContract } from './hooks/useCreateContract';

export function ContractBuilderPage() {
  const [params] = useSearchParams();
  const clientId = params.get('clientId') ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation('contracts');
  const { data: client, isLoading: clientLoading } = useClient(clientId);
  const { data: templates = [] } = useContractTemplates();
  const create = useCreateContract();
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  if (!clientId) return <div className="p-8 text-red-600">{t('builder.missing_client')}</div>;
  if (clientLoading) return <div className="p-8">…</div>;
  if (!client) return <div className="p-8 text-red-600">Not found</div>;

  function onPickTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl && client) {
      setTitle(tpl.name);
      setBody(resolvePlaceholders(tpl.body, buildPlaceholderData(client)));
    }
  }

  async function onSave() {
    const id = await create.mutateAsync({
      client_id: clientId,
      template_id: templateId || null,
      title,
      body,
    });
    navigate(`/contracts/${id}`);
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">{t('builder.title')}</h1>
        <p className="text-sm text-slate-500">{client.name}</p>
      </div>
      <div className="max-w-3xl space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-template">{t('builder.template')}</Label>
          <select
            id="ct-template"
            value={templateId}
            onChange={(e) => onPickTemplate(e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="">{t('builder.pick_template')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">{t('builder.contract_title')}</Label>
          <Input id="ct-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-body">{t('builder.body')}</Label>
          <textarea
            id="ct-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500">{t('builder.hint')}</p>
        </div>
        <Button onClick={onSave} disabled={!title.trim() || create.isPending}>
          {t('actions.create')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

Each task registers only the route for the page it creates, so every commit builds. In `src/app/router.tsx`, add the lazy declaration with the others:

```typescript
const ContractBuilderPage = lazyPage(
  () => import('@/features/contracts/ContractBuilderPage'),
  'ContractBuilderPage',
);
```

and in the ShellLayout children, after the `offers/:offerId` route (line ~203):

```typescript
      { path: 'contracts/new', element: <ContractBuilderPage /> },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/contracts/ContractBuilderPage.tsx src/app/router.tsx
git commit -m "feat(contracts): builder page — template pick + client auto-fill"
```

---

### Task 11: Contract detail page (edit / status / download / send)

**Files:**
- Create: `src/features/contracts/ContractDetailPage.tsx`
- Modify: `src/app/router.tsx` (add the `contracts/:contractId` route from Task 10's list)

- [ ] **Step 1: Implement the page**

```tsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/datetime';
import { useContract } from './hooks/useContracts';
import { useUpdateContract } from './hooks/useUpdateContract';
import { useDownloadContractPdf } from './hooks/useDownloadContractPdf';
import { useSendContract } from './hooks/useSendContract';
import { ContractStatusBadge } from './ContractStatusBadge';

const STATUSES = ['draft', 'sent', 'signed', 'declined'] as const;

export function ContractDetailPage() {
  const { contractId = '' } = useParams<{ contractId: string }>();
  const { t } = useTranslation('contracts');
  const { data: contract, isLoading, error } = useContract(contractId);
  const update = useUpdateContract();
  const download = useDownloadContractPdf();
  const send = useSendContract();
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !contract)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  const curTitle = title ?? contract.title;
  const curBody = body ?? contract.body;
  const dirty = curTitle !== contract.title || curBody !== contract.body;
  const clientEmail = contract.clients?.email ?? null;

  async function onSave() {
    await update.mutateAsync({ id: contractId, patch: { title: curTitle, body: curBody } });
    setTitle(null);
    setBody(null);
  }

  async function onDownload() {
    if (dirty) await onSave();
    const url = await download.mutateAsync(contractId);
    window.open(url, '_blank');
  }

  async function onSend() {
    if (!contract || !clientEmail) return;
    if (!window.confirm(t('detail.confirm_send', { email: clientEmail }))) return;
    if (dirty) await onSave();
    await send.mutateAsync({
      contractId,
      contractNumber: contract.contract_number ?? 'contract',
      title: curTitle,
      to: clientEmail,
      clientName: contract.clients?.name ?? '',
    });
    window.alert(t('detail.sent_ok'));
  }

  async function onChangeStatus(status: (typeof STATUSES)[number]) {
    await update.mutateAsync({ id: contractId, patch: { status } });
  }

  const busy = update.isPending || download.isPending || send.isPending;

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline">
            <h1 className="text-2xl font-bold">{contract.contract_number ?? contractId.slice(0, 8)}</h1>
            <ContractStatusBadge status={contract.status} />
          </div>
          <p className="text-xs text-slate-500">
            <Link to={`/clients/${contract.client_id}`} className="underline">
              {contract.clients?.name}
            </Link>
            {' · '}
            {formatDate(contract.created_at)}
            {contract.sent_at && <> · ✉️ {formatDate(contract.sent_at)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ct-status" className="text-sm">{t('detail.status')}:</Label>
          <select
            id="ct-status"
            value={contract.status}
            onChange={(e) => onChangeStatus(e.target.value as (typeof STATUSES)[number])}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-3xl space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">{t('builder.contract_title')}</Label>
          <Input id="ct-title" value={curTitle} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-body">{t('builder.body')}</Label>
          <textarea
            id="ct-body"
            value={curBody}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave} disabled={!dirty || busy}>{t('actions.save')}</Button>
          <Button variant="outline" onClick={onDownload} disabled={busy}>
            {t('actions.download_pdf')}
          </Button>
          <Button variant="outline" onClick={onSend} disabled={busy || !clientEmail}>
            ✉️ {t('actions.send')}
          </Button>
        </div>
        {!clientEmail && <p className="text-xs text-amber-600">{t('detail.no_email')}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/app/router.tsx`, add the lazy declaration:

```typescript
const ContractDetailPage = lazyPage(
  () => import('@/features/contracts/ContractDetailPage'),
  'ContractDetailPage',
);
```

and, after the `contracts/new` route:

```typescript
      { path: 'contracts/:contractId', element: <ContractDetailPage /> },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/contracts/ContractDetailPage.tsx src/app/router.tsx
git commit -m "feat(contracts): detail page — edit, status, download pdf, send to client"
```

---

### Task 12: Global contracts list page + sidebar link

**Files:**
- Create: `src/features/contracts/ContractsListPage.tsx`
- Modify: `src/app/router.tsx` (add the `contracts` route)
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/datetime';
import { useContracts } from './hooks/useContracts';
import { ContractStatusBadge } from './ContractStatusBadge';

function useClientOptions() {
  return useQuery({
    queryKey: ['contracts', 'client-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('archived', false)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function ContractsListPage() {
  const { t } = useTranslation('contracts');
  const navigate = useNavigate();
  const { data: contracts = [], isLoading } = useContracts();
  const { data: clientOptions = [] } = useClientOptions();
  const [newClientId, setNewClientId] = useState('');

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('list.title')}</h1>
        <div className="flex items-center gap-2">
          <select
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label={t('list.pick_client')}
          >
            <option value="">{t('list.pick_client')}</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!newClientId}
            onClick={() => navigate(`/contracts/new?clientId=${newClientId}`)}
          >
            + {t('actions.new')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('list.number')}</th>
                <th className="px-4 py-2">{t('list.client')}</th>
                <th className="px-4 py-2">{t('list.contract_title')}</th>
                <th className="px-4 py-2">{t('list.status')}</th>
                <th className="px-4 py-2">{t('list.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/contracts/${c.id}`} className="font-medium text-blue-600 underline">
                      {c.contract_number ?? c.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{c.clients?.name}</td>
                  <td className="px-4 py-2">{c.title}</td>
                  <td className="px-4 py-2"><ContractStatusBadge status={c.status} /></td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/app/router.tsx`, add the lazy declaration:

```typescript
const ContractsListPage = lazyPage(
  () => import('@/features/contracts/ContractsListPage'),
  'ContractsListPage',
);
```

and, before the `contracts/new` route:

```typescript
      { path: 'contracts', element: <ContractsListPage /> },
```

- [ ] **Step 3: Sidebar link**

In `src/components/layout/Sidebar.tsx`, inside the sales section (after the `/sales/kanban` NavLink, line ~102):

```tsx
          <NavLink
            to="/contracts"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('contracts:nav.title')}
          </NavLink>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/contracts/ContractsListPage.tsx src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(contracts): global contracts list + sidebar entry"
```

---

### Task 13: Final verification, deploy, end-to-end smoke test

- [ ] **Step 1: Full local verification**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Push to main (no PR — direct push per project convention)**

```bash
git push origin main
```

Vercel auto-deploys. Confirm the deployment succeeds (Vercel dashboard or MCP `get_deployment_build_logs`).

- [ ] **Step 3: Smoke test on the deployed app** (account: test@test.gr / 123456789 — admin)

1. **Template:** Admin → Settings → Contract templates → create "Σύμβαση Συνεργασίας" with a body using `{{client_name}}`, `{{vat_number}}`, `{{contact_full_name}}`, `{{date}}`. Save → reload → persists.
2. **Create:** open a client card (or deal page) → Contracts tab → "New contract" → pick the template → verify client fields are filled into the text → Create → lands on detail page with a `CTR-2026xx-xxxx` number and Draft badge.
3. **PDF:** Download PDF → opens a branded PDF with the parties block and contract text (Greek characters render correctly).
4. **Send:** temporarily set the client's email to info@itdev.gr → Send to client → confirm → status flips to Sent → the email arrives from sales@itdev.gr with the PDF attached. Restore the client's email afterwards.
5. **Status:** mark the contract Signed → badge updates on detail, client tab, and `/contracts` list.
6. **Permissions spot-check:** a sales (non-admin) user can see/create contracts but does NOT see the Contract templates admin tab.

- [ ] **Step 4: Verify email log**

In Supabase, check `email_log` has a `contract_send` row with `status = 'sent'`.
