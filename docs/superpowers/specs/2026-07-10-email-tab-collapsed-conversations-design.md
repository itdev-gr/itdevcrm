# Design: Deal Emails tab — collapsed conversations, newest-first

**Date:** 2026-07-10
**Status:** Approved in conversation. Decisions: conversations collapsed by default,
expand on header click; newest-first BOTH for conversation cards and for messages
inside an expanded conversation; grouping stays by thread with a subject fallback.

## Problem

The deal Emails tab (`EmailThreadList`, added 2026-07-10 by the owner) renders every
conversation fully expanded — a wall of messages. The owner wants an inbox-style
view: one collapsed row per conversation, newest activity first, click to expand.

## Current state (verified)

- `useEmailThreads(dealId)` selects `email_messages` by deal and groups via exported
  pure `groupThreads(rows)`: key `thread_id ?? id`, messages sorted **oldest→newest**,
  threads sorted newest-first by `last_at`. Prod data: 19/19 rows have `thread_id`;
  grouping is intact today.
- `EmailThreadList.tsx` renders every thread's full message list unconditionally,
  with a Reply button per thread (opens `SendEmailDialog` prefilled `Re: …`).

## Design (frontend-only; no DB changes)

### `groupThreads` (in `useEmailThreads.ts`)

1. **Messages newest-first** inside each thread (flip the current sort).
2. **Grouping fallback**: key = `thread_id`, else normalized subject
   (`subject.toLowerCase()` with leading `Re:`/`Fwd:` chains stripped, trimmed),
   else (blank subject) the row's own `id` (blank-subject strays stay solo).
   Deal-scoped queries make subject-fallback safe.
3. Thread ordering unchanged (newest `last_at` first). Thread `subject` = subject of
   the FIRST row seen for the group (unchanged behavior).

### `EmailThreadList.tsx`

- **Collapsed by default**; component state `expanded: Set<string>` (thread keys),
  toggled by clicking the card header. Multiple threads can be open; state resets on
  remount (no persistence — YAGNI).
- **Collapsed card row**: chevron (▸/▾ via lucide `ChevronRight`/`ChevronDown`),
  subject, message count, then the LATEST message's direction badge (↓ Received /
  ↑ Sent, reusing the existing badge styling), a one-line truncated snippet of the
  latest message (`body_text ?? snippet`, first line, truncate), and its relative
  time. Latest message = `thread.messages[0]` (newest-first).
- **Expanded**: the existing `EmailMessage` list (now newest-first).
- **Reply** button stays on the header, `stopPropagation` so it doesn't toggle.
- Header is a `<button>` for a11y (aria-expanded).

## Testing

- `groupThreads` unit tests (new `src/features/email/hooks/useEmailThreads.test.ts`):
  messages newest-first; threads newest-first; `thread_id` grouping; subject fallback
  groups `X` + `Re: X` + `RE: Re: X` when thread_id null; blank-subject rows stay
  separate; mixed thread_id/subject rows don't cross-group.
- `EmailThreadList` component tests (update existing file): collapsed by default
  (subject + snippet visible, full body NOT); click header → body visible; click
  again → hidden; latest-message snippet/time shown collapsed; Reply does not toggle
  expansion. The existing "renders a thread subject and a message" test is updated
  to expand first.

## Changes / Revert

**Changes:** `src/features/email/hooks/useEmailThreads.ts` (sort flip + fallback key),
`src/features/email/EmailThreadList.tsx` (collapse state + summary row), tests.
**Revert:** `git revert` the single feature commit. No DB/migrations.
