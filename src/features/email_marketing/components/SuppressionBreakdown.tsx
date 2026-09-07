import { useTranslation } from 'react-i18next';

// The exact six reasons build_campaign_recipients can write
// (supabase/migrations/20260907210000_campaign_recipients_build.sql,
// `classified` CTE) — same order as its own priority ladder (most
// fundamental problem first, most transient last), so the breakdown reads
// top-to-bottom the way the server reasons about it.
const KNOWN_REASONS = [
  'invalid',
  'suppressed_list',
  'opted_out',
  'closed_client',
  'internal',
  'fatigue',
] as const;
type KnownReason = (typeof KNOWN_REASONS)[number];

function isKnownReason(reason: string): reason is KnownReason {
  return (KNOWN_REASONS as readonly string[]).includes(reason);
}

type Props = {
  /** suppression_reason → count. Any key outside KNOWN_REASONS still renders
   *  — a reason the server started returning that this UI doesn't know about
   *  yet must never silently vanish from what the owner sees before he sends. */
  byReason: Record<string, number>;
};

export function SuppressionBreakdown({ byReason }: Props) {
  const { t, i18n } = useTranslation('email_marketing');
  const nf = new Intl.NumberFormat(i18n.language);

  const present = Object.entries(byReason).filter(([, count]) => count > 0);
  const known = KNOWN_REASONS.filter((r) => (byReason[r] ?? 0) > 0).map((r) => [r, byReason[r]!] as const);
  const unknown = present.filter(([reason]) => !isKnownReason(reason));
  const ordered = [...known, ...unknown];

  if (ordered.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{t('builder.review.suppression.empty')}</p>;
  }

  return (
    <ul className="mt-2 divide-y divide-border/40" data-testid="suppression-breakdown">
      {ordered.map(([reason, count]) => (
        <li key={reason} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-muted-foreground">
            {isKnownReason(reason)
              ? t(`builder.review.suppression.reasons.${reason}`)
              : t('builder.review.suppression.reasons_unknown', { reason })}
          </span>
          <span className="font-medium tabular-nums">{nf.format(count)}</span>
        </li>
      ))}
    </ul>
  );
}
