import { useEffect, useMemo, useState } from 'react';
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
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useCloseDeal } from './hooks/useCloseDeal';
import { buildCloseJobs, type WebDevChoice } from './closeTargets';

type Props = {
  dealId: string | null;
  dealLabel?: string;
  onClose: () => void;
};

export function CloseDealDialog({ dealId, dealLabel, onClose }: Props) {
  const { t, i18n } = useTranslation('accounting');
  const { t: tDeals } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const open = !!dealId;

  const { data: jobs = [], isLoading } = useJobsForDeal(dealId ?? '');
  const { data: stages = [] } = usePipelineStages();
  const close = useCloseDeal();

  const activeJobs = useMemo(() => jobs.filter((j) => !j.archived), [jobs]);
  const idsKey = activeJobs.map((j) => j.id).join(',');

  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [webDev, setWebDev] = useState<Record<string, WebDevChoice>>({});

  // (Re)seed the per-job UI whenever the dialog opens for a new set of jobs.
  useEffect(() => {
    if (!open) return;
    setInclude(Object.fromEntries(activeJobs.map((j) => [j.id, true])));
    setWebDev(
      Object.fromEntries(
        activeJobs.filter((j) => j.stage?.board === 'web_dev').map((j) => [j.id, 'closed']),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  function labelFor(j: (typeof activeJobs)[number]): string {
    if (j.title) return j.title;
    return tDeals(`services.types.${j.service_type}`, { defaultValue: j.service_type });
  }
  function stageLabel(j: (typeof activeJobs)[number]): string {
    const dn = j.stage?.display_names as { en?: string; el?: string } | undefined;
    return dn?.[lang] ?? j.stage?.code ?? '';
  }

  function onConfirm() {
    if (!dealId) return;
    const payload = buildCloseJobs(activeJobs, include, webDev, stages);
    close.mutate(
      { dealId, jobs: payload },
      {
        onSuccess: onClose,
        onError: (e) => alert((e as Error).message),
      },
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

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-muted-foreground">…</p>
          ) : activeJobs.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">{t('close.no_jobs')}</p>
          ) : (
            activeJobs.map((j) => (
              <div key={j.id} className="rounded-md border p-2">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={include[j.id] ?? true}
                    onChange={(e) =>
                      setInclude((prev) => ({ ...prev, [j.id]: e.target.checked }))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{labelFor(j)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {stageLabel(j)} · {t(`close.status.${j.status}`, { defaultValue: j.status })}
                    </span>
                  </span>
                </label>
                {j.stage?.board === 'web_dev' && (include[j.id] ?? true) && (
                  <div className="mt-2 flex items-center gap-3 pl-6 text-xs">
                    <span className="text-muted-foreground">{t('close.website_to')}:</span>
                    {(['closed', 'live'] as WebDevChoice[]).map((choice) => (
                      <label key={choice} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`webdev-${j.id}`}
                          checked={(webDev[j.id] ?? 'closed') === choice}
                          onChange={() => setWebDev((prev) => ({ ...prev, [j.id]: choice }))}
                        />
                        {t(`close.webdev_choice.${choice}`)}
                      </label>
                    ))}
                  </div>
                )}
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
