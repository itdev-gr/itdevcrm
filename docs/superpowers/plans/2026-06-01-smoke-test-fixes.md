# Smoke-Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the e2e smoke suite green by repairing two stale test assertions, and fully internationalize the Recurring Clients accounting page (the one real product bug the smoke test surfaced).

**Architecture:** The app itself is healthy — typecheck, lint, 109 unit tests, and 16/21 e2e flows pass with zero runtime console errors. Two e2e failures are stale assertions that drifted from the app: (1) `auth-flow` expects an "ITDevCRM" heading on the home page that no longer exists, and (2) `leads-smoke` expects `/accounting/recurring` to be a 404, but the recurring board was deliberately re-added on 2026-05-03 (one day after that test was written). Separately, `AccountingRecurringPage.tsx` renders hardcoded English that ignores the language switcher. We fix the tests to match reality, then wire the page through the existing `react-i18next` setup (new `accounting:recurring_clients` keys + reuse of `deals:services.types.*` for service labels).

**Tech Stack:** React 19, TypeScript, Vite, `react-i18next` (namespaced JSON locales under `src/i18n/locales/{en,el}`), Playwright (`tests/*.spec.ts`), Vitest.

---

## Background: Verified Findings

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run test:run` (unit) | 109/109 pass |
| e2e (authenticated, smoke account) | 16 pass, **2 fail**, 3 skip |
| Runtime console, 6 routes logged in | 0 errors, 0 warnings |

**The two failures (both stale tests, not app bugs):**

1. `tests/auth-flow.spec.ts:15` — asserts `getByRole('heading', { name: /itdevcrm/i })` on the home page after login. `src/app/routes/HomePage.tsx` renders Calendar + AssignedTasks + Notifications with **no** such heading. "ITDevCRM" lives in the top-bar brand (`common:app_title`, rendered as a `<span>` inside the `<header>` banner in `src/components/layout/Topbar.tsx:17`) and as the `/login` page heading (`auth:login.title`). Login itself works — the URL reaches `/`.
2. `tests/leads-smoke.spec.ts:23` — asserts `/accounting/recurring` shows "not found / 404". But `src/app/router.tsx:149` routes it to `AccountingRecurringPage`, it is linked in `src/components/layout/Sidebar.tsx:105`, and it renders a live board (5 clients, €2710/mo verified). Git: test written `d729878` (2026-05-02), board re-added `3c83323` (2026-05-03).

**The one real product bug:**

3. `src/features/accounting/AccountingRecurringPage.tsx` hardcodes English ("Recurring clients", "Active clients", "Monthly recurring", "Overdue", "Blocked", "Active", "Done", all column headers, filter placeholder, empty message) and shows raw service codes (`web_seo`, `local_seo`, …). Switching the app to Greek leaves this page in English.

---

## File Structure

- `tests/auth-flow.spec.ts` — fix the home-page assertion (Task 1).
- `tests/leads-smoke.spec.ts` — replace the stale 404 assertion with a "board renders" assertion (Task 2), then add a Greek-translation assertion (Task 3).
- `src/i18n/locales/en/accounting.json` — add a new `recurring_clients` block (Task 3).
- `src/i18n/locales/el/accounting.json` — add the matching Greek `recurring_clients` block (Task 3).
- `src/features/accounting/AccountingRecurringPage.tsx` — wire `useTranslation` for all strings; reuse `deals:services.types.*` for service labels; pass locale to `formatDate` (Task 3).

No new files. We reuse existing patterns: `useTranslation('accounting')` (as in `AccountingClientsPage.tsx:29`), the service-type label keys already defined in `src/i18n/locales/{en,el}/deals.json` under `services.types.*` (all 7 codes present in both locales), and `formatDate(iso, locale)` from `src/lib/datetime.ts:18`.

---

## Task 1: Fix the stale auth-flow home-page assertion

**Files:**
- Modify: `tests/auth-flow.spec.ts:15`

- [ ] **Step 1: Run the test to confirm it fails (red — captures the stale assertion)**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/auth-flow.spec.ts:9 --reporter=line
```
Expected: FAIL — `expect(locator).toBeVisible()` for `getByRole('heading', { name: /itdevcrm/i })`, "element(s) not found".

