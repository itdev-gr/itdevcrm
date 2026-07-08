# Persistent Comment Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Model split:** every implementer subagent MUST be dispatched with `model: "opus"`.

**Spec:** `docs/superpowers/specs/2026-07-08-persistent-comment-drafts-design.md`

**Goal:** Make unsent comment-box text survive tab switches, navigation, and browser refresh — cleared only when the comment is posted or the box is emptied — for both comment composers in the CRM.

**Architecture:** A Zustand `persist` store (`commentDraftStore`) holds a `Record<string, {text, savedAt}>` in localStorage, keyed per comment thread, matching the existing `tasksSeenStore`/`jobsBoardSortStore` convention. A thin `useCommentDraft(key)` hook exposes `{text, setText, clear}` so each composer swaps its local `useState('')` for one line. The two composers (`CommentForm`, `TaskComments`) key their drafts by thread identity and clear on successful post.

**Tech Stack:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes: true`), Zustand + `zustand/middleware` `persist`, Vitest + @testing-library/react (jsdom), react-i18next, TanStack Query.

## Global Constraints

- **Frontend-only.** No DB/RLS/API/edge-function/storage change. Comment posting, @mention resolution, and RLS are untouched.
- Work directly on the current branch (`main`) in this tree — the owner's convention. Do NOT create branches. Do NOT push until the final task's git-state check.
- Always `git add` explicit paths, never `git add -A`. Untracked `g.sql`, `gg.json`, `gp.json` at repo root belong to the owner — never add/delete them.
- Commit after every task with the exact message given, ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Verification gate is `npm run build` (tsc -b + `eslint --max-warnings=0` + vite build). It is STRICTER than `tsc --noEmit`: an unused import/variable fails it. Under `exactOptionalPropertyTypes: true`, passing `x: string | undefined` to a `x?: string` prop fails tsc — forward optional props conditionally (`{...(v ? { v } : {})}`) if that ever arises.
- The vitest suite runs against PROD Supabase — NEVER run the whole suite (`npx vitest run` with no path). Run only the specific test files named in each task; all new tests are pure (localStorage/jsdom, network hooks mocked).
- Tests that render components import `'@/lib/i18n'` to initialise i18next and assert on `data-testid`/roles/values, never on translated copy.
- localStorage store name is exactly `itdevcrm-comment-drafts-v1` (matches the `itdevcrm-*-v1` convention).
- `Date.now()` is used in store app code (allowed — the ban is only for workflow scripts). Store tests that assert pruning inject `savedAt` timestamps directly into state, so they don't depend on wall-clock.

---

### Task 1: `commentDraftStore` + `useCommentDraft` hook + key helper

**Files:**
- Create: `src/features/comments/commentDraftStore.ts`
- Test: `src/features/comments/commentDraftStore.test.ts`

**Interfaces:**
- Consumes: `zustand`, `zustand/middleware` (already dependencies — used by `src/features/tasks/tasksSeenStore.ts`).
- Produces (consumed by Tasks 2–3):
  - `commentDraftKey(parts)` helpers:
    - `commentThreadKey(parentType: string, parentId: string, replyToId?: string): string`
    - `taskThreadKey(kind: string, taskId: string): string`
  - `useCommentDraftStore` (zustand store) with `drafts`, `getDraft(key)`, `setDraft(key, text)`, `clearDraft(key)`, `pruneOldDrafts(now)`.
  - `useCommentDraft(key: string): { text: string; setText: (t: string) => void; clear: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/comments/commentDraftStore.test.ts`:

```ts
import { beforeEach, describe, it, expect } from 'vitest';
import {
  useCommentDraftStore,
  commentThreadKey,
  taskThreadKey,
  DRAFT_TTL_MS,
} from './commentDraftStore';

describe('commentDraftStore', () => {
  beforeEach(() => {
    useCommentDraftStore.setState({ drafts: {} });
    window.localStorage.clear();
  });

  it('returns empty string when no draft is stored', () => {
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('');
  });

  it('stores and reads a draft under its key', () => {
    useCommentDraftStore.getState().setDraft('comment:deal:d1', 'hello');
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('hello');
  });

  it('deletes the key when set to empty or whitespace-only', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('comment:deal:d1', 'hi');
    s.setDraft('comment:deal:d1', '   ');
    expect(useCommentDraftStore.getState().getDraft('comment:deal:d1')).toBe('');
    expect('comment:deal:d1' in useCommentDraftStore.getState().drafts).toBe(false);
  });

  it('clearDraft removes the key', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('task:assigned:t1', 'draft');
    s.clearDraft('task:assigned:t1');
    expect(useCommentDraftStore.getState().getDraft('task:assigned:t1')).toBe('');
  });

  it('keeps independent drafts per key', () => {
    const s = useCommentDraftStore.getState();
    s.setDraft('comment:deal:d1', 'A');
    s.setDraft('comment:deal:d1:reply:c9', 'B');
    s.setDraft('task:user:t2', 'C');
    const st = useCommentDraftStore.getState();
    expect(st.getDraft('comment:deal:d1')).toBe('A');
    expect(st.getDraft('comment:deal:d1:reply:c9')).toBe('B');
    expect(st.getDraft('task:user:t2')).toBe('C');
  });

  it('persists drafts under itdevcrm-comment-drafts-v1', () => {
    useCommentDraftStore.getState().setDraft('comment:deal:d1', 'saved');
    const raw = window.localStorage.getItem('itdevcrm-comment-drafts-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.drafts['comment:deal:d1'].text).toBe('saved');
  });

  it('pruneOldDrafts drops entries older than the TTL and keeps fresh ones', () => {
    const now = 1_000_000_000_000;
    useCommentDraftStore.setState({
      drafts: {
        old: { text: 'stale', savedAt: now - DRAFT_TTL_MS - 1 },
        fresh: { text: 'keep', savedAt: now - 1000 },
      },
    });
    useCommentDraftStore.getState().pruneOldDrafts(now);
    const d = useCommentDraftStore.getState().drafts;
    expect('old' in d).toBe(false);
    expect(d.fresh?.text).toBe('keep');
  });

  it('builds thread keys', () => {
    expect(commentThreadKey('deal', 'd1')).toBe('comment:deal:d1');
    expect(commentThreadKey('deal', 'd1', 'c9')).toBe('comment:deal:d1:reply:c9');
    expect(taskThreadKey('assigned', 't1')).toBe('task:assigned:t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/comments/commentDraftStore.test.ts`
Expected: FAIL — cannot resolve `./commentDraftStore`.

- [ ] **Step 3: Write the implementation**

Create `src/features/comments/commentDraftStore.ts`:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-device, per-thread unsent comment text, persisted to localStorage so a
// draft survives tab switches, navigation, and refresh — cleared only when the
// comment is posted or the box is emptied. Mirrors tasksSeenStore/jobsBoardSortStore.

export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function commentThreadKey(parentType: string, parentId: string, replyToId?: string): string {
  return replyToId
    ? `comment:${parentType}:${parentId}:reply:${replyToId}`
    : `comment:${parentType}:${parentId}`;
}

export function taskThreadKey(kind: string, taskId: string): string {
  return `task:${kind}:${taskId}`;
}

type DraftEntry = { text: string; savedAt: number };

type State = {
  drafts: Record<string, DraftEntry>;
  getDraft: (key: string) => string;
  setDraft: (key: string, text: string) => void;
  clearDraft: (key: string) => void;
  pruneOldDrafts: (now: number) => void;
};

export const useCommentDraftStore = create<State>()(
  persist(
    (set, get) => ({
      drafts: {},
      getDraft: (key) => get().drafts[key]?.text ?? '',
      setDraft: (key, text) =>
        set((s) => {
          const next = { ...s.drafts };
          if (text.trim() === '') {
            delete next[key];
          } else {
            next[key] = { text, savedAt: Date.now() };
          }
          return { drafts: next };
        }),
      clearDraft: (key) =>
        set((s) => {
          if (!(key in s.drafts)) return s;
          const next = { ...s.drafts };
          delete next[key];
          return { drafts: next };
        }),
      pruneOldDrafts: (now) =>
        set((s) => {
          const next: Record<string, DraftEntry> = {};
          for (const [k, v] of Object.entries(s.drafts)) {
            if (now - v.savedAt < DRAFT_TTL_MS) next[k] = v;
          }
          return { drafts: next };
        }),
    }),
    {
      name: 'itdevcrm-comment-drafts-v1',
      partialize: (s) => ({ drafts: s.drafts }),
      onRehydrateStorage: () => (state) => {
        state?.pruneOldDrafts(Date.now());
      },
    },
  ),
);

export function useCommentDraft(key: string): {
  text: string;
  setText: (t: string) => void;
  clear: () => void;
} {
  const text = useCommentDraftStore((s) => s.drafts[key]?.text ?? '');
  const setDraft = useCommentDraftStore((s) => s.setDraft);
  const clearDraft = useCommentDraftStore((s) => s.clearDraft);
  return {
    text,
    setText: (t: string) => setDraft(key, t),
    clear: () => clearDraft(key),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/comments/commentDraftStore.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/comments/commentDraftStore.ts src/features/comments/commentDraftStore.test.ts
git commit -m "feat(comments): persistent comment-draft store + useCommentDraft hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Persist the `CommentForm` composer draft

**Files:**
- Modify: `src/features/comments/CommentForm.tsx`
- Test: `src/features/comments/CommentForm.draft.test.tsx` (new)

**Interfaces:**
- Consumes: `useCommentDraft(key)` and `commentThreadKey(parentType, parentId, replyToId?)` from Task 1; existing `useCreateComment()` (`mutateAsync(...)`), `useMentionableUsers()`.
- Produces: `CommentForm` unchanged public props `{ parentType, parentId, replyToId?, onCancelReply? }`.

**Context for the implementer:** `CommentForm.tsx` currently has `const [body, setBody] = useState('')` (line ~40). `setBody` is called from `onChange` (line ~66) and `applyMention` (line ~81), and reset to `''` after a successful `create.mutateAsync` in `onSubmit` (line ~137). Do NOT change the @mention logic, `resolveMentions`, or the JSX other than the value/handler bindings already wired to `body`/`setBody`. Cancelling a reply must NOT clear the draft.

- [ ] **Step 1: Write the failing test**

Create `src/features/comments/CommentForm.draft.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutateAsync = vi.fn(() => Promise.resolve(undefined));
vi.mock('./hooks/useCreateComment', () => ({
  useCreateComment: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('./hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { email: 'me@itdev.gr', user_metadata: {} } }),
}));

import { CommentForm } from './CommentForm';
import { useCommentDraftStore, commentThreadKey } from './commentDraftStore';

beforeEach(() => {
  mutateAsync.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

describe('CommentForm draft persistence', () => {
  it('restores a saved draft for this thread into the textarea', () => {
    useCommentDraftStore.getState().setDraft(commentThreadKey('deal', 'd1'), 'unsent text');
    render(<CommentForm parentType="deal" parentId="d1" />);
    expect(screen.getByRole('textbox')).toHaveValue('unsent text');
  });

  it('persists typed text to the store under the thread key', () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi there' } });
    expect(useCommentDraftStore.getState().getDraft(commentThreadKey('deal', 'd1'))).toBe('hi there');
  });

  it('clears the stored draft after a successful post', async () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'send me' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(useCommentDraftStore.getState().getDraft(commentThreadKey('deal', 'd1'))).toBe(''),
    );
  });

  it('keys reply drafts separately from the top-level draft', () => {
    useCommentDraftStore.getState().setDraft(commentThreadKey('deal', 'd1', 'c9'), 'reply draft');
    render(<CommentForm parentType="deal" parentId="d1" replyToId="c9" onCancelReply={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('reply draft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/comments/CommentForm.draft.test.tsx`
Expected: FAIL — the textarea does not restore/persist the draft (still uses local `useState`).

- [ ] **Step 3: Edit the implementation**

In `src/features/comments/CommentForm.tsx`:

Add the import (next to the other `./` imports near the top):

```tsx
import { useCommentDraft, commentThreadKey } from './commentDraftStore';
```

Replace the body state line (currently `const [body, setBody] = useState('');`):

```tsx
  const draftKey = commentThreadKey(parentType, parentId, replyToId);
  const { text: body, setText: setBody, clear: clearDraft } = useCommentDraft(draftKey);
```

In `onSubmit`, replace the post-success reset `setBody('');` with:

```tsx
    clearDraft();
```

If `useState` is now unused in the file, remove it from the `react` import (line 1: `import { useMemo, useRef, useState } from 'react';`) to satisfy `eslint --max-warnings=0`. (`useMemo` and `useRef` remain in use.) Verify with grep: `grep -n "useState" src/features/comments/CommentForm.tsx` should return nothing after the edit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/comments/CommentForm.draft.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0 (no unused-import/variable failures). The build takes a couple of minutes — let it finish.

- [ ] **Step 6: Commit**

```bash
git add src/features/comments/CommentForm.tsx src/features/comments/CommentForm.draft.test.tsx
git commit -m "feat(comments): persist CommentForm draft across tab switches / refresh

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Persist the `TaskComments` composer draft + final verify + push

**Files:**
- Modify: `src/features/tasks/TaskComments.tsx`
- Test: `src/features/tasks/TaskComments.draft.test.tsx` (new)

**Interfaces:**
- Consumes: `useCommentDraft(key)` and `taskThreadKey(kind, taskId)` from Task 1; existing `usePostTaskComment()` (`post.mutate(vars, { onSuccess })`), `useTaskComments(kind, taskId)`.
- Produces: `TaskComments` unchanged public props `{ kind, taskId, locale }`.

**Context for the implementer:** `TaskComments.tsx` currently has `const [body, setBody] = useState('')` (line ~43). `setBody` is called from the textarea `onChange` (line ~119) and reset to `''` in the post `onSuccess` callback (line ~48: `post.mutate({ kind, taskId, body: text }, { onSuccess: () => setBody('') })`). Change only the state binding and the clear call; leave the Enter-to-send, rendering, and post logic intact.

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/TaskComments.draft.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutate = vi.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
);
vi.mock('./hooks/usePostTaskComment', () => ({
  usePostTaskComment: () => ({ mutate, isPending: false }),
}));
vi.mock('./hooks/useTaskComments', () => ({
  useTaskComments: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' } }),
}));

import { TaskComments } from './TaskComments';
import { useCommentDraftStore, taskThreadKey } from '@/features/comments/commentDraftStore';

beforeEach(() => {
  mutate.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

describe('TaskComments draft persistence', () => {
  it('restores a saved draft into the textarea', () => {
    useCommentDraftStore.getState().setDraft(taskThreadKey('assigned', 't1'), 'wip note');
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    expect(screen.getByRole('textbox')).toHaveValue('wip note');
  });

  it('persists typed text under the task thread key', () => {
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typing' } });
    expect(useCommentDraftStore.getState().getDraft(taskThreadKey('assigned', 't1'))).toBe('typing');
  });

  it('clears the draft after a successful post', async () => {
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'done' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    await waitFor(() =>
      expect(useCommentDraftStore.getState().getDraft(taskThreadKey('assigned', 't1'))).toBe(''),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/TaskComments.draft.test.tsx`
Expected: FAIL — the textarea does not restore/persist the draft.

- [ ] **Step 3: Edit the implementation**

In `src/features/tasks/TaskComments.tsx`:

Add the import (next to the other imports near the top):

```tsx
import { useCommentDraft, taskThreadKey } from '@/features/comments/commentDraftStore';
```

Replace the body state line (currently `const [body, setBody] = useState('');`):

```tsx
  const { text: body, setText: setBody, clear: clearDraft } = useCommentDraft(taskThreadKey(kind, taskId));
```

In `submit`, change the post call's `onSuccess` from `() => setBody('')` to `() => clearDraft()`:

```tsx
    post.mutate({ kind, taskId, body: text }, { onSuccess: () => clearDraft() });
```

If `useState` is now unused, remove it from the `react` import (line 1: `import { useState, type FormEvent, type KeyboardEvent } from 'react';` → `import { type FormEvent, type KeyboardEvent } from 'react';`). Verify: `grep -n "useState" src/features/tasks/TaskComments.tsx` returns nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/TaskComments.draft.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Run the full feature test set + strict build**

```bash
npx vitest run src/features/comments/commentDraftStore.test.ts src/features/comments/CommentForm.draft.test.tsx src/features/tasks/TaskComments.draft.test.tsx
npm run build
```

Expected: all three files pass (15 tests total), build exits 0.
(Do NOT run the whole vitest suite — it talks to prod and has known unrelated fixture failures.)

- [ ] **Step 6: Commit and push**

```bash
git add src/features/tasks/TaskComments.tsx src/features/tasks/TaskComments.draft.test.tsx
git commit -m "feat(tasks): persist TaskComments draft across dialog close / refresh

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then verify tree state before pushing (owner may have committed in parallel): `git status` should show only the owner's untracked `g.sql`/`gg.json`/`gp.json`; `git log --oneline -6` should show exactly this feature's commits on top of the spec commit. Then:

```bash
git pull --rebase origin main && git push origin main
```

---

## Manual smoke checklist (after deploy, any tester)

1. Open a deal → type in the comments box → switch to another tab and back → text is still there. Refresh the page → still there. Post it → box clears. Empty the box manually → nothing restores on return.
2. Open a lead / client / job → same behaviour (shared composer).
3. Click Reply on a comment, type → switch tabs → reply text still there; Cancel does not lose it if reopened.
4. Open a task dialog → type a comment → close and reopen the dialog → text still there → post → clears.
5. Vercel stale-chunk gotcha: hard-refresh before believing anything "broke" after deploy.

## Changes / Revert

- Commits (in order): store+hook → CommentForm wiring → TaskComments wiring.
- Pure frontend; no DB/API/storage. Revert = `git revert` the three commits (or delete `commentDraftStore.*` + restore the two `useState('')` lines). Leftover `itdevcrm-comment-drafts-v1` localStorage entries are harmless and self-prune.
