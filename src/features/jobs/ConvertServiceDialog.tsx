import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { convertibleTargets } from './serviceConversion';
import { useConvertJobService } from './hooks/useConvertJobService';

type ConvertJob = {
  id: string;
  service_type: string;
  parent_job_id: string | null;
  hasChildren?: boolean;
  billing_only?: boolean | null;
};

/**
 * Admin/accounting dialog that converts a standalone job between same-cadence
 * service types via the `convert_job_service_type` RPC. Amounts/payments are
 * preserved server-side; the board, owner, monthly tasks, code and info fields
 * are realigned. Shows a "cannot convert" note when the job has no valid
 * targets (AI SEO / web dev / special services / parent or child jobs).
 */
export function ConvertServiceDialog({
  job,
  open,
  onOpenChange,
}: {
  job: ConvertJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('jobs');
  const targets = convertibleTargets(job);
  const [target, setTarget] = useState(targets[0] ?? '');
  const convert = useConvertJobService();

  const label = (s: string) => t(`deals:services.types.${s}`, { defaultValue: s });
  const warningKey =
    job.service_type === 'ai_seo'
      ? 'convert.warning_ai_down'
      : target === 'ai_seo'
        ? 'convert.warning_ai_up'
        : 'convert.warning';

  function onConfirm() {
    if (!target) return;
    convert.mutate(
      { jobId: job.id, target },
      {
        onSuccess: () => {
          onOpenChange(false);
          window.alert(t('convert.success'));
        },
        onError: (e) =>
          window.alert(t('convert.error', { msg: e instanceof Error ? e.message : String(e) })),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('convert.title')}</DialogTitle>
        </DialogHeader>
        {targets.length === 0 ? (
          <DialogDescription>{t('convert.none')}</DialogDescription>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] text-muted-foreground">{t('convert.target')}</Label>
              <Select value={target} onValueChange={setTarget} disabled={convert.isPending}>
                <SelectTrigger className="mt-0.5 h-8 text-sm" aria-label={t('convert.target')}>
                  {label(target)}
                </SelectTrigger>
                <SelectContent>
                  {targets.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogDescription>{t(warningKey)}</DialogDescription>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </Button>
          </DialogClose>
          {targets.length > 0 && (
            <Button type="button" onClick={onConfirm} disabled={convert.isPending || !target}>
              {t('convert.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
