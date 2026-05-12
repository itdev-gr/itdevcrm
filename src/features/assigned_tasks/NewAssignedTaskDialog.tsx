import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useCreateAssignedTask } from './hooks/useCreateAssignedTask';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: { kind: 'deal' | 'job'; id: string };
};

export function NewAssignedTaskDialog({ open, onOpenChange, source }: Props) {
  // jobs and deals share the same i18n block (assigned_tasks.*); namespace
  // doesn't matter here as long as the keys exist in both. Use 'jobs'.
  const { t } = useTranslation('jobs');
  const create = useCreateAssignedTask();
  const { data: owners = [] } = useAssignableOwners();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeUserId) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({
        source,
        title: title.trim(),
        description: description.trim() || null,
        assigneeUserId,
      });
      setTitle('');
      setDescription('');
      setAssigneeUserId('');
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assigned_tasks.new_task')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="at-title">{t('assigned_tasks.title_placeholder')}</Label>
            <Input
              id="at-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-desc">{t('assigned_tasks.description_placeholder')}</Label>
            <textarea
              id="at-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-assignee">{t('assigned_tasks.assignee_label')}</Label>
            <select
              id="at-assignee"
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              required
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="" disabled>—</option>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.full_name || o.email}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !title.trim() || !assigneeUserId}
            >
              {t('assigned_tasks.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
