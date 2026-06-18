import { CalendarPage } from '@/features/home/CalendarPage';
import { NotificationsColumn } from '@/features/notifications/NotificationsColumn';
import { AssignedTasksColumn } from '@/features/assigned_tasks/AssignedTasksColumn';

export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1 gap-0 bg-muted/20">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
          <CalendarPage />
        </div>
        <AssignedTasksColumn />
      </div>
      <NotificationsColumn />
    </div>
  );
}
