import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { useCloseDeal } from './hooks/useCloseDeal';

type Props = {
  dealId: string | null;
  dealLabel?: string;
  onClose: () => void;
};

export function CloseDealDialog({ dealId, dealLabel, onClose }: Props) {
  const { t } = useTranslation('accounting');
  const { t: tDeals } = useTranslation('deals');
  const open = !!dealId;

  const { data: jobs = [], isLoading } = useJobsForDeal(dealId ?? '');
  const close = useCloseDeal();
  const activeJobs = useMemo(() => jobs.filter((j) => !j.archived), [jobs]);

  function labelFor(j: (typeof activeJobs)[number]): string {
    if (j.title) return j.title;
    return tDeals(`services.types.${j.service_type}`, { defaultValue: j.service_type });
  }

  function onConfirm() {
    if (!dealId) return;
    // Backend trigger moves every job to its board's Closed lane; no per-job payload needed.
    close.mutate(
      { dealId, jobs: [] },
      { onSuccess: onClose, onError: (e) => alert((e as Error).message) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('close.title')}
            {dealLabel ? ` · ${dealLabel}` : ''}
          </DialogTitle>
          <DialogDescription>{t('close.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-muted-foreground">…</p>
          ) : activeJobs.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">{t('close.no_jobs')}</p>
          ) : (
            activeJobs.map((j) => (
              <div key={j.id} className="rounded-md border px-3 py-2 text-sm">
                {labelFor(j)}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={close.isPending}>
            {t('close.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={close.isPending}>
            {close.isPending ? t('close.closing') : t('close.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
