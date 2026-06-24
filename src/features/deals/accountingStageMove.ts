/**
 * Classifies what an accounting-stage change should do, mirroring the Accounting
 * board's drag behaviour so the in-deal "Move to" dropdown acts identically:
 *  - 'noop'  → no target, or already on that stage
 *  - 'close' → the Closed stage (needs the close-confirmation dialog)
 *  - 'paid'  → the Paid In Full stage (spawn/unlock via accounting_mark_paid_in_full)
 *  - 'move'  → any other stage (plain stage move)
 */
export type AccountingStageAction = 'noop' | 'close' | 'paid' | 'move';

export function classifyAccountingStageMove(args: {
  targetStageId: string;
  currentStageId: string | null;
  paidStageId?: string | undefined;
  closedStageId?: string | undefined;
}): AccountingStageAction {
  const { targetStageId, currentStageId, paidStageId, closedStageId } = args;
  if (!targetStageId || targetStageId === currentStageId) return 'noop';
  if (closedStageId && targetStageId === closedStageId) return 'close';
  if (paidStageId && targetStageId === paidStageId) return 'paid';
  return 'move';
}
