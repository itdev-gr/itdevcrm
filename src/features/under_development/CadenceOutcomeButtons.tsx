import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useCompleteCadenceTask } from './hooks/useLeadCadence';

/** The «move to Not Found / Not Interested?» confirmation a finished chain
 *  offers. Hosted by whoever stays MOUNTED after the task closes — the outcome
 *  buttons themselves may unmount when the completed task leaves the DOM. */
export function CadenceFinalMoveDialog({
  leadId,
  stageId,
  onClose,
}: {
  leadId: string;
  stageId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const moveStage = useMoveLeadStage();
  const { data: stages = [] } = usePipelineStages();
  const targetStage = stageId ? stages.find((s) => s.id === stageId) : undefined;
  const targetLabel = targetStage
    ? (targetStage.display_names as { en: string; el: string })[lang]
    : '';

  return (
    <ConfirmDialog
      open={stageId != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('ud.cadence.exhausted_title')}
      description={t('ud.cadence.exhausted_body', { stage: targetLabel })}
      confirmLabel={t('ud.cadence.exhausted_cta', { stage: targetLabel })}
      onConfirm={async () => {
        if (stageId) await moveStage.mutateAsync({ leadId, stageId });
        onClose();
      }}
      pending={moveStage.isPending}
    />
  );
}

/**
 * The two cadence outcomes for an open chain task. On chain exhaustion the
 * engine suggests the terminal stage and the rep confirms or declines the
 * move — per spec, the user has the final say. When this component may
 * unmount on task completion (e.g. inside the cadence box, whose open-task
 * row disappears), the host passes `onExhausted` and renders
 * CadenceFinalMoveDialog itself; without it the dialog is hosted here.
 */
export function CadenceOutcomeButtons({
  taskId,
  leadId,
  size = 'sm',
  onDone,
  onExhausted,
}: {
  taskId: string;
  leadId: string;
  size?: 'sm' | 'default';
  onDone?: (() => void) | undefined;
  onExhausted?: ((stageId: string) => void) | undefined;
}) {
  const { t } = useTranslation('sales');
  const complete = useCompleteCadenceTask();
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  async function onOutcome(outcome: 'reached' | 'no_answer') {
    try {
      const res = await complete.mutateAsync({ taskId, outcome });
      if (res.result === 'exhausted' && res.final_move_stage_id) {
        if (onExhausted) {
          onExhausted(res.final_move_stage_id);
          onDone?.();
        } else {
          setMoveTarget(res.final_move_stage_id);
        }
      } else {
        onDone?.();
      }
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size={size}
          variant="outline"
          className="border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
          disabled={complete.isPending}
          onClick={() => void onOutcome('reached')}
        >
          <PhoneCall className="size-3.5" />
          {t('ud.cadence.outcome_reached')}
        </Button>
        <Button
          type="button"
          size={size}
          variant="outline"
          className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          disabled={complete.isPending}
          onClick={() => void onOutcome('no_answer')}
        >
          <PhoneOff className="size-3.5" />
          {t('ud.cadence.outcome_no_answer')}
        </Button>
      </div>
      {!onExhausted && (
        <CadenceFinalMoveDialog
          leadId={leadId}
          stageId={moveTarget}
          onClose={() => {
            setMoveTarget(null);
            onDone?.();
          }}
        />
      )}
    </>
  );
}
