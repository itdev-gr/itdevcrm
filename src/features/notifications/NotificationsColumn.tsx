import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { relativeFromNow } from '@/lib/datetime';
import { useNotifications } from './hooks/useNotifications';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useMarkAllNotificationsRead } from './hooks/useMarkAllNotificationsRead';

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

export function NotificationsColumn() {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  useNotificationsRealtime();

  const unread = list.filter((n) => !n.read_at).length;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
          {unread > 0 && (
            <p className="text-[11px] text-muted-foreground">{unread} unread</p>
          )}
        </div>
        {unread > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="text-xs"
          >
            {t('notifications.clear_all')}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{t('notifications.empty')}</p>
        ) : (
          <ul className="divide-y">
            {list.map((n) => {
              const payload = (n.payload ?? null) as NotifPayload;
              const parentType = payload?.parent_type ?? null;
              const parentId = payload?.parent_id ?? null;
              const path = readPath(parentType, parentId);
              const author = readString(payload, 'author_name');
              const parentLabel = readString(payload, 'parent_label');
              const preview = readString(payload, 'preview');
              const isRead = !!n.read_at;

              const body = (
                <div
                  className={`flex-1 space-y-0.5 text-xs ${isRead ? 'text-muted-foreground' : 'text-foreground'}`}
                >
                  {n.type === 'mention' ? (
                    <>
                      <div className={isRead ? '' : 'font-medium'}>
                        <span className="font-semibold">{author ?? 'Someone'}</span>{' '}
                        mentioned you
                        {parentLabel && (
                          <>
                            {' '}on <span className="font-semibold">{parentLabel}</span>
                          </>
                        )}
                      </div>
                      {preview && (
                        <div className="italic text-muted-foreground">&ldquo;{preview}&rdquo;</div>
                      )}
                    </>
                  ) : n.type === 'task_assigned' ? (
                    <>
                      <div className={isRead ? '' : 'font-medium'}>
                        You were assigned a task
                        {readString(payload, 'source_code') && (
                          <>
                            {' '}on{' '}
                            <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                              {readString(payload, 'source_code')}
                            </span>
                          </>
                        )}
                      </div>
                      {readString(payload, 'title') && (
                        <div className="italic text-foreground">&ldquo;{readString(payload, 'title')}&rdquo;</div>
                      )}
                    </>
                  ) : n.type === 'task_resolved' ? (
                    <>
                      <div className={isRead ? '' : 'font-medium'}>
                        A task you created was resolved
                        {readString(payload, 'source_code') && (
                          <>
                            {' '}on{' '}
                            <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                              {readString(payload, 'source_code')}
                            </span>
                          </>
                        )}
                      </div>
                      {readString(payload, 'title') && (
                        <div className="italic text-foreground">&ldquo;{readString(payload, 'title')}&rdquo;</div>
                      )}
                    </>
                  ) : n.type === 'payment_overdue' ? (
                    <>
                      <div className={isRead ? '' : 'font-medium'}>
                        <span className="font-semibold text-red-700 dark:text-red-300">⚠ Payment overdue</span>
                        {parentLabel && (
                          <>
                            {' '}— <span className="font-semibold">{parentLabel}</span>
                          </>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        {readString(payload, 'service_type')}
                        {payload?.amount_gross != null && (
                          <> · €{Number(payload.amount_gross).toFixed(2)}</>
                        )}
                        {readString(payload, 'due_date') && (
                          <> · due {readString(payload, 'due_date')}</>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className={isRead ? '' : 'font-medium'}>
                      <span className="font-semibold">{n.type}</span>
                      {parentLabel && <> · {parentLabel}</>}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">{relativeFromNow(n.created_at)}</div>
                </div>
              );

              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-2 px-4 py-3 ${
                    isRead ? 'bg-card' : 'bg-blue-50/40 dark:bg-blue-950/20'
                  }`}
                >
                  {path ? (
                    <Link to={path} className="block flex-1 min-w-0">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex-1 min-w-0">{body}</div>
                  )}
                  {!isRead && (
                    <button
                      type="button"
                      onClick={() => mark.mutate(n.id)}
                      title={t('notifications.clear')}
                      aria-label={t('notifications.clear')}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
