# Universal Back Button — Design

Date: 2026-06-18
Status: Approved (pending spec review)

## Goal

Provide a single, consistent **Back** button that appears on every authenticated
page of the CRM — sales, accounting, tech, admin, and all detail pages (leads,
deals, jobs, clients, offers, contracts) — so users always have an obvious way to
return to where they came from.

## Approach

Render the back button **once**, globally, inside `AppShell` (just above the page
content). Because `ShellLayout → RequireAuth → AppShell → <Outlet/>` wraps every
authenticated route, one insertion covers the entire app — no per-page wiring and
no risk of missing a page.

This replaces the earlier per-page idea: editing each detail page (and every
accounting/tech/admin page) by hand would be many edits and easy to leave gaps.
The user requirement is explicitly "everywhere", which the global approach
satisfies with a single change.

## Component — `src/components/BackButton.tsx`

A small, self-contained component using `useNavigate` and `useLocation`.

### Behavior (smart back)

- If there is in-app history to return to, go back one entry: `navigate(-1)`.
  - Detection: react-router records a numeric index in history state. When
    `window.history.state?.idx` is greater than `0`, the user navigated here from
    another in-app page, so back is safe and lands exactly where they came from
    (a board, a list, global search, anywhere).
- If there is **no** in-app history (direct load, page refresh, email/Zapier link,
  new tab), fall back to the Home page: `navigate('/')`.

This keeps "back" meaningful in the common case (history) while never dead-ending
on a fresh load.

### Visibility

- Shown on every authenticated page **except** the Home route `/`. On Home the
  button would be a no-op (back-to-home from home), so the component renders
  `null` when `location.pathname === '/'`.

### Appearance

- A left-arrow icon (`ArrowLeft` from `lucide-react`, already used in the Topbar)
  followed by the localized label **Back / Πίσω**.
- Styled as a subtle muted link: `text-muted-foreground hover:text-slate-900`.
- Wrapped in a thin padded strip (left padding matching the page content gutter)
  so it aligns with the content below it.

## Placement — `src/components/layout/AppShell.tsx`

Render `<BackButton />` as the first child of `<main>`, above `{children}`:

```tsx
<main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
  <BackButton />
  {children}
</main>
```

## i18n

Add a `back` key to the default `common` namespace:

- `src/i18n/locales/en/common.json` → `"back": "Back"`
- `src/i18n/locales/el/common.json` → `"back": "Πίσω"`

The component reads it via `useTranslation()` (default namespace): `t('back')`.

## Testing (TDD)

`src/components/BackButton.test.tsx` (vitest + Testing Library):

1. Renders the arrow icon and the localized label.
2. Click **with** in-app history (`window.history.state.idx > 0`) → calls
   `navigate(-1)`.
3. Click **without** in-app history (`idx` is `0`/absent) → calls `navigate('/')`.
4. Renders `null` on the Home route `/`.

`useNavigate` is mocked to a spy; `window.history.state` and the current route are
controlled per test.

## Out of scope (YAGNI)

- Per-page fallback parents / a `boardPathForServiceType` helper — global history
  plus the Home fallback makes these unnecessary.
- Adding the button to unauthenticated pages (login, reset-password) — those live
  outside `AppShell`.
- Breadcrumbs or multi-level navigation — just a single back action.

## Changes / Revert

New files:
- `src/components/BackButton.tsx`
- `src/components/BackButton.test.tsx`

Edited files:
- `src/components/layout/AppShell.tsx` — add import + one `<BackButton />` line.
- `src/i18n/locales/en/common.json` — add `"back": "Back"`.
- `src/i18n/locales/el/common.json` — add `"back": "Πίσω"`.

Revert: delete the two new files, remove the `BackButton` import and line from
`AppShell.tsx`, and remove the two `back` keys. No database changes, no migration.
