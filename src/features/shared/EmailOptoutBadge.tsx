import { useTranslation } from 'react-i18next';
import { BellOff, MailWarning } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmailOptoutState = 'refused' | 'undeliverable' | null | undefined;

/**
 * The do-not-email indicator, shown on every lead and deal surface.
 *
 * Two states that mean very different things and must never be conflated:
 *   refused       — the person asked us to stop (unsubscribe, spam complaint,
 *                   or an admin added them by hand). A human decision.
 *   undeliverable — the address itself is dead (hard bounce / invalid). Nobody
 *                   refused anything; there is just nobody on the other end.
 * Today that is 4 refused vs 407 undeliverable leads, which is exactly why one
 * shared "opted out" pill would have been wrong.
 *
 * Pure presentation. The value is `leads.email_optout_state` /
 * `clients.email_optout_state`, maintained automatically from the suppression
 * list by database triggers — nothing in the UI can set it.
 */
export function EmailOptoutBadge({
  state,
  className,
}: {
  state: EmailOptoutState;
  className?: string;
}) {
  const { t } = useTranslation('leads');
  if (state !== 'refused' && state !== 'undeliverable') return null;

  const refused = state === 'refused';
  return (
    <span
      data-optout-state={state}
      title={refused ? t('optout.refused_hint') : t('optout.undeliverable_hint')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold',
        refused
          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
        className,
      )}
    >
      {refused ? <BellOff className="size-3" /> : <MailWarning className="size-3" />}
      {refused ? t('optout.refused') : t('optout.undeliverable')}
    </span>
  );
}
