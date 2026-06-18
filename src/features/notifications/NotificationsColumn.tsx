import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, AtSign, Bell, CheckCircle2, CreditCard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { relativeFromNow } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useNotifications } from './hooks/useNotifications';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useDeleteNotification } from './hooks/useDeleteNotification';
import { useClearAllNotifications } from './hooks/useClearAllNotifications';

type NotifPayload = Record<string, unknown> | null;

function readPath(parentType: unknown, parentId: unknown): string | null {
  if (typeof parentId !== 'string') return null;
  switch (parentType) {
    case 'lead':
      return `/leads/${parentId}`;
    case 'client':
      return `/clients/${parentId}`;
    case 'deal':
      return `/deals/${parentId}`;
    case 'job':
      return `/jobs/${parentId}`;
    default:
      return null;
  }
}

function readString(p: NotifPayload, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function NotifIcon({ type }: { type: string }) {
  const className = 'mt-0.5 size-4 shrink-0';
  switch (type) {
    case 'mention':
      return <AtSign className={cn(className, 'text-primary')} />;
    case 'task_assigned':
    case 'task_resolved':
      return <CheckCircle2 className={cn(className, 'text-emerald-600 dark:text-emerald-400')} />;
    case 'payment_overdue':
      return <AlertTriangle className={cn(className, 'text-red-600 dark:text-red-400')} />;
    default:
      return <Bell className={cn(className, 'text-muted-foreground')} />;
  }
}

function NotificationBody({
  type,
  payload,
  parentLabel,
  isRead,
}: {
  type: string;
  payload: NotifPayload;
  parentLabel: string | null;
  isRead: boolean;
}) {
  const author = readString(payload, 'author_name');
  const preview = readString(payload, 'preview');
  const titleClass = isRead ? 'text-muted-foreground' : 'font-medium text-foreground';

  if (type === 'mention') {
    return (
      <>
        <p className={cn('text-sm leading-snug', titleClass)}>
          <span className="font-semibold">{author ?? 'Someone'}</span> mentioned you
          {parentLabel && (
            <>
              {' '}
              on <span className="font-semibold">{parentLabel}</span>
            </>
          )}
        </p>
        {preview && <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{preview}&rdquo;</p>}
      </>
    );
  }

  if (type === 'task_assigned') {
    return (
      <>
        <p className={cn('text-sm leading-snug', titleClass)}>
          New task assigned
          {readString(payload, 'source_code') && (
            <>
              {' '}
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {readString(payload, 'source_code')}
              </span>
            </>
          )}
        </p>
        {readString(payload, 'title') && (
          <p className="mt-1 text-xs text-muted-foreground">{readString(payload, 'title')}</p>
        )}
      </>
    );
  }

  if (type === 'task_resolved') {
    return (
      <>
        <p className={cn('text-sm leading-snug', titleClass)}>Task resolved</p>
        {readString(payload, 'title') && (
          <p className="mt-1 text-xs text-muted-foreground">{readString(payload, 'title')}</p>
        )}
      </>
    );
  }

  if (type === 'payment_overdue') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {parentLabel && <p className={cn('text-sm', titleClass)}>{parentLabel}</p>}
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <CreditCard className="size-2.5" />
            Overdue
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {readString(payload, 'service_type')}
          {payload?.amount_gross != null && <> · €{Number(payload.amount_gross).toFixed(2)}</>}
          {readString(payload, 'due_date') && <> · due {readString(payload, 'due_date')}</>}
        </p>
      </>
    );
  }

  return (
    <p className={cn('text-sm', titleClass)}>
      <span className="font-semibold">{type}</span>
      {parentLabel && <> · {parentLabel}</>}
    </p>
  );
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
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-4">
        <div>
          <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
          {unread > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {unread} unread
            </p>
          )}
        </div>
        {list.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
            className="text-xs"
          >
            {t('notifications.clear_all')}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-12 text-center">
            <Bell className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t('notifications.empty')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((n) => {
              const payload = (n.payload ?? null) as NotifPayload;
              const parentType = payload?.parent_type ?? null;
              const parentId = payload?.parent_id ?? null;
              const path = readPath(parentType, parentId);
              const parentLabel = readString(payload, 'parent_label');
              const isRead = !!n.read_at;

              const body = (
                <div className="flex min-w-0 flex-1 gap-2.5">
                  <NotifIcon type={n.type} />
                  <div className="min-w-0 flex-1">
                    <NotificationBody
                      type={n.type}
                      payload={payload}
                      parentLabel={parentLabel}
                      isRead={isRead}
                    />
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {relativeFromNow(n.created_at)}
                    </p>
                  </div>
                </div>
              );

              return (
                <li key={n.id}>
                  <div
                    className={cn(
                      'group flex items-start gap-1 rounded-xl border border-l-[3px] p-3 transition-colors',
                      isRead
                        ? 'border-border/50 border-l-border/50 bg-background/60'
                        : 'border-primary/20 border-l-primary bg-primary/5 shadow-sm',
                    )}
                  >
                    {path ? (
                      <Link
                        to={path}
                        onClick={() => {
                          if (!isRead) mark.mutate(n.id);
                        }}
                        className="block min-w-0 flex-1"
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
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <X className="size-3.5" />
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
