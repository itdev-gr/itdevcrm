import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from './hooks/useNotifications';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';

export function NotificationsBell() {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  useNotificationsRealtime();

  const unreadCount = list.filter((n) => !n.read_at).length;

  return (
    <Popover>
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
      <PopoverContent className="w-80">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('notifications.title')}</h3>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('notifications.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {list.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-md p-2 text-xs ${n.read_at ? 'bg-slate-50' : 'bg-blue-50 font-medium'}`}
                  onClick={() => !n.read_at && void mark.mutateAsync(n.id)}
                  role="button"
                >
                  <div>{n.type}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
