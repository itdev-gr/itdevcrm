# Combined "Attachments" Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Model split:** every implementer subagent MUST be dispatched with `model: "opus"`.

**Spec:** `docs/superpowers/specs/2026-07-08-combined-attachments-tab-design.md`

**Goal:** Merge the separate Attachments / Offers / Pro Formas / Contracts tabs on the deal, lead, and client detail pages into ONE tab named "Attachments" (stacked sections), adding a per-row PDF download button that surfaces the auto-uploaded PDFs — without touching any offer/pro-forma/contract operation, API endpoint, or storage bucket.

**Architecture:** A new shared `CombinedAttachmentsTab` component composes the four existing panels (`AttachmentsPanel`, `OffersTab`, `ProFormasTab`, `ContractsTab`) as stacked card sections. The three list components each gain a small "PDF" row button that reuses the existing download hooks (`useDownloadOfferPdf` / `useDownloadProFormaPdf` / `useDownloadContractPdf`) via a new popup-blocker-safe `openPdfInNewTab` helper. The three detail pages swap their separate tabs for the combined one.

**Tech Stack:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), TanStack Query, react-i18next (namespaces: `sales`, `contracts`, `deals`, `leads`, `clients`), shadcn/ui (`Button`, `Tabs`), Vitest + @testing-library/react (jsdom), Tailwind.

## Global Constraints

- **Do NOT touch:** `api/offer-pdf.ts`, `api/proforma-pdf.ts`, `api/contract-pdf.ts`, the storage buckets (`offer-pdfs`, `proforma-pdfs`, `contract-pdfs`, `attachments`), `useSendContract.ts`, any builder/detail page under `src/features/offers|proformas|contracts`, `LeadForm.tsx`, routes in `src/app/router.tsx`, or anything under `supabase/`.
- The lead Overview tab's inline `AttachmentsPanel` section in `LeadDetailPage.tsx` stays exactly as-is (only the tabs change).
- `DealServiceAttachments` (deal Overview) and the job page's `AttachmentsPanel hideKinds={...}` are out of scope — do not modify.
- Verification gate is `npm run build` (tsc -b + `eslint --max-warnings=0` + vite build). It is STRICTER than `tsc --noEmit`; an unused import or variable fails the build — remove imports/variables that become unused.
- The vitest suite runs against PROD Supabase — NEVER run the whole suite (`npm run test:run` with no args). Only run the specific test files named in each task; all new tests mock every network-touching hook.
- Tests import `'@/lib/i18n'` to initialize i18next; assert on `data-testid` / hardcoded strings, never on translated copy.
- Existing hardcoded-English idiom in `OffersTab`/`ProFormasTab` (e.g. "View →", "No offers yet.") is intentional — match it; the "PDF" button label is language-neutral and hardcoded in all three lists.
- Commit after every task with the exact message given. Do not push until the final task. End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The repo owner sometimes commits in the same tree mid-session: before the final push, run `git log --oneline -5` and `git status` and stop if anything unexpected appears.
- Untracked files `g.sql`, `gg.json`, `gp.json` at repo root belong to the owner — never add or delete them. Always `git add` explicit paths, never `git add -A`.

---

### Task 1: `openPdfInNewTab` helper

Popup-blocker-safe "generate then open" used by all three PDF row buttons. Mirrors the pattern already used in `OfferDetailPage.tsx:104-124`.

**Files:**
- Create: `src/lib/openPdfInNewTab.ts`
- Test: `src/lib/openPdfInNewTab.test.ts`

**Interfaces:**
- Consumes: nothing (plain browser APIs).
- Produces: `export async function openPdfInNewTab(generate: () => Promise<string>): Promise<void>` — Tasks 2–4 call it as `void openPdfInNewTab(() => download.mutateAsync(id))`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/openPdfInNewTab.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPdfInNewTab } from './openPdfInNewTab';

type FakeTab = { document: { write: ReturnType<typeof vi.fn> }; location: { href: string }; close: ReturnType<typeof vi.fn> };

