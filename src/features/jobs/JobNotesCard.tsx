import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateJobBilling } from '@/features/deals/hooks/useCustomJobMutations';
import { useJob } from './hooks/useJob';

type Props = {
  jobId: string;
  dealId: string;
  description: string | null;
  parentJobId: string | null;
};

export function JobNotesCard({ jobId, dealId, description, parentJobId }: Props) {
  const { t } = useTranslation('deals');
  const update = useUpdateJobBilling(dealId);
  const { data: parentJob } = useJob(parentJobId ?? '');
  const parentNote = parentJob?.description?.trim() || null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');

  function startEdit() {
    setDraft(description ?? '');
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(description ?? '');
  }
  async function save() {
    const next = draft.trim() === '' ? null : draft;
    try {
      await update.mutateAsync({ jobId, description: next });
      setEditing(false);
    } catch (err) {
      const code =
        (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      alert(code);
    }
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('jobs_billing.notes_card.title')}
      </h2>

      {parentNote && (
        <div className="mb-3 rounded-md border border-border/50 bg-muted/40 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('jobs_billing.notes_card.parent_title')}
          </div>
          <p className="whitespace-pre-wrap text-xs text-foreground">{parentNote}</p>
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={update.isPending}>
              {t('jobs_billing.notes_card.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} disabled={update.isPending}>
              {t('jobs_billing.notes_card.cancel')}
            </Button>
          </div>
        </div>
      ) : description ? (
        <button
          type="button"
          onClick={startEdit}
          className="block w-full text-left"
          aria-label={t('jobs_billing.notes_card.title')}
        >
          <p
            data-testid="job-notes-body"
            className="whitespace-pre-wrap text-sm text-foreground"
          >
            {description}
          </p>
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t('jobs_billing.notes_card.empty')}
          </span>
          <Button size="sm" variant="outline" onClick={startEdit}>
            {t('jobs_billing.notes_card.add_button')}
          </Button>
        </div>
      )}
    </section>
  );
}
