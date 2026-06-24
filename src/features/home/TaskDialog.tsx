import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { useUpsertTask } from './hooks/useUpsertTask';
import { useDeleteTask } from './hooks/useDeleteTask';
import type { UserTaskRow } from './hooks/useUserTasks';
import { ImportanceSelect } from '@/features/tasks/ImportanceSelect';
import { importanceOf, type ImportanceCode } from '@/features/tasks/importance';
import { ClientPicker, type PickedClient } from '@/features/clients/ClientPicker';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this task; otherwise it creates a new one. */
  task?: UserTaskRow | null;
  /** Pre-fill the due-at when creating (e.g. clicked on a specific day in Day view). */
  defaultDueAt?: Date | null;
  /** Pre-select a client when creating (e.g. from a client's Tasks tab). */
  defaultClient?: PickedClient | null;
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskDialog({ open, onOpenChange, task, defaultDueAt, defaultClient }: Props) {
  const { t } = useTranslation('home');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  // Assign to = full staff directory (incl. service teams), not sales-only owners.
  const { data: owners = [] } = useMentionableUsers();
  const upsert = useUpsertTask();
  const del = useDeleteTask();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [completed, setCompleted] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [importance, setImportance] = useState<ImportanceCode | ''>('');
  const [client, setClient] = useState<PickedClient | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset state every time the dialog opens with a different target.
   
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setDueAt(toLocalInputValue(new Date(task.due_at)));
      setCompleted(!!task.completed_at);
      setAssigneeId(task.user_id);
      setImportance(importanceOf(task));
      setClient(task.client_id ? { id: task.client_id, name: '' } : null);
    } else {
      setTitle('');
      setNotes('');
      setDueAt(toLocalInputValue(defaultDueAt ?? new Date()));
      setCompleted(false);
      setAssigneeId(userId);
      setImportance('');
      setClient(defaultClient ?? null);
    }
  }, [open, task, defaultDueAt, defaultClient, userId]);

  async function onSave() {
    if (!userId || !title.trim() || !dueAt || !importance) return;
    const assignee = assigneeId || userId;
    const payload = {
      user_id: assignee,
      ...(assignee !== userId ? { created_by: task?.created_by ?? userId } : {}),
      title: title.trim(),
      notes: notes.trim() || null,
      due_at: new Date(dueAt).toISOString(),
      importance,
      completed_at: completed ? task?.completed_at ?? new Date().toISOString() : null,
      client_id: client?.id ?? null,
    };
    await upsert.mutateAsync(task?.id ? { ...payload, id: task.id } : payload);
    onOpenChange(false);
  }

  async function onDelete() {
    if (!task?.id) return;
    await del.mutateAsync(task.id);
    setConfirmDelete(false);
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
          <DialogDescription className="sr-only">{t('task.dialog_description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t('task.title', { defaultValue: 'Title' })}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-assignee">
              {t('task.assignee', { defaultValue: 'Assign to' })}
            </Label>
            <select
              id="task-assignee"
              value={assigneeId || userId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
            >
              {!owners.some((o) => o.user_id === (assigneeId || userId)) && (
                <option value={assigneeId || userId}>
                  {t('task.assignee_me', { defaultValue: 'Me' })}
                </option>
              )}
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.user_id === userId
                    ? t('task.assignee_me', { defaultValue: 'Me' })
                    : o.full_name || o.email}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-due-at">{t('task.due_at', { defaultValue: 'Due' })}</Label>
            <input
              id="task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-importance">{t('importance.label', { ns: 'common', defaultValue: 'Importance' })}</Label>
            <ImportanceSelect id="task-importance" value={importance} onChange={setImportance} />
          </div>
          <ClientPicker value={client} onChange={setClient} id="task-client" />
          <div className="space-y-1.5">
            <Label htmlFor="task-notes">{t('task.notes', { defaultValue: 'Notes' })}</Label>
            <textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-input/80 bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
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
              onClick={() => setConfirmDelete(true)}
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
              disabled={!title.trim() || !dueAt || !importance || upsert.isPending || del.isPending}
            >
              {t('task.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </DialogFooter>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('task.confirm_delete', { defaultValue: 'Delete this task?' })}
          confirmLabel={t('task.delete', { defaultValue: 'Delete' })}
          onConfirm={onDelete}
          pending={del.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