function fakeTab(): FakeTab {
  return { document: { write: vi.fn() }, location: { href: '' }, close: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openPdfInNewTab', () => {
  it('opens a tab synchronously and points it at the signed URL', async () => {
    const tab = fakeTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await openPdfInNewTab(() => Promise.resolve('https://signed.example/x.pdf'));
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.href).toBe('https://signed.example/x.pdf');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the tab and alerts on failure', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await openPdfInNewTab(() => Promise.reject(new Error('boom')));
    expect(tab.close).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/openPdfInNewTab.test.ts`
Expected: FAIL — cannot resolve `./openPdfInNewTab`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/openPdfInNewTab.ts`:

```ts
/**
 * Open a tab synchronously — inside the click gesture — so the browser's
 * popup blocker doesn't kill it after the multi-second PDF render, then
 * point the already-open tab at the signed URL.
 */
export async function openPdfInNewTab(generate: () => Promise<string>): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.document.write('Generating PDF…');
  try {
    const url = await generate();
    if (tab) tab.location.href = url;
    else window.location.href = url; // popup blocked anyway → use current tab
  } catch (err) {
    tab?.close();
    alert((err as Error).message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/openPdfInNewTab.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openPdfInNewTab.ts src/lib/openPdfInNewTab.test.ts
git commit -m "feat(attachments): popup-safe openPdfInNewTab helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PDF row button on OffersTab

**Files:**
- Modify: `src/features/offers/OffersTab.tsx` (38 lines — full replacement below)
- Test: `src/features/offers/OffersTab.test.tsx` (new)

**Interfaces:**
- Consumes: `openPdfInNewTab(generate)` from Task 1; existing `useDownloadOfferPdf()` (`useMutation` — `mutateAsync(offerId: string): Promise<string>`, `isPending: boolean`); existing `useOffersForLead(id)` / `useOffersForDeal(id)` queries.
- Produces: `OffersTab({ leadId?, dealId? })` — unchanged signature, consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/features/offers/OffersTab.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/offer.pdf'));
vi.mock('./hooks/useDownloadOfferPdf', () => ({
  useDownloadOfferPdf: () => ({ mutateAsync, isPending: false }),
}));

const offers = [
  {
    id: 'off-1',
    offer_number: 'OFF-0001',
    status: 'sent',
    totals: { total: 100 },
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useOffersForLeadOrDeal', () => ({
  useOffersForLead: () => ({ data: [], isLoading: false }),
  useOffersForDeal: () => ({ data: offers, isLoading: false }),
}));

import { OffersTab } from './OffersTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('OffersTab', () => {
  it('renders the offer row with a View link', () => {
    render(<OffersTab dealId="deal-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/OFF-0001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View →' })).toHaveAttribute('href', '/offers/off-1');
  });

  it('downloads the PDF for the clicked row', () => {
    render(<OffersTab dealId="deal-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('off-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/offers/OffersTab.test.tsx`
Expected: first test PASSES (existing behavior), second FAILS — no button named "PDF".

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/features/offers/OffersTab.tsx` with:

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useDownloadOfferPdf } from './hooks/useDownloadOfferPdf';
import { useOffersForLead, useOffersForDeal } from './hooks/useOffersForLeadOrDeal';

type Props = { leadId?: string; dealId?: string };

export function OffersTab({ leadId, dealId }: Props) {
  const lead = useOffersForLead(leadId ?? '');
  const deal = useOffersForDeal(dealId ?? '');
  const download = useDownloadOfferPdf();
  const offers = (leadId ? lead.data : deal.data) ?? [];
  const isLoading = leadId ? lead.isLoading : deal.isLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (offers.length === 0) return <p className="text-sm text-muted-foreground">No offers yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {offers.map((o) => {
        const total = (o.totals as { total?: number } | null)?.total ?? 0;
        return (
          <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <div>
              <div className="font-medium">
                {o.offer_number ?? o.id.slice(0, 8)}{' '}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {o.status}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(o.created_at)} · {formatEur(Number(total))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => void openPdfInNewTab(() => download.mutateAsync(o.id))}
              >
                {download.isPending ? '…' : 'PDF'}
              </Button>
              <Link to={`/offers/${o.id}`} className="text-blue-600 underline text-xs dark:text-blue-400">View →</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/offers/OffersTab.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/offers/OffersTab.tsx src/features/offers/OffersTab.test.tsx
git commit -m "feat(offers): per-row PDF download button on OffersTab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PDF row button on ProFormasTab

**Files:**
- Modify: `src/features/proformas/ProFormasTab.tsx` (39 lines — full replacement below)
- Test: `src/features/proformas/ProFormasTab.test.tsx` (new)

**Interfaces:**
- Consumes: `openPdfInNewTab` (Task 1); existing `useDownloadProFormaPdf()` (`mutateAsync(proFormaId: string): Promise<string>`, `isPending`); existing `useProFormasForLead` / `useProFormasForDeal`.
- Produces: `ProFormasTab({ leadId?, dealId? })` — unchanged signature, consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/features/proformas/ProFormasTab.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/proforma.pdf'));
vi.mock('./hooks/useDownloadProFormaPdf', () => ({
  useDownloadProFormaPdf: () => ({ mutateAsync, isPending: false }),
}));

const proFormas = [
  {
    id: 'prf-1',
    pro_forma_number: 'PRF-0001',
    status: 'draft',
    totals: { total: 80 },
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useProFormasForLeadOrDeal', () => ({
  useProFormasForLead: () => ({ data: [], isLoading: false }),
  useProFormasForDeal: () => ({ data: proFormas, isLoading: false }),
}));

import { ProFormasTab } from './ProFormasTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('ProFormasTab', () => {
  it('renders the pro forma row with a View link', () => {
    render(<ProFormasTab dealId="deal-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/PRF-0001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View →' })).toHaveAttribute('href', '/proformas/prf-1');
  });

  it('downloads the PDF for the clicked row', () => {
    render(<ProFormasTab dealId="deal-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('prf-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/proformas/ProFormasTab.test.tsx`
Expected: first test PASSES, second FAILS — no button named "PDF".

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/features/proformas/ProFormasTab.tsx` with:

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useDownloadProFormaPdf } from './hooks/useDownloadProFormaPdf';
import { useProFormasForLead, useProFormasForDeal } from './hooks/useProFormasForLeadOrDeal';

type Props = { leadId?: string; dealId?: string };

export function ProFormasTab({ leadId, dealId }: Props) {
  const lead = useProFormasForLead(leadId ?? '');
  const deal = useProFormasForDeal(dealId ?? '');
  const download = useDownloadProFormaPdf();
  const proFormas = (leadId ? lead.data : deal.data) ?? [];
  const isLoading = leadId ? lead.isLoading : deal.isLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (proFormas.length === 0)
    return <p className="text-sm text-muted-foreground">No pro formas yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {proFormas.map((p) => {
        const total = (p.totals as { total?: number } | null)?.total ?? 0;
        return (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <div>
              <div className="font-medium">
                {p.pro_forma_number ?? p.id.slice(0, 8)}{' '}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {p.status}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(p.created_at)} · {formatEur(Number(total))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => void openPdfInNewTab(() => download.mutateAsync(p.id))}
              >
                {download.isPending ? '…' : 'PDF'}
              </Button>
              <Link to={`/proformas/${p.id}`} className="text-blue-600 underline text-xs dark:text-blue-400">View →</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/proformas/ProFormasTab.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/proformas/ProFormasTab.tsx src/features/proformas/ProFormasTab.test.tsx
git commit -m "feat(proformas): per-row PDF download button on ProFormasTab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: PDF row button on ContractsTab

**Files:**
- Modify: `src/features/contracts/ContractsTab.tsx` (45 lines — full replacement below)
- Test: `src/features/contracts/ContractsTab.test.tsx` (new)

**Interfaces:**
- Consumes: `openPdfInNewTab` (Task 1); existing `useDownloadContractPdf()` (`mutateAsync(contractId: string): Promise<string>`, `isPending`); existing `useContractsForClient(clientId)`; existing `ContractStatusBadge`.
- Produces: `ContractsTab({ clientId: string })` — unchanged signature, consumed by Task 5. Keeps the "+ New contract" button (`/contracts/new?clientId=…`).

- [ ] **Step 1: Write the failing test**

Create `src/features/contracts/ContractsTab.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/contract.pdf'));
vi.mock('./hooks/useDownloadContractPdf', () => ({
  useDownloadContractPdf: () => ({ mutateAsync, isPending: false }),
}));

const contracts = [
  {
    id: 'ctr-1',
    contract_number: 'CTR-202607-0001',
    title: 'Web dev contract',
    status: 'signed',
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useContracts', () => ({
  useContractsForClient: () => ({ data: contracts, isLoading: false, error: null }),
}));

import { ContractsTab } from './ContractsTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('ContractsTab', () => {
  it('renders the contract row and keeps the new-contract link', () => {
    render(<ContractsTab clientId="cli-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/CTR-202607-0001/)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/contracts/new?clientId=cli-1')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/contracts/ctr-1')).toBe(true);
  });

  it('downloads the PDF for the clicked row', () => {
    render(<ContractsTab clientId="cli-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('ctr-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/contracts/ContractsTab.test.tsx`
Expected: first test PASSES, second FAILS — no button named "PDF".

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/features/contracts/ContractsTab.tsx` with:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useContractsForClient } from './hooks/useContracts';
import { useDownloadContractPdf } from './hooks/useDownloadContractPdf';
import { ContractStatusBadge } from './ContractStatusBadge';

export function ContractsTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation('contracts');
  const { data: contracts = [], isLoading, error } = useContractsForClient(clientId);
  const download = useDownloadContractPdf();

  return (
    <div className="space-y-3">
      <Button asChild size="sm">
        <Link to={`/contracts/new?clientId=${clientId}`}>+ {t('actions.new')}</Link>
      </Button>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {c.contract_number ?? c.id.slice(0, 8)}
                  <ContractStatusBadge status={c.status} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {c.title} · {formatDate(c.created_at)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => void openPdfInNewTab(() => download.mutateAsync(c.id))}
                >
                  {download.isPending ? '…' : 'PDF'}
                </Button>
                <Link to={`/contracts/${c.id}`} className="text-xs text-blue-600 underline dark:text-blue-400">
                  {t('actions.view')} →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/contracts/ContractsTab.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/contracts/ContractsTab.tsx src/features/contracts/ContractsTab.test.tsx
git commit -m "feat(contracts): per-row PDF download button on ContractsTab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `CombinedAttachmentsTab` component + locale keys

**Files:**
- Modify: `src/i18n/locales/en/sales.json` (the `"attachments"` block, currently lines 42–55)
- Modify: `src/i18n/locales/el/sales.json` (same block)
- Create: `src/features/attachments/CombinedAttachmentsTab.tsx`
- Test: `src/features/attachments/CombinedAttachmentsTab.test.tsx`

**Interfaces:**
- Consumes: `AttachmentsPanel({ parentType, parentId })`, `OffersTab({ leadId?, dealId? })`, `ProFormasTab({ leadId?, dealId? })`, `ContractsTab({ clientId })`.
- Produces (consumed by Tasks 6–8):

```ts
type Props = {
  parentType: 'lead' | 'deal' | 'client'; // scopes the Files panel
  parentId: string;
  leadId?: string;   // presence of leadId OR dealId shows Offers + Pro Formas
  dealId?: string;
  clientId?: string; // presence shows Contracts
};
export function CombinedAttachmentsTab(props: Props): JSX.Element;
```

- [ ] **Step 1: Add the locale keys**

In `src/i18n/locales/en/sales.json`, inside the `"attachments"` object, replace

```json
    "empty": "No attachments yet."
```

with

```json
    "empty": "No attachments yet.",
    "sections": {
      "files": "Files",
      "offers": "Offers",
      "proformas": "Pro Formas",
      "contracts": "Contracts"
    }
```

In `src/i18n/locales/el/sales.json`, inside the `"attachments"` object, replace

```json
    "empty": "Δεν υπάρχουν συνημμένα."
```

with

```json
    "empty": "Δεν υπάρχουν συνημμένα.",
    "sections": {
      "files": "Αρχεία",
      "offers": "Προσφορές",
      "proformas": "Προτιμολόγια",
      "contracts": "Συμβάσεις"
    }
```

(Greek terms match the existing UI: `leads.json tabs.offers/proformas` and `contracts.json tab.title`.)

- [ ] **Step 2: Write the failing test**

Create `src/features/attachments/CombinedAttachmentsTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@/lib/i18n';

vi.mock('./AttachmentsPanel', () => ({
  AttachmentsPanel: () => <div data-testid="files-panel" />,
}));
vi.mock('@/features/offers/OffersTab', () => ({
  OffersTab: () => <div data-testid="offers-panel" />,
}));
vi.mock('@/features/proformas/ProFormasTab', () => ({
  ProFormasTab: () => <div data-testid="proformas-panel" />,
}));
vi.mock('@/features/contracts/ContractsTab', () => ({
  ContractsTab: () => <div data-testid="contracts-panel" />,
}));

import { CombinedAttachmentsTab } from './CombinedAttachmentsTab';

describe('CombinedAttachmentsTab', () => {
  it('deal: shows files, offers, pro formas and contracts', () => {
    render(
      <CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" clientId="c1" />,
    );
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('proformas-panel')).toBeInTheDocument();
    expect(screen.getByTestId('contracts-panel')).toBeInTheDocument();
  });

  it('lead: shows files, offers, pro formas — no contracts', () => {
    render(<CombinedAttachmentsTab parentType="lead" parentId="l1" leadId="l1" />);
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('proformas-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('contracts-panel')).not.toBeInTheDocument();
  });

  it('client: shows files and contracts — no offers or pro formas', () => {
    render(<CombinedAttachmentsTab parentType="client" parentId="c1" clientId="c1" />);
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('contracts-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('offers-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proformas-panel')).not.toBeInTheDocument();
  });

  it('deal without client: no contracts section', () => {
    render(<CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" />);
    expect(screen.queryByTestId('contracts-panel')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/attachments/CombinedAttachmentsTab.test.tsx`
Expected: FAIL — cannot resolve `./CombinedAttachmentsTab`.

- [ ] **Step 4: Write the implementation**

Create `src/features/attachments/CombinedAttachmentsTab.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { AttachmentsPanel } from './AttachmentsPanel';
import { OffersTab } from '@/features/offers/OffersTab';
import { ProFormasTab } from '@/features/proformas/ProFormasTab';
import { ContractsTab } from '@/features/contracts/ContractsTab';

type Props = {
  parentType: 'lead' | 'deal' | 'client';
  parentId: string;
  leadId?: string;
  dealId?: string;
  clientId?: string;
};

const sectionClass = 'rounded-xl border border-border/60 bg-card p-5 shadow-sm';
const headerClass = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

export function CombinedAttachmentsTab({ parentType, parentId, leadId, dealId, clientId }: Props) {
  const { t } = useTranslation('sales');
  const showOffers = Boolean(leadId ?? dealId);
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className={headerClass}>{t('attachments.sections.files')}</h2>
        <AttachmentsPanel parentType={parentType} parentId={parentId} />
      </section>
      {showOffers && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.offers')}</h2>
          <OffersTab leadId={leadId} dealId={dealId} />
        </section>
      )}
      {showOffers && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.proformas')}</h2>
          <ProFormasTab leadId={leadId} dealId={dealId} />
        </section>
      )}
      {clientId && (
        <section className={sectionClass}>
          <h2 className={headerClass}>{t('attachments.sections.contracts')}</h2>
          <ContractsTab clientId={clientId} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/attachments/CombinedAttachmentsTab.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/features/attachments/CombinedAttachmentsTab.tsx src/features/attachments/CombinedAttachmentsTab.test.tsx src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "feat(attachments): CombinedAttachmentsTab (files + offers + pro formas + contracts)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the deal page (9 tabs → 6)

**Files:**
- Modify: `src/features/deals/DealDetailPage.tsx`

**Interfaces:**
- Consumes: `CombinedAttachmentsTab` (Task 5). `deal.client_id` is `string | null`.
- Produces: deal page with tabs Overview / Payment / Jobs / Tasks / Attachments / Activity only.

- [ ] **Step 1: Swap imports**

In `src/features/deals/DealDetailPage.tsx`:

Remove these three imports (currently lines 31–33):

```tsx
import { OffersTab } from '@/features/offers/OffersTab';
import { ProFormasTab } from '@/features/proformas/ProFormasTab';
import { ContractsTab } from '@/features/contracts/ContractsTab';
```

Replace the `AttachmentsPanel` import (currently line 24):

```tsx
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
```

with

```tsx
import { CombinedAttachmentsTab } from '@/features/attachments/CombinedAttachmentsTab';
```

- [ ] **Step 2: Remove the three TabsTriggers**

Delete (currently lines 331–339, directly after the `activity` trigger):

```tsx
          <TabsTrigger value="offers" className={detailTabTriggerClass}>
            {t('tabs.offers', { defaultValue: 'Offers' })}
          </TabsTrigger>
          <TabsTrigger value="proformas" className={detailTabTriggerClass}>
            {t('tabs.proformas', { defaultValue: 'Pro Formas' })}
          </TabsTrigger>
          <TabsTrigger value="contracts" className={detailTabTriggerClass}>
            {tContracts('tab.title')}
          </TabsTrigger>
```

Then check whether `tContracts` has any remaining use in the file (`grep -n "tContracts" src/features/deals/DealDetailPage.tsx`). If the only remaining occurrence is its declaration (`const { t: tContracts } = useTranslation('contracts');`, currently line 59), delete that declaration too — `eslint --max-warnings=0` fails on unused variables.

- [ ] **Step 3: Replace the attachments TabsContent and delete the three merged ones**

Replace (currently lines 409–413):

```tsx
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <AttachmentsPanel parentType="deal" parentId={dealId} />
          </div>
        </TabsContent>
```

with

```tsx
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <CombinedAttachmentsTab
            parentType="deal"
            parentId={dealId}
            dealId={dealId}
            clientId={deal.client_id ?? undefined}
          />
        </TabsContent>
```

Delete the `offers`, `proformas`, and `contracts` TabsContent blocks (currently lines 419–433):

```tsx
        <TabsContent value="offers" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <OffersTab dealId={dealId} />
          </div>
        </TabsContent>
        <TabsContent value="proformas" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <ProFormasTab dealId={dealId} />
          </div>
        </TabsContent>
        <TabsContent value="contracts" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            {deal.client_id && <ContractsTab clientId={deal.client_id} />}
          </div>
        </TabsContent>
```

- [ ] **Step 4: Verify with the strict build**

Run: `npm run build`
Expected: exits 0 (tsc, eslint with zero warnings, vite build all pass). If eslint reports an unused import or variable you missed, remove it.

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealDetailPage.tsx
git commit -m "feat(deals): merge Offers/Pro Formas/Contracts into the Attachments tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the lead page (6 tabs → 4)

**Files:**
- Modify: `src/features/leads/LeadDetailPage.tsx`

**Interfaces:**
- Consumes: `CombinedAttachmentsTab` (Task 5).
- Produces: lead page with tabs Overview / Attachments / Tasks / Activity only.

**CRITICAL:** the lead Overview tab embeds an inline `<AttachmentsPanel parentType="lead" …>` section (currently lines 337–342). That stays. Therefore the `AttachmentsPanel` import MUST remain.

- [ ] **Step 1: Swap imports**

In `src/features/leads/LeadDetailPage.tsx`:

Remove (currently lines 31–32):

```tsx
import { OffersTab } from '@/features/offers/OffersTab';
import { ProFormasTab } from '@/features/proformas/ProFormasTab';
```

Add next to the existing `AttachmentsPanel` import (keep that one — see CRITICAL note):

```tsx
import { CombinedAttachmentsTab } from '@/features/attachments/CombinedAttachmentsTab';
```

- [ ] **Step 2: Remove the two TabsTriggers**

Delete (currently lines 315–320, after the `activity` trigger):

```tsx
          <TabsTrigger value="offers" className={detailTabTriggerClass}>
            {t('tabs.offers')}
          </TabsTrigger>
          <TabsTrigger value="proformas" className={detailTabTriggerClass}>
            {t('tabs.proformas')}
          </TabsTrigger>
```

- [ ] **Step 3: Replace the attachments TabsContent and delete the two merged ones**

Replace (currently lines 358–362):

```tsx
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <AttachmentsPanel parentType="lead" parentId={leadId} />
          </div>
        </TabsContent>
```

with

```tsx
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <CombinedAttachmentsTab parentType="lead" parentId={leadId} leadId={leadId} />
        </TabsContent>
```

Delete the `offers` and `proformas` TabsContent blocks (currently lines 373–382):

```tsx
        <TabsContent value="offers" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <OffersTab leadId={leadId} />
          </div>
        </TabsContent>
        <TabsContent value="proformas" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <ProFormasTab leadId={leadId} />
          </div>
        </TabsContent>
```

- [ ] **Step 4: Verify with the strict build**

Run: `npm run build`
Expected: exits 0. The `AttachmentsPanel` import must still be present (used by the Overview inline section) — if eslint flags it as unused, the Overview section was damaged: restore it.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/LeadDetailPage.tsx
git commit -m "feat(leads): merge Offers/Pro Formas into the Attachments tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the client page (7 tabs → 6) + final verification + push

**Files:**
- Modify: `src/features/clients/ClientDetailPage.tsx`

**Interfaces:**
- Consumes: `CombinedAttachmentsTab` (Task 5).
- Produces: client page with tabs Overview / Jobs / Comments / Attachments / Tasks / Activity only.

- [ ] **Step 1: Swap imports**

In `src/features/clients/ClientDetailPage.tsx`:

Remove (currently lines 14–15):

```tsx
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ContractsTab } from '@/features/contracts/ContractsTab';
```

Add in their place:

```tsx
import { CombinedAttachmentsTab } from '@/features/attachments/CombinedAttachmentsTab';
```

- [ ] **Step 2: Remove the contracts TabsTrigger**

Delete (currently line 116):

```tsx
          <TabsTrigger value="contracts">{tContracts('tab.title')}</TabsTrigger>
```

Then check remaining uses: `grep -n "tContracts" src/features/clients/ClientDetailPage.tsx`. If only the declaration remains (`const { t: tContracts } = useTranslation('contracts');`), delete the declaration too.

- [ ] **Step 3: Replace the attachments TabsContent and delete the contracts one**

Replace (currently lines 138–140):

```tsx
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="client" parentId={clientId} />
        </TabsContent>
```

with

```tsx
        <TabsContent value="attachments" className="pt-4">
          <CombinedAttachmentsTab parentType="client" parentId={clientId} clientId={clientId} />
        </TabsContent>
```

Delete (currently lines 144–146):

```tsx
        <TabsContent value="contracts" className="pt-4">
          <ContractsTab clientId={clientId} />
        </TabsContent>
```

- [ ] **Step 4: Run the full feature test set + strict build**

```bash
npx vitest run src/lib/openPdfInNewTab.test.ts src/features/offers/OffersTab.test.tsx src/features/proformas/ProFormasTab.test.tsx src/features/contracts/ContractsTab.test.tsx src/features/attachments/CombinedAttachmentsTab.test.tsx
npm run build
```

Expected: all test files pass (12 tests total), build exits 0.

(Do NOT run the whole vitest suite — it talks to prod and has known fixture failures unrelated to this work.)

- [ ] **Step 5: Commit and push**

```bash
git add src/features/clients/ClientDetailPage.tsx
git commit -m "feat(clients): merge Contracts into the Attachments tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Before pushing, verify tree state (owner may have committed in parallel): `git status` should show only the owner's untracked `g.sql`/`gg.json`/`gp.json`; `git log --oneline -10` should show exactly this feature's commits on top. Then:

```bash
git pull --rebase origin main && git push origin main
```

---

## Manual smoke checklist (after deploy, any tester)

1. Open a deal → Attachments tab shows Files / Offers / Pro Formas / Contracts sections; Offers/Pro Formas/Contracts tabs are gone; a PDF row button opens the generated PDF in a new tab.
2. Open a lead → Attachments tab shows Files / Offers / Pro Formas; Overview still shows its inline attachments block.
3. Open a client → Attachments tab shows Files / Contracts; "+ New contract" still works.
4. Send a contract from its detail page → email still delivered with PDF attached (untouched flow).
5. Vercel stale-chunk gotcha: hard-refresh before believing anything "broke" after deploy.

## Changes / Revert

- Commits (in order): helper → offers button → proformas button → contracts button → combined component + locales → deal wiring → lead wiring → client wiring.
- Pure frontend; no DB/storage/API changes. Full revert: `git revert` the eight commits (or `git revert <first>^..<last>`). No data cleanup needed.
