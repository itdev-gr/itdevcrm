import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
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
import { useResolveTask } from '@/features/tasks/hooks/useResolveTask';
import type { UserTaskRow } from './hooks/useUserTasks';
import { ImportanceSelect } from '@/features/tasks/ImportanceSelect';
import { importanceOf, type ImportanceCode } from '@/features/tasks/importance';
import { ClientPicker, type PickedClient } from '@/features/clients/ClientPicker';
import { ClientOpenTasksList } from '@/features/tasks/ClientOpenTasksList';
import { LeadPicker, type PickedLead } from '@/features/leads/LeadPicker';
import { useClientDealOptions } from '@/features/deals/hooks/useClientDealOptions';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { taskLinkMode, filterTaskAssignees } from './taskDialogRules';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this task; otherwise it creates a new one. */
  task?: UserTaskRow | null;
  /** Pre-fill the due-at when creating (e.g. clicked on a specific day in Day view). */
  defaultDueAt?: Date | null;
  /** Pre-select a client when creating (e.g. from a client's Tasks tab). */
  defaultClient?: PickedClient | null;
  /** Pre-select a lead when creating (e.g. from a lead's Tasks tab). */
  defaultLead?: PickedLead | null;
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskDialog({ open, onOpenChange, task, defaultDueAt, defaultClient, defaultLead }: Props) {
  const { t } = useTranslation('home');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isSales = groupCodes.includes('sales') && !isAdmin;
  // Assign to = full staff directory (incl. service teams), not sales-only owners.
  const { data: owners = [] } = useMentionableUsers();
  const assignees = filterTaskAssignees(owners, isSales);
  const upsert = useUpsertTask();
  const del = useDeleteTask();
  const resolveTask = useResolveTask();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [completed, setCompleted] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [importance, setImportance] = useState<ImportanceCode | ''>('');
  const [client, setClient] = useState<PickedClient | null>(null);
  const [lead, setLead] = useState<PickedLead | null>(null);
  const [dealId, setDealId] = useState('');
  const [jobId, setJobId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Optional deal/job target (client mode). Deals scoped to the client; jobs to the deal.
  const { data: dealOptions = [] } = useClientDealOptions(client?.id);
  const { data: jobOptions = [] } = useJobsForDeal(dealId);

  const mode = taskLinkMode({
    isSales,
    editLeadId: task?.lead_id ?? null,
    editClientId: task?.client_id ?? null,
    hasDefaultLead: !!defaultLead,
    hasDefaultClient: !!defaultClient,
  });

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
      setLead(task.lead_id ? { id: task.lead_id, name: '' } : null);
      setDealId(task.deal_id ?? '');
      setJobId(task.job_id ?? '');
    } else {
      setTitle('');
      setNotes('');
      setDueAt(toLocalInputValue(defaultDueAt ?? new Date()));
      setCompleted(false);
      setAssigneeId(userId);
      setImportance('');
      setClient(defaultClient ?? null);
      setLead(defaultLead ?? null);
      setDealId('');
      setJobId('');
    }
  }, [open, task, defaultDueAt, defaultClient, defaultLead, userId]);

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
      ...(mode === 'lead'
        ? { lead_id: lead?.id ?? null, client_id: null, deal_id: null, job_id: null }
        : {
            client_id: client?.id ?? null,
            lead_id: null,
            deal_id: client ? dealId || null : null,
            job_id: client ? jobId || null : null,
          }),
    };
    // Content upsert is completion-agnostic: the DB guard rejects any direct
    // open→terminal write, so completion state is owned by resolve_task, not here.
    await upsert.mutateAsync(task?.id ? { ...payload, id: task.id } : payload);
    // Reconcile the completion transition only for existing tasks (a new task is
    // never created completed, and the checkbox is hidden on create).
    if (task?.id) {
      const wasCompleted = !!task.completed_at;
      if (!wasCompleted && completed) {
        // Open → completed: stamp our side via the RPC. Honor its result — for a
        // two-party task this half-stamps and the board shows the awaiting badge.
        await resolveTask.mutateAsync({ kind: 'user', id: task.id });
      } else if (wasCompleted && !completed) {
        // Completed → open: the guard allows terminal→open, so reopen directly.
        // This also fires the DB trigger that clears the resolve stamps.
        const { error } = await supabase
          .from('user_tasks')
          .update({ completed_at: null })
          .eq('id', task.id);
        if (error) throw new Error(error.message);
        void qc.invalidateQueries({ queryKey: ['user-tasks'] });
        void qc.invalidateQueries({ queryKey: ['client-tasks'] });
        void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
        void qc.invalidateQueries({ queryKey: ['comments'] });
      }
    }
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
              {!assignees.some((o) => o.user_id === (assigneeId || userId)) && (
                <option value={assigneeId || userId}>
                  {t('task.assignee_me', { defaultValue: 'Me' })}
                </option>
              )}
              {assignees.map((o) => (
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
          {mode === 'lead' ? (
            <LeadPicker value={lead} onChange={setLead} id="task-lead" />
          ) : (
            <div className="space-y-2">
              <ClientPicker
                value={client}
                onChange={(c) => {
                  setClient(c);
                  setDealId('');
                  setJobId('');
                }}
                id="task-client"
              />
              {client && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="task-deal">{t('task.deal', { defaultValue: 'Deal' })}</Label>
                    <select
                      id="task-deal"
                      value={dealId}
                      onChange={(e) => {
                        setDealId(e.target.value);
                        setJobId('');
                      }}
                      className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
                    >
                      <option value="">{t('task.target_none', { defaultValue: '— none —' })}</option>
                      {dealOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code ? `${d.code} · ${d.title ?? ''}` : d.title ?? d.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-job">{t('task.job', { defaultValue: 'Job' })}</Label>
                    <select
                      id="task-job"
                      value={jobId}
                      disabled={!dealId}
                      onChange={(e) => setJobId(e.target.value)}
                      className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20 disabled:opacity-50"
                    >
                      <option value="">{t('task.target_none', { defaultValue: '— none —' })}</option>
                      {jobOptions.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.code ?? j.service_type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {!isEdit && client && <ClientOpenTasksList clientId={client.id} />}
            </div>
          )}
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
