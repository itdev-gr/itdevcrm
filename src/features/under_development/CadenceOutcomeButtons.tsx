import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, PhoneCall, PhoneOff, Send, ThumbsDown, MinusCircle } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useCompleteCadenceTask } from './hooks/useLeadCadence';
import { udErrorMessage } from './udErrors';

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

type NextStep = 'offer' | 'meeting' | 'not_interested' | 'none';

/**
 * The two cadence outcomes for an open chain task. Either opens a compact
 * dialog: an optional one-line note (lands on the timeline), and — after
 * «Μίλησα» — the next step so the whole conversation resolves in one place
 * (offer sent / meeting booked / not interested / just log it). Exhaustion
 * still suggests the chain's terminal stage via the final-move confirm.
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
  const qc = useQueryClient();
  const complete = useCompleteCadenceTask();
  const moveStage = useMoveLeadStage();
  const { data: stages = [] } = usePipelineStages();
  const [outcome, setOutcome] = useState<'reached' | 'no_answer' | null>(null);
  const [note, setNote] = useState('');
  const [nextStep, setNextStep] = useState<NextStep>('none');
  const [meetingAt, setMeetingAt] = useState('');
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const udStageId = (code: string) =>
    stages.find((s) => s.board === 'under_development' && s.code === code)?.id ?? null;

  function reset() {
    setOutcome(null);
    setNote('');
    setNextStep('none');
    setMeetingAt('');
  }

  async function onSubmit() {
    if (!outcome) return;
    try {
      const res = await complete.mutateAsync({
        taskId,
        outcome,
        note: note.trim() || undefined,
      });
      if (outcome === 'reached') {
        if (nextStep === 'offer') {
          const id = udStageId('ud_offer_sent');
          if (id) await moveStage.mutateAsync({ leadId, stageId: id });
        } else if (nextStep === 'not_interested') {
          const id = udStageId('ud_not_interested');
          if (id) await moveStage.mutateAsync({ leadId, stageId: id });
        } else if (nextStep === 'meeting' && meetingAt) {
          // The board-aware scheduled_for sync moves the lead to UD Scheduled.
          const { error } = await supabase
            .from('leads')
            .update({ scheduled_for: new Date(meetingAt).toISOString() })
            .eq('id', leadId);
          if (error) throw new Error(error.message);
          for (const key of [['leads'], ['lead'], ['lead-cadence'], ['sales-cadence']] as const) {
            void qc.invalidateQueries({ queryKey: [...key] });
          }
        }
      }
      reset();
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
      reset();
      const msg = (e as Error).message;
      alert(udErrorMessage(t, msg));
    }
  }

  const nextStepOptions: { key: NextStep; icon: React.ReactNode }[] = [
    { key: 'offer', icon: <Send className="size-3.5" /> },
    { key: 'meeting', icon: <CalendarClock className="size-3.5" /> },
    { key: 'not_interested', icon: <ThumbsDown className="size-3.5" /> },
    { key: 'none', icon: <MinusCircle className="size-3.5" /> },
  ];

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size={size}
          variant="outline"
          className="border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
          onClick={() => setOutcome('reached')}
        >
          <PhoneCall className="size-3.5" />
          {t('ud.cadence.outcome_reached')}
        </Button>
        <Button
          type="button"
          size={size}
          variant="outline"
          className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          onClick={() => setOutcome('no_answer')}
        >
          <PhoneOff className="size-3.5" />
          {t('ud.cadence.outcome_no_answer')}
        </Button>
      </div>

      <Dialog
        open={outcome != null}
        onOpenChange={(o) => {
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {outcome === 'reached'
                ? t('ud.cadence.outcome_reached')
                : t('ud.cadence.outcome_no_answer')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('ud.cadence.dialog_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {outcome === 'reached' && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {t('ud.cadence.next_step.title')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {nextStepOptions.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setNextStep(o.key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                        nextStep === o.key
                          ? 'border-[#1a9696]/60 bg-[#1a9696]/10 font-semibold'
                          : 'border-border/60 hover:bg-muted/60',
                      )}
                    >
                      {o.icon}
                      {t(`ud.cadence.next_step.${o.key}`)}
                    </button>
                  ))}
                </div>
                {nextStep === 'meeting' && (
                  <Input
                    type="datetime-local"
                    value={meetingAt}
                    onChange={(e) => setMeetingAt(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>
            )}
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('ud.cadence.note_placeholder')}
              rows={2}
              autoFocus={outcome === 'no_answer'}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={reset}>
              {t('ud.cadence.cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                complete.isPending ||
                moveStage.isPending ||
                (outcome === 'reached' && nextStep === 'meeting' && !meetingAt)
              }
              onClick={() => void onSubmit()}
            >
              {t('ud.cadence.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