- [ ] **Step 2: Replace the assertion with a stable authenticated-shell marker**

In `tests/auth-flow.spec.ts`, change line 15 from:
```ts
    await expect(page.getByRole('heading', { name: /itdevcrm/i })).toBeVisible();
```
to:
```ts
    // The authenticated app shell renders the brand inside the top-bar <header> (banner).
    await expect(page.getByRole('banner').getByText(/itdevcrm/i)).toBeVisible();
```

Why this is correct and locale-proof: the brand text comes from `common:app_title`, which is the literal `"ITDevCRM"` in **both** `en` and `el` locales (`src/i18n/locales/{en,el}/common.json`). It is rendered only inside the `<header>` (role `banner`) of the authenticated shell — it is absent on `/login` (different layout) — so it proves login landed on the authenticated app and did not bounce back.

- [ ] **Step 3: Run the test to verify it passes (green)**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/auth-flow.spec.ts --reporter=line
```
Expected: PASS — both `auth flow` tests pass (2 passed).

- [ ] **Step 4: Commit**

```bash
git add tests/auth-flow.spec.ts
git commit -m "test(e2e): fix stale auth-flow home assertion (banner brand, not heading)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Replace the stale `/accounting/recurring` 404 assertion

**Files:**
- Modify: `tests/leads-smoke.spec.ts:23-27`

- [ ] **Step 1: Run the test to confirm it fails (red — captures the stale assertion)**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/leads-smoke.spec.ts --reporter=line
```
Expected: FAIL — the `/accounting/recurring is gone (404 / NotFound)` test fails because `getByText(/not found|404/i)` is not found (the board renders instead).

- [ ] **Step 2: Replace the stale test with one that asserts the board renders**

In `tests/leads-smoke.spec.ts`, replace the whole block at lines 23-27:
```ts
  test('/accounting/recurring is gone (404 / NotFound)', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByText(/not found|404/i)).toBeVisible();
  });
```
with:
```ts
  test('/accounting/recurring renders the recurring clients board', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByRole('heading', { name: /recurring clients/i })).toBeVisible();
  });
```

Why: the route was re-introduced in commit `3c83323` and is a working board. The heading text is currently the hardcoded English `"Recurring clients"` (becomes the `accounting:recurring_clients.title` EN value in Task 3 — same English text, so this assertion stays valid).

- [ ] **Step 3: Run the test to verify it passes (green)**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/leads-smoke.spec.ts --reporter=line
```
Expected: PASS — both `leads smoke` tests pass (2 passed).

- [ ] **Step 4: Commit**

```bash
git add tests/leads-smoke.spec.ts
git commit -m "test(e2e): recurring board exists — assert it renders, not 404

The /accounting/recurring board was re-added in 3c83323 the day after
the 'removed' test was written; the test never got updated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Internationalize the Recurring Clients page

**Files:**
- Test: `tests/leads-smoke.spec.ts` (add a Greek-translation assertion)
- Modify: `src/i18n/locales/en/accounting.json`
- Modify: `src/i18n/locales/el/accounting.json`
- Modify: `src/features/accounting/AccountingRecurringPage.tsx`

> Note: a `recurring` key already exists in `accounting.json` for a separate billing-invoices feature (period / due / generate invoices) and is **not** consumed by `AccountingRecurringPage`. Do **not** touch it. We add a new sibling key `recurring_clients`.

- [ ] **Step 1: Write the failing test (red — Greek heading not translated yet)**

In `tests/leads-smoke.spec.ts`, immediately after the test added in Task 2, add:
```ts
  test('recurring clients board translates to Greek', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByRole('heading', { name: /recurring clients/i })).toBeVisible();
    // Switch to Greek via the top-bar locale switcher (Radix Select, role=combobox).
    await page.getByRole('combobox', { name: /language|γλώσσα/i }).click();
    await page.getByRole('option', { name: 'Ελληνικά' }).click();
    await expect(
      page.getByRole('heading', { name: /Επαναλαμβανόμενοι πελάτες/i }),
    ).toBeVisible();
  });
