import { CalendarPage } from '@/features/home/CalendarPage';
import { NotificationsColumn } from '@/features/notifications/NotificationsColumn';

export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CalendarPage />
      </div>
      <NotificationsColumn />
    </div>
  );
}
