import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useCreateAssignedTask } from './hooks/useCreateAssignedTask';
import { ImportanceSelect } from '@/features/tasks/ImportanceSelect';
import type { ImportanceCode } from '@/features/tasks/importance';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: { kind: 'deal' | 'job'; id: string };
};

export function NewAssignedTaskDialog({ open, onOpenChange, source }: Props) {
  const { t, i18n } = useTranslation('jobs');
  const locale: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const create = useCreateAssignedTask();
  // Task assignees = the full staff directory (incl. service teams like
  // local_seo/web_seo), NOT the sales-only assignable_owners list.
  const { data: owners = [] } = useMentionableUsers();
  const { data: groups = [] } = useGroups();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [importance, setImportance] = useState<ImportanceCode | ''>('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeUserId || !departmentId || !importance) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({
        source,
        title: title.trim(),
        description: description.trim() || null,
        assigneeUserId,
        departmentId,
        importance,
      });
      setTitle('');
      setDescription('');
      setAssigneeUserId('');
      setDepartmentId(null);
      setImportance('');
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!title.trim() && !!assigneeUserId && !!departmentId && !!importance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assigned_tasks.new_task')}</DialogTitle>
          <DialogDescription className="sr-only">{t('assigned_tasks.new_task_description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="at-title">{t('assigned_tasks.title_placeholder')}</Label>
            <Input id="at-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
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
          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              {t('assigned_tasks.department_label')} <span className="text-red-600 dark:text-red-400">*</span>
            </span>
            <p className="text-[11px] text-muted-foreground">{t('assigned_tasks.department_hint')}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {groups.map((g) => {
                const selected = departmentId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDepartmentId(selected ? null : g.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      selected
                        ? 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                        : 'border-border bg-muted text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {g.display_names[locale]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-importance">
              {t('importance.label', { ns: 'common' })} <span className="text-red-600 dark:text-red-400">*</span>
            </Label>
            <ImportanceSelect id="at-importance" value={importance} onChange={setImportance} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {t('assigned_tasks.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
