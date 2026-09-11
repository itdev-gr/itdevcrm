import { useTranslation } from 'react-i18next';
import type { DealClosePreview, JobBillingPreview } from './hooks/useBillingPreview';

/** Greek money formatting, matching endArchiveCopy's `eur()`: 450,00 € */
function eur(amount: number): string {
  return `${Number(amount).toFixed(2).replace('.', ',')} €`;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((line) => (
        <li key={line} className="flex gap-1.5">
          <span aria-hidden className="text-muted-foreground">
            •
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The consequence block shown inside a confirm dialog before a billing action.
 *
 * `preview === null` means the figures are not known yet (still loading, or the
 * caller lacks the accounting permission the RPC checks). In that case only the
 * unchanging explanation is shown — never a fabricated "0 invoices", which the
 * reader would take as a promise.
 */
export function PauseConsequences({
  preview,
  yearly,
}: {
  preview: JobBillingPreview | null;
  yearly: boolean;
}) {
  const { t } = useTranslation('deals');
  const lines: string[] = [];
  if (preview && preview.cancel_count > 0) {
    lines.push(
      t('jobs_billing.consequences.will_cancel', {
        count: preview.cancel_count,
        amount: eur(preview.cancel_gross),
      }),
    );
  }
  if (preview && preview.chain_jobs > 1) {
    lines.push(t('jobs_billing.consequences.chain', { count: preview.chain_jobs }));
  }
  lines.push(t('jobs_billing.consequences.no_new_periods'));
  lines.push(t('jobs_billing.consequences.no_backbill'));
  if (yearly) lines.push(t('jobs_billing.consequences.yearly_note'));
  return <List items={lines} />;
}

export function EndConsequences({
  preview,
  defersForDisconnect,
}: {
  preview: JobBillingPreview | null;
  defersForDisconnect: boolean;
}) {
  const { t } = useTranslation('deals');
  const lines: string[] = [t('jobs_billing.consequences.end_base')];
  if (preview && preview.cancel_count > 0) {
    lines.push(
      t('jobs_billing.consequences.will_cancel', {
        count: preview.cancel_count,
        amount: eur(preview.cancel_gross),
      }),
    );
  }
  // What stays owed after the recurring rows are cancelled — a one-time debt is
  // never written off by ending the service.
  const staysOwed = preview ? preview.unpaid_gross - preview.cancel_gross : 0;
  if (staysOwed > 0.004) {
    lines.push(t('jobs_billing.consequences.stays_owed', { amount: eur(staysOwed) }));
  }
  if (defersForDisconnect) lines.push(t('jobs_billing.consequences.disconnect_defer'));
  return <List items={lines} />;
}

export function ResumeConsequences({ preview }: { preview: JobBillingPreview | null }) {
  const { t } = useTranslation('deals');
  const lines: string[] = [t('jobs_billing.consequences.resume_fresh_period')];
  if (preview && preview.monthly_value > 0) {
    lines.push(
      t('jobs_billing.consequences.resume_amount', { amount: eur(preview.monthly_value) }),
    );
  }
  if (preview && preview.chain_jobs > 1) {
    lines.push(t('jobs_billing.consequences.chain', { count: preview.chain_jobs }));
  }
  return <List items={lines} />;
}

export function CloseDealConsequences({ preview }: { preview: DealClosePreview | null }) {
  const { t } = useTranslation('accounting');
  const lines: string[] = [];
  if (preview) {
    lines.push(t('close.consequences.jobs', { count: preview.jobs_to_close }));
    // The line the dialog was missing entirely: since 20260911160000 closing a
    // deal switches billing off on every service it touches.
    if (preview.services_billing_stopped > 0) {
      lines.push(
        preview.monthly_value_stopped > 0
          ? t('close.consequences.billing_stops_value', {
              count: preview.services_billing_stopped,
              amount: eur(preview.monthly_value_stopped),
            })
          : t('close.consequences.billing_stops', { count: preview.services_billing_stopped }),
      );
    }
    if (preview.open_payments_count > 0) {
      lines.push(
        t('close.consequences.open_payments', {
          count: preview.open_payments_count,
          amount: eur(preview.open_payments_gross),
        }),
      );
    }
  } else {
    lines.push(t('close.consequences.loading'));
  }
  return <List items={lines} />;
}
