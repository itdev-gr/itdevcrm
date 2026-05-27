import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useCreateAssignedTask } from './hooks/useCreateAssignedTask';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: { kind: 'deal' | 'job'; id: string };
};

export function NewAssignedTaskDialog({ open, onOpenChange, source }: Props) {
  const { t, i18n } = useTranslation('jobs');
  const locale: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const create = useCreateAssignedTask();
  const { data: owners = [] } = useAssignableOwners();
  const { data: groups = [] } = useGroups();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeUserId || !departmentId) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({
        source,
        title: title.trim(),
        description: description.trim() || null,
        assigneeUserId,
        departmentId,
      });
      setTitle('');
      setDescription('');
      setAssigneeUserId('');
      setDepartmentId(null);
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!title.trim() && !!assigneeUserId && !!departmentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assigned_tasks.new_task')}</DialogTitle>
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
              {t('assigned_tasks.department_label')} <span className="text-red-600">*</span>
            </span>
            <p className="text-[11px] text-slate-500">{t('assigned_tasks.department_hint')}</p>
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
                        ? 'border-amber-300 bg-amber-100 text-amber-900'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {g.display_names[locale]}
                  </button>
                );
              })}
            </div>
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
