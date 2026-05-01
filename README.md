# ITDevCRM

Custom CRM with Sales / Accounting / Technical pipelines, group-based permissions, and bilingual UI (EN/EL).

## Stack

Vite + React 19 + TypeScript · Supabase (Postgres/Auth/Realtime/Storage/RLS) · Tailwind + shadcn/ui · TanStack Query · Zustand · React Router · react-i18next

## Local development

1. `cp .env.example .env.local` and fill in your Supabase project URL + anon key.
2. `npm install`
3. `npm run dev` → http://localhost:5173

## Scripts

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — ESLint
- `npm run format` — Prettier write
- `npm test` — Vitest (unit + component)
- `npm run test:e2e` — Playwright (e2e)

## Specs and plans

See `docs/superpowers/specs/` and `docs/superpowers/plans/`.
