# Client Email — Emails tab on Job & Client pages

**Goal:** Reuse the deal Emails tab on the **job** page (emails for that job) and the **client** page (all the client's emails), by generalizing the hook/component to filter by `deal_id | job_id | client_id`.

## Global Constraints
- Reuse the EXISTING `src/features/email/EmailThreadList.tsx` + `src/features/email/hooks/useEmailThreads.ts` — do not fork them.
- `email_messages` isn't in generated types → keep the `supabase.from('email_messages' as never)` cast. No `any`.
- RLS already silos rows. UI does no filtering.
- `npm run build` green (tsc + eslint --max-warnings=0); vitest green. Add `tabs.emails` to whatever i18n namespace the job page and client page use (check each page's `useTranslation(...)`), both `en` and `el`.
- TDD-adjust the existing test if the hook signature changes; commit per task.

### Task 1: generalize `useEmailThreads` to a filter
Change the hook signature from `useEmailThreads(dealId: string)` to:
```ts
export type EmailScope = { deal_id?: string; job_id?: string; client_id?: string };
export function useEmailThreads(scope: EmailScope): UseQueryResult<EmailThread[]>;
```
Implementation: determine the single active `[column, value]` from scope (deal_id → job_id → client_id precedence), build queryKey `['email-threads', column, value]`, `.eq(column, value)`, `enabled: !!value`. Keep `groupThreads` unchanged. Update any existing caller/test that passed a bare `dealId`.

### Task 2: `EmailThreadList` takes a scope
Change props from `{ dealId: string; clientEmail: string }` to `{ scope: EmailScope; clientEmail: string }`; pass `scope` into `useEmailThreads`. Update `EmailThreadList.test.tsx` mock/props accordingly (still 2 passing tests). Update the deal page call site (Task 4).

### Task 3: Emails tab on the Job page
In `src/features/jobs/JobDetailPage.tsx`, add an `emails` TabsTrigger (after `attachments`, matching the existing pattern/classes) and a TabsContent:
```tsx
<EmailThreadList scope={{ job_id: <the job id in scope> }} clientEmail={<the client's email if available, else ''>} />
```
Import `EmailThreadList` from `@/features/email/EmailThreadList`. Find how the job's id and its client's email are available in that component. Add `tabs.emails` to the job page's i18n namespace (en + el).

### Task 4: Emails tab on the Client page + fix the deal call site
- `src/features/deals/DealDetailPage.tsx`: change the existing call to `<EmailThreadList scope={{ deal_id: deal.id }} clientEmail={deal.client?.email ?? ''} />`.
- `src/features/clients/ClientDetailPage.tsx`: add an `emails` tab (matching its tab pattern) with `<EmailThreadList scope={{ client_id: <client id> }} clientEmail={<client email>} />`. Add `tabs.emails` to the client page's i18n namespace (en + el).
- Verify: `npm run build` exit 0; `npx vitest run src/features/email/` green.
- Commit.

## Changes / Revert
Generalizes 2 files, edits 3 pages + i18n. Revert: restore the `dealId`/`clientEmail` props and remove the job/client tabs.
