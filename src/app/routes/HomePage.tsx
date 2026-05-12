import { CalendarPage } from '@/features/home/CalendarPage';
import { NotificationsColumn } from '@/features/notifications/NotificationsColumn';
import { AssignedTasksColumn } from '@/features/assigned_tasks/AssignedTasksColumn';

export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <CalendarPage />
        </div>
        <AssignedTasksColumn />
      </div>
      <NotificationsColumn />
    </div>
  );
}
