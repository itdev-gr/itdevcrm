import { useState } from 'react';
import { SquareArrowOutUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { parseTaskKey } from '@/features/tasks/taskCommentRef';
import { useUserTask } from '@/features/tasks/hooks/useUserTask';
import { userTaskToCard } from '@/features/tasks/taskCard';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';

/** "Open task" affordance on a task auto-comment; opens the task dialog in
 *  place. RLS decides access: an unreadable user task shows a no-access note. */
export function TaskCommentLink({ taskKey }: { taskKey: string }) {
  const ref = parseTaskKey(taskKey);
  const [open, setOpen] = useState(false);
  if (!ref) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <SquareArrowOutUpRight className="size-3.5" />
        Open task
      </button>
      {open && ref.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={ref.id} onOpenChange={(o) => !o && setOpen(false)} />
      )}
      {open && ref.kind === 'user' && (
        <UserTaskById taskId={ref.id} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function UserTaskById({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { data: row, isLoading } = useUserTask(taskId);
  if (isLoading) return null;
  if (!row) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="text-sm font-medium">Task</DialogTitle>
          <DialogDescription>Task not found or you don't have access.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }
  return <UserTaskDetailDialog card={userTaskToCard(row, meId)} onOpenChange={(o) => !o && onClose()} />;
}
