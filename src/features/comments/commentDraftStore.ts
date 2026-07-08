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
