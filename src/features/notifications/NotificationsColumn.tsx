import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell, X, AlertTriangle, Archive, AtSign, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotifications } from './hooks/useNotifications';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useDeleteNotification } from './hooks/useDeleteNotification';
import { useClearAllNotifications } from './hooks/useClearAllNotifications';
import {
  CompactNotificationContent,
  notificationShellClass,
  readPath,
  readString,
  type NotifPayload,
} from './notification-presenters';

function NotifIcon({ type }: { type: string }) {
  const className = 'size-3.5 shrink-0';
  switch (type) {
    case 'mention':
      return <AtSign className={cn(className, 'text-primary')} />;
    case 'task_assigned':
    case 'task_resolved':
    case 'cadence_task_transferred':
      return <CheckCircle2 className={cn(className, 'text-emerald-600 dark:text-emerald-400')} />;
    case 'payment_overdue':
    case 'cadence_task_overdue':
      return <AlertTriangle className={cn(className, 'text-red-600 dark:text-red-400')} />;
    case 'job_archived':
      return <Archive className={cn(className, 'text-muted-foreground')} />;
    default:
      return <Bell className={cn(className, 'text-muted-foreground')} />;
  }
}

export function NotificationsColumn() {
  const { t } = useTranslation('sales');
  const { data: all = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  const del = useDeleteNotification();
  const clearAll = useClearAllNotifications();
  useNotificationsRealtime();

  const list = all;
  const unread = all.filter((n) => !n.read_at).length;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border/60 bg-card/80 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
        <div>
          <h2 className="text-xs font-semibold">{t('notifications.title')}</h2>
          {unread > 0 && (
            <p className="text-[10px] text-muted-foreground">{unread} unread</p>
          )}
        </div>
        {list.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
            className="h-7 px-2 text-[11px]"
          >
            {t('notifications.clear_all')}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-10 text-center">
            <Bell className="mb-2 size-7 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">{t('notifications.empty')}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {list.map((n) => {
              const payload = (n.payload ?? null) as NotifPayload;
              const path = readPath(payload);
              const parentLabel = readString(payload, 'parent_label');
              const isRead = !!n.read_at;

              const body = (
                <div className={cn(notificationShellClass(isRead), 'items-start border-l-2', isRead ? 'border-l-border/40' : 'border-l-primary/40')}>
                  <NotifIcon type={n.type} />
                  <div className="min-w-0 flex-1">
                    <CompactNotificationContent
                      type={n.type}
                      payload={payload}
                      parentLabel={parentLabel}
                      isRead={isRead}
                      createdAt={n.created_at}
                    />
                  </div>
                </div>
              );

              return (
                <li key={n.id}>
                  <div className="group flex items-start gap-0.5">
                    {path ? (
                      <Link
                        to={path}
                        onClick={() => {
                          if (!isRead) mark.mutate(n.id);
                        }}
                        className="block min-w-0 flex-1 rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1">{body}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => del.mutate(n.id)}
                      title={t('notifications.clear')}
                      aria-label={t('notifications.clear')}
                      className="mt-1 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
