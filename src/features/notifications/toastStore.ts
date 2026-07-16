import { create } from 'zustand';
import type { NotificationRow } from './hooks/useNotifications';

// Max number of toasts stacked on screen at once. Pushing beyond this drops
// the oldest so the stack never grows unbounded.
const MAX_TOASTS = 4;

// One live toast. The id is the notification row's own uuid — reused as the
// toast key so realtime re-emits of the same row can be de-duplicated without
// generating a fresh id (Date.now/random would break test determinism).
export type ToastEntry = { id: string; notif: NotificationRow };

type ToastState = {
  toasts: ToastEntry[];
  push: (notif: NotificationRow) => void;
  dismiss: (id: string) => void;
};

// Ephemeral in-memory store (NO persist) — toasts are transient UI state that
// should reset on reload.
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (notif) =>
    set((s) => {
      // Dedup: a toast for this notification is already visible — no-op.
      if (s.toasts.some((t) => t.id === notif.id)) return s;
      const next = [...s.toasts, { id: notif.id, notif }];
      // Cap the stack: keep the newest MAX_TOASTS, dropping the oldest.
      return { toasts: next.slice(-MAX_TOASTS) };
    }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
