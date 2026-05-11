import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUpsertTask } from './hooks/useUpsertTask';
import { useDeleteTask } from './hooks/useDeleteTask';
import type { UserTaskRow } from './hooks/useUserTasks';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this task; otherwise it creates a new one. */
  task?: UserTaskRow | null;
  /** Pre-fill the due-at when creating (e.g. clicked on a specific day in Day view). */
  defaultDueAt?: Date | null;
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskDialog({ open, onOpenChange, task, defaultDueAt }: Props) {
  const { t } = useTranslation('home');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const upsert = useUpsertTask();
  const del = useDeleteTask();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [completed, setCompleted] = useState(false);

  // Reset state every time the dialog opens with a different target.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setDueAt(toLocalInputValue(new Date(task.due_at)));
      setCompleted(!!task.completed_at);
    } else {
      setTitle('');
      setNotes('');
      setDueAt(toLocalInputValue(defaultDueAt ?? new Date()));
      setCompleted(false);
    }
  }, [open, task, defaultDueAt]);

  async function onSave() {
    if (!userId || !title.trim() || !dueAt) return;
    const payload = {
      user_id: task?.user_id ?? userId,
      title: title.trim(),
      notes: notes.trim() || null,
      due_at: new Date(dueAt).toISOString(),
      completed_at: completed ? task?.completed_at ?? new Date().toISOString() : null,
    };
    await upsert.mutateAsync(task?.id ? { ...payload, id: task.id } : payload);
    onOpenChange(false);
  }

  async function onDelete() {
    if (!task?.id) return;
    if (!confirm(t('task.confirm_delete', { defaultValue: 'Delete this task?' }))) return;
    await del.mutateAsync(task.id);
    onOpenChange(false);
  }

  const isEdit = !!task;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('task.edit_title', { defaultValue: 'Edit task' })
              : t('task.new_title', { defaultValue: 'New task' })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="task-title">{t('task.title', { defaultValue: 'Title' })}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="task-due-at">{t('task.due_at', { defaultValue: 'Due' })}</Label>
            <input
              id="task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="task-notes">{t('task.notes', { defaultValue: 'Notes' })}</Label>
            <textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="task-completed"
                checked={completed}
                onCheckedChange={(v) => setCompleted(v === true)}
              />
              <Label htmlFor="task-completed" className="font-normal">
                {t('task.completed', { defaultValue: 'Completed' })}
              </Label>
            </div>
          )}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          {isEdit ? (
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={del.isPending || upsert.isPending}
            >
              {t('task.delete', { defaultValue: 'Delete' })}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('task.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              onClick={onSave}
              disabled={!title.trim() || !dueAt || upsert.isPending || del.isPending}
            >
              {t('task.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