```

The locale switcher is `src/components/layout/LocaleSwitcher.tsx`: a Radix `Select` with `aria-label={t('locale.label')}` ("Language" / "Γλώσσα") and an option labeled `Ελληνικά`.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/leads-smoke.spec.ts -g "translates to Greek" --reporter=line
```
Expected: FAIL — after switching to Greek the heading stays `"Recurring clients"` (hardcoded), so the `Επαναλαμβανόμενοι πελάτες` heading is not found.

- [ ] **Step 3: Add the EN locale keys**

In `src/i18n/locales/en/accounting.json`, add a new top-level key `recurring_clients` as a sibling of the existing `recurring` key (e.g. add a comma after the `recurring` block's closing brace and insert this before the file's final `}`):
```json
  "recurring_clients": {
    "title": "Recurring clients",
    "stats": {
      "active_clients": "Active clients",
      "monthly": "Monthly recurring",
      "overdue": "Overdue",
      "blocked": "Blocked"
    },
    "filter_placeholder": "Filter by client, email, industry…",
    "empty": "No recurring clients match.",
    "table": {
      "client": "Client",
      "services": "Services",
      "monthly": "Monthly",
      "next_due": "Next due",
      "status": "Status"
    },
    "status": {
      "active": "Active",
      "overdue": "Overdue",
      "done": "Done",
      "blocked": "Blocked"
    }
  }
```

- [ ] **Step 4: Add the matching EL locale keys**

In `src/i18n/locales/el/accounting.json`, add the same `recurring_clients` key (sibling of `recurring`):
```json
  "recurring_clients": {
    "title": "Επαναλαμβανόμενοι πελάτες",
    "stats": {
      "active_clients": "Ενεργοί πελάτες",
      "monthly": "Μηνιαία επαναλαμβανόμενα",
      "overdue": "Ληξιπρόθεσμα",
      "blocked": "Μπλοκαρισμένοι"
    },
    "filter_placeholder": "Φιλτράρισμα ανά πελάτη, email, κλάδο…",
    "empty": "Κανένας επαναλαμβανόμενος πελάτης δεν ταιριάζει.",
    "table": {
      "client": "Πελάτης",
      "services": "Υπηρεσίες",
      "monthly": "Μηνιαία",
      "next_due": "Επόμενη λήξη",
      "status": "Κατάσταση"
    },
    "status": {
      "active": "Ενεργός",
      "overdue": "Ληξιπρόθεσμο",
      "done": "Ολοκληρώθηκε",
      "blocked": "Μπλοκαρισμένος"
    }
  }
```

- [ ] **Step 5: Validate both JSON files parse**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/accounting.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/accounting.json','utf8')); console.log('OK')"
```
Expected: `OK` (no SyntaxError — confirms the inserted commas/braces are valid).

- [ ] **Step 6: Wire the component to i18n**

Replace the entire contents of `src/features/accounting/AccountingRecurringPage.tsx` with:
```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useRecurringClients, type RecurringClientRow } from './hooks/useRecurringClients';
import { formatDate } from '@/lib/datetime';

