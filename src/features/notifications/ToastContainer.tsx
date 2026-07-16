import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToastStore, type ToastEntry } from './toastStore';
import { useNotificationToasts } from './hooks/useNotificationToasts';
import {
  CompactNotificationRow,
  readPath,
  readString,
  type NotifPayload,
} from './notification-presenters';

// Each toast lingers this long before it auto-dismisses.
const AUTO_DISMISS_MS = 6000;
// Keep the card mounted briefly after close so the leave transition can play.
const LEAVE_MS = 200;

function ToastCard({ entry }: { entry: ToastEntry }) {
  const navigate = useNavigate();
  const dismiss = useToastStore((s) => s.dismiss);
  const { id, notif } = entry;
  const [visible, setVisible] = useState(false);

  // Match NotificationsBell's row usage exactly so the toast body renders
  // identically to the bell popover.
  const payload = (notif.payload ?? null) as NotifPayload;
  const path = readPath(payload);
  const parentLabel = readString(payload, 'parent_label');

  const close = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => dismiss(id), LEAVE_MS);
  }, [dismiss, id]);

  // Enter transition: mount hidden, flip visible on the next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 6s auto-dismiss; timer cleared if the card unmounts first.
  useEffect(() => {
    const timer = window.setTimeout(close, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [close]);

  function onOpen() {
    if (path) navigate(path);
    close();
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
          close();
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
// sits on top (flex-col-reverse) and the stack grows upward from the anchor.
// This is the single app-wide mount point, so it also drives the realtime hook
// that feeds the store from post-subscribe notification inserts.
export function ToastContainer() {
  // Subscribe once here (single mount point) to push toasts on realtime insert.
  useNotificationToasts();
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col-reverse gap-2">
      {toasts.map((entry) => (
        <ToastCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
