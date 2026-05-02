import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from './hooks/useNotifications';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';

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
    default:
      return null;
  }
}

function readString(p: NotifPayload, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function NotificationsBell() {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  useNotificationsRealtime();
  const [open, setOpen] = useState(false);

  const unreadCount = list.filter((n) => !n.read_at).length;

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
      <PopoverContent className="w-96" align="end">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('notifications.title')}</h3>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('notifications.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {list.map((n) => {
                const payload = (n.payload ?? null) as NotifPayload;
                const parentType = payload?.parent_type ?? null;
                const parentId = payload?.parent_id ?? null;
                const path = readPath(parentType, parentId);
                const author = readString(payload, 'author_name');
                const parentLabel = readString(payload, 'parent_label');
                const preview = readString(payload, 'preview');
                const when = new Date(n.created_at).toLocaleString();

                const body = (
                  <div
                    className={`rounded-md p-2 text-xs ${
                      n.read_at ? 'bg-slate-50' : 'bg-blue-50 font-medium'
                    }`}
                  >
                    {n.type === 'mention' ? (
                      <div className="space-y-0.5">
                        <div>
                          <span className="font-semibold">{author ?? 'Someone'}</span>{' '}
                          <span className="font-normal">mentioned you</span>
                          {parentLabel && (
                            <>
                              {' '}
                              <span className="font-normal">on</span>{' '}
                              <span className="font-semibold">{parentLabel}</span>
                            </>
                          )}
                        </div>
                        {preview && (
                          <div className="text-slate-700 font-normal italic">"{preview}"</div>
                        )}
                      </div>
                    ) : (
                      <div className="font-normal">
                        <span className="font-semibold">{n.type}</span>
                        {parentLabel && <> · {parentLabel}</>}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] font-normal text-muted-foreground">{when}</div>
                  </div>
                );

                return (
                  <li key={n.id}>
                    {path ? (
                      <Link
                        to={path}
                        onClick={() => onItemClick(n.id, !!n.read_at)}
                        className="block"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onItemClick(n.id, !!n.read_at)}
                        className="block w-full text-left"
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
