import type { TFunction } from 'i18next';

/** RPC error codes the UD cadence functions return in {ok:false, error}. */
export const UD_ERROR_CODES = [
  'already_completed',
  'invalid_due',
  'invalid_outcome',
  'not_a_cadence_task',
  'no_live_run',
  'permission_denied',
  'pause_failed',
  'snooze_failed',
  'cadence_complete_failed',
  'lead_not_found',
  'not_current_task',
  'run_paused',
] as const;

/** Translate a raw cadence error (exact code match) or pass it through. */
export function udErrorMessage(t: TFunction, raw: string): string {
  return (UD_ERROR_CODES as readonly string[]).includes(raw) ? t(`ud.cadence.errors.${raw}`) : raw;
}
