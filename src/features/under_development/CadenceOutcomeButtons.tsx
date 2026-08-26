import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useCompleteCadenceTask } from './hooks/useLeadCadence';

/**
 * The two cadence outcomes for an open chain task. On chain exhaustion the
 * engine suggests the terminal stage (Not Found / Not Interested) and the rep
 * confirms or declines the move — per spec, the user has the final say.
 */
export function CadenceOutcomeButtons({
  taskId,
  leadId,
  size = 'sm',
  onDone,
}: {
  taskId: string;
  leadId: string;
  size?: 'sm' | 'default';
  onDone?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const complete = useCompleteCadenceTask();
  const moveStage = useMoveLeadStage();
  const { data: stages = [] } = usePipelineStages();
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const targetStage = moveTarget ? stages.find((s) => s.id === moveTarget) : undefined;
  const targetLabel = targetStage
    ? (targetStage.display_names as { en: string; el: string })[lang]
    : '';

  async function onOutcome(outcome: 'reached' | 'no_answer') {
    try {
      const res = await complete.mutateAsync({ taskId, outcome });
      if (res.result === 'exhausted' && res.final_move_stage_id) {
        setMoveTarget(res.final_move_stage_id);
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
      <ConfirmDialog
        open={moveTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setMoveTarget(null);
            onDone?.();
          }
        }}
        title={t('ud.cadence.exhausted_title')}
        description={t('ud.cadence.exhausted_body', { stage: targetLabel })}
        confirmLabel={t('ud.cadence.exhausted_cta', { stage: targetLabel })}
        onConfirm={async () => {
          if (moveTarget) await moveStage.mutateAsync({ leadId, stageId: moveTarget });
          setMoveTarget(null);
          onDone?.();
        }}
        pending={moveStage.isPending}
      />
    </>
  );
}