function StatusBadge({ row }: { row: RecurringClientRow }) {
  const { t } = useTranslation('accounting');
  if (row.is_blocked) {
    return (
      <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
        {t('recurring_clients.status.blocked')}
      </span>
    );
  }
  if (row.has_overdue_payment) {
    return (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        {t('recurring_clients.status.overdue')}
      </span>
    );
  }
  if (row.status === 'done') {
    return (
      <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
        {t('recurring_clients.status.done')}
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      {t('recurring_clients.status.active')}
    </span>
  );
}

export function AccountingRecurringPage() {
  const { t, i18n } = useTranslation('accounting');
  const { t: tDeals } = useTranslation('deals');
  const { data: rows = [], isLoading } = useRecurringClients();
  const [query, setQuery] = useState('');

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      r.client_name.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.industry ?? '').toLowerCase().includes(q)
    );
  });

  if (isLoading) return <div className="p-8">…</div>;

  const totals = {
    count: rows.length,
    monthly: rows.reduce((sum, r) => sum + r.monthly_total, 0),
    overdue: rows.filter((r) => r.has_overdue_payment).length,
    blocked: rows.filter((r) => r.is_blocked).length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{t('recurring_clients.title')}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('recurring_clients.stats.active_clients')} value={String(totals.count)} />
        <Stat
          label={t('recurring_clients.stats.monthly')}
          value={`€${totals.monthly.toFixed(0)}`}
        />
        <Stat label={t('recurring_clients.stats.overdue')} value={String(totals.overdue)} tone="amber" />
        <Stat label={t('recurring_clients.stats.blocked')} value={String(totals.blocked)} tone="red" />
      </div>

      <Input
        placeholder={t('recurring_clients.filter_placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">{t('recurring_clients.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-normal">{t('recurring_clients.table.client')}</th>
                <th className="px-3 py-2 font-normal">{t('recurring_clients.table.services')}</th>
                <th className="px-3 py-2 font-normal text-right">
                  {t('recurring_clients.table.monthly')}
                </th>
                <th className="px-3 py-2 font-normal">{t('recurring_clients.table.next_due')}</th>
                <th className="px-3 py-2 font-normal">{t('recurring_clients.table.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const contactName = [r.contact_first_name, r.contact_last_name]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={r.client_id} className="border-t hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link
                        to={r.deal_id ? `/deals/${r.deal_id}` : `/clients/${r.client_id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {r.client_name}
                      </Link>
                      {(contactName || r.email) && (
                        <div className="text-[11px] text-slate-500">
                          {[contactName, r.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {r.active_services.map((s) => tDeals(`services.types.${s}`)).join(' · ')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      €{r.monthly_total.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.earliest_due ? formatDate(r.earliest_due, i18n.language) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge row={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'amber' | 'red';
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-amber-700'
      : tone === 'red'
        ? 'text-red-700'
        : 'text-slate-900';
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
```

Notes:
- `tDeals(\`services.types.${s}\`)` mirrors the existing pattern in `src/features/deals/ServicesPlannedField.tsx:126`; all 7 service codes exist under `services.types.*` in both `en` and `el` `deals.json`, so service labels now localize (and stop showing raw codes).
- `formatDate(r.earliest_due, i18n.language)` localizes the date too (`formatDate` already accepts a locale arg, defaulting to `'en'`).

- [ ] **Step 7: Typecheck and lint (no template-key or unused-import regressions)**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: both exit 0.

- [ ] **Step 8: Run the Greek e2e test to verify it passes (green)**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test tests/leads-smoke.spec.ts --reporter=line
```
Expected: PASS — all 3 `leads smoke` tests pass (including "translates to Greek").

- [ ] **Step 9: Commit**

```bash
git add src/i18n/locales/en/accounting.json src/i18n/locales/el/accounting.json \
        src/features/accounting/AccountingRecurringPage.tsx tests/leads-smoke.spec.ts
git commit -m "i18n(accounting): localize Recurring Clients board (en/el)

Adds accounting:recurring_clients keys, reuses deals:services.types.* for
service labels, and passes the active locale to formatDate. Adds an e2e
check that the board translates to Greek via the locale switcher.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks + unit tests**

Run:
```bash
npm run typecheck && npm run lint && npm run test:run
```
Expected: typecheck exit 0; lint exit 0; vitest `109 passed` (or more if any were added).

- [ ] **Step 2: Full e2e smoke suite**

Run:
```bash
E2E_ADMIN_EMAIL='test@test.gr' E2E_ADMIN_PASSWORD='123456789' \
  npx playwright test --reporter=line
```
Expected: **0 failed.** Previously 16 passed / 2 failed / 3 skipped → now ~18 passed / 0 failed / 3 skipped (the 3 remaining skips are intentional: non-admin redirect needs a non-admin user; assigned-tasks skips are data-gated). The new "translates to Greek" test brings the pass count up.

- [ ] **Step 3: Confirm no stray failures and report**

Confirm the final line reads `0 failed`. If anything fails, STOP and use superpowers:systematic-debugging before claiming completion (per superpowers:verification-before-completion — evidence before assertions).

---

## Task 5: sr-only descriptions for all 9 dialogs (added after the smoke test)

Follow-up: the e2e run surfaced a Radix runtime warning — `Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` — on every dialog. All 9 dialogs rendered a `DialogTitle` but no `DialogDescription`. Fix: add a visually-hidden (`className="sr-only"`) `DialogDescription` with an i18n key to each dialog (screen-reader-only, no visual change).

Dialogs and keys (namespace → key): `home`→`task.dialog_description`; `clients`→`new_client_description`; `admin`→`service_packages.subpackages.dialog_description`; `admin`→`service_packages.dialog_description`; `home`→`assigned_tasks.detail_description`; `jobs`→`assigned_tasks.new_task_description`; `leads`→`new_lead_description`; `accounting`→`block.dialog_description`; `users`→`create_dialog.description`. Each added to both `en` and `el` locale files (18 keys total).

Verified: all 18 keys resolve in both locales, `typecheck`/`lint` clean, e2e 19 passed / 0 failed, and the DialogContent warning count is 0. Commit `c0d5ce9`.

## Changes / Revert

**Changed:**
- `tests/auth-flow.spec.ts` — home assertion now targets the banner brand instead of a non-existent heading.
- `tests/leads-smoke.spec.ts` — `/accounting/recurring` 404 test replaced with "board renders" + "translates to Greek" tests.
- `src/i18n/locales/{en,el}/accounting.json` — new `recurring_clients` block (additive; existing `recurring` block untouched).
- `src/features/accounting/AccountingRecurringPage.tsx` — all user-facing strings via `useTranslation`; service labels via `deals:services.types.*`; localized dates.
- 9 dialog components + 7 namespaces × 2 locales — sr-only `DialogDescription` added (Task 5).

**Revert:** All changes are additive or in-place edits across 5 files with one commit per task (Tasks 1–3). To roll back a single concern, `git revert <task-commit>`. No database migrations, no schema changes, no config changes — nothing to undo server-side. The new `recurring_clients` i18n keys are inert if the component revert leaves them unused.

**Out of scope (documented, not addressed — per agreed scope "tests + recurring i18n"):**
- Non-admin redirect e2e coverage (`admin-smoke.spec.ts:78`) — needs a seeded non-admin test user.
- Assigned-tasks data-gated skips — depend on seeded clients/deals in the test environment.
- Broader i18n sweep of other pages for hardcoded strings.

---

## Self-Review

- **Spec coverage:** Failure 1 → Task 1. Failure 2 → Task 2. Product bug (recurring i18n) → Task 3. Green-suite confirmation → Task 4. All three findings in scope are covered.
- **Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.
- **Type/name consistency:** i18n keys referenced in the component (`recurring_clients.title`, `.stats.*`, `.table.*`, `.status.*`, `.filter_placeholder`, `.empty`) exactly match the keys added in Steps 3–4. `tDeals('services.types.<code>')` matches existing `deals.json` keys (all 7 codes present in both locales). `formatDate(iso, locale)` matches the real signature at `src/lib/datetime.ts:18`. The EN `recurring_clients.title` value ("Recurring clients") matches the assertion added in Task 2, so Task 3 does not break Task 2.
