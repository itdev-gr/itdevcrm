import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuthStore } from '@/lib/stores/authStore';
import { useNotifications } from './hooks/useNotifications';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';
import {
  CompactNotificationRow,
  readPath,
  readString,
  type NotifPayload,
} from './notification-presenters';

export function NotificationsBell() {
  const { t } = useTranslation('sales');
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const viewer = { groupCodes, isAdmin };
  const { data: all = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  useNotificationsRealtime();
  const [open, setOpen] = useState(false);

  const list = all.filter((n) => !n.read_at);
  const unreadCount = list.length;

  function onItemClick(notifId: string, alreadyRead: boolean) {
    if (!alreadyRead) void mark.mutateAsync(notifId);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] text-white">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0" align="end">
        <div className="border-b border-border/60 px-3 py-2">
          <h3 className="text-xs font-semibold">{t('notifications.title')}</h3>
        </div>
        <div className="max-h-[min(22rem,70vh)] overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
              {t('notifications.empty_unread', { defaultValue: 'All caught up.' })}
            </p>
          ) : (
            <ul className="space-y-1">
              {list.map((n) => {
                const payload = (n.payload ?? null) as NotifPayload;
                const path = readPath(payload, viewer);
                const parentLabel = readString(payload, 'parent_label');
                const body = (
                  <CompactNotificationRow
                    type={n.type}
                    payload={payload}
                    parentLabel={parentLabel}
                    isRead={!!n.read_at}
                    createdAt={n.created_at}
                  />
                );

                return (
                  <li key={n.id}>
                    {path ? (
                      <Link
                        to={path}
                        onClick={() => onItemClick(n.id, !!n.read_at)}
                        className="block rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onItemClick(n.id, !!n.read_at)}
                        className="block w-full rounded-lg text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
