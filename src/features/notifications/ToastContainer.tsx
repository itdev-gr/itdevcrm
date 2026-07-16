import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { isToastable } from './toastableTypes';
import type { NotificationRow } from './hooks/useNotifications';
import { CompactNotificationRow, readPath, readString, type NotifPayload } from './notification-presenters';

// Max toasts stacked at once; a 5th drops the oldest.
const MAX_TOASTS = 4;
// Each toast lingers this long before it auto-dismisses.
const AUTO_DISMISS_MS = 6000;

function ToastCard({ notif, onDismiss }: { notif: NotificationRow; onDismiss: (id: string) => void }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const payload = (notif.payload ?? null) as NotifPayload;
  const path = readPath(payload);
  const parentLabel = readString(payload, 'parent_label');

  // Enter transition: mount hidden, flip visible on the next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 6s auto-dismiss; timer cleared if the card unmounts first.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notif.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, notif.id]);

  function onOpen() {
    if (path) navigate(path);
    onDismiss(notif.id);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onOpen}
      className={cn(
        'relative w-80 max-w-[calc(100vw-2rem)] cursor-pointer rounded-lg border border-border/60 bg-background p-2 pr-7 shadow-lg transition-all duration-200 ease-out',
        visible ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0',
      )}
    >
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notif.id);
        }}
        className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <CompactNotificationRow
        type={notif.type}
        payload={payload}
        parentLabel={parentLabel}
        isRead={!!notif.read_at}
        createdAt={notif.created_at}
      />
    </div>
  );
}

// Bottom-left toast stack, above AppShell's z-40 drawer / z-30 topbar. Newest
// sits on top (flex-col-reverse). Self-contained: it owns its realtime
// subscription AND its list state (React useState), so there is no cross-module
// zustand store that code-splitting could duplicate into a producer copy and a
// renderer copy — an earlier design pushed into one store while the component
// rendered another, so no toast ever appeared. Toasts fire only for
// post-subscribe INSERTs, so a page load never backfills existing notifications.
export function ToastContainer() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // Unique suffix so this channel never collides with the bell's/column's
  // notifications channel (two postgres_changes subs can't share a name).
  const instanceId = useId();
  const [toasts, setToasts] = useState<NotificationRow[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`toasts-${userId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (!isToastable(row.type)) return;
          setToasts((prev) =>
            prev.some((t) => t.id === row.id) ? prev : [...prev, row].slice(-MAX_TOASTS),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, instanceId]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col-reverse gap-2">
      {toasts.map((notif) => (
        <ToastCard key={notif.id} notif={notif} onDismiss={dismiss} />
      ))}
    </div>
  );
}
