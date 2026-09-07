import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Props = {
  /** Rows build_campaign_recipients actually queued (status='pending') — the
   *  real send target. */
  built: number;
  /** Rows it excluded instead (status='suppressed'), for any reason. */
  suppressed: number;
};

/** built → suppressed → final target, as a readable funnel. `built` here is
 *  ALREADY the final target the server will send to — see
 *  build_campaign_recipients's own return shape
 *  (supabase/migrations/20260907210000_campaign_recipients_build.sql) — so
 *  the "total candidates" tile is derived (built + suppressed), not a
 *  separate number the RPC returns. */
export function RecipientFunnel({ built, suppressed }: Props) {
  const { t, i18n } = useTranslation('email_marketing');
  const nf = new Intl.NumberFormat(i18n.language);
  const total = built + suppressed;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="recipient-funnel">
      <FunnelTile label={t('builder.review.funnel.total')} value={nf.format(total)} />
      <FunnelTile
        label={t('builder.review.funnel.suppressed')}
        value={nf.format(suppressed)}
        {...(suppressed > 0 ? { tone: 'warn' as const } : {})}
      />
      <FunnelTile label={t('builder.review.funnel.target')} value={nf.format(built)} tone="positive" />
    </div>
  );
}

function FunnelTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'positive';
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'warn' && 'text-amber-700 dark:text-amber-400',
          tone === 'positive' && 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {value}
      </div>
    </div>
  );
}
