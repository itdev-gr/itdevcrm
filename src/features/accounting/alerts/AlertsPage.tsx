import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  alertLink,
  alertLinkLabel,
  groupAlertsBySubject,
  severityClass,
  severityLabel,
  type AlertRow,
} from './alertPresenters';
import { useIntegrityAlerts } from './hooks/useIntegrityAlerts';
import {
  useDismissAlert,
  useDismissedAlerts,
  useUndismissAlert,
} from './hooks/useAlertDismissals';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';

const CATEGORY_LABEL: Record<AlertRow['category'], string> = {
  money: 'Money',
  lifecycle: 'Lifecycle',
  missing: 'Missing info',
  possible_mistakes: 'Possible mistakes',
};

type Tab = 'open' | 'ignored';

export default function AccountingAlertsPage() {
  const { t } = useTranslation('accounting');
  const [tab, setTab] = useState<Tab>('open');

  const { data: alerts, isLoading } = useIntegrityAlerts();
  const dismissed = useDismissedAlerts();
  const dismiss = useDismissAlert();
  const undismiss = useUndismissAlert();

  const groups = groupAlertsBySubject(alerts);
  const openCount = alerts.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{t('accounting:nav.alerts', { defaultValue: 'Alerts' })}</h1>
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {openCount}
        </span>
      </header>

      <div className="flex items-center gap-1.5">
        {(['open', 'ignored'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors',
              tab === key
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/40',
            )}
          >
            {key === 'open'
              ? t('accounting:alerts.tab_open', { defaultValue: 'Open' })
              : t('accounting:alerts.tab_ignored', { defaultValue: 'Ignored' })}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'open' ? (
          isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
          ) : groups.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {t('accounting:alerts.empty', { defaultValue: 'No alerts 🎉' })}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const anchor = group.rows.find((r) => r.deal_id) ?? group.rows[0]!;
                const link = alertLink(anchor);
                return (
                  <section
                    key={group.code}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{group.code}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.rows.length} {group.rows.length === 1 ? 'issue' : 'issues'}
                      </span>
                      {link && (
                        <Button asChild variant="outline" size="sm" className="ml-auto">
                          <Link to={link}>{alertLinkLabel(anchor)}</Link>
                        </Button>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {group.rows.map((row) => (
                        <li
                          key={`${row.check_key}:${row.subject_id}:${row.signature}`}
                          className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/40 p-2"
                        >
                          <span
                            className={cn(
                              'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
                              severityClass(row.severity),
                            )}
                          >
                            {severityLabel(row.severity)}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {CATEGORY_LABEL[row.category]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              {row.subject_code !== group.code && (
                                <span className="font-mono text-xs text-muted-foreground">
                                  {row.subject_code}
                                </span>
                              )}
                              <span className="font-semibold">{row.title}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">{row.detail}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() =>
                              dismiss.mutate({
                                check_key: row.check_key,
                                subject_id: row.subject_id,
                                signature: row.signature,
                              })
                            }
                          >
                            {t('accounting:alerts.ignore', { defaultValue: 'Ignore' })}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )
        ) : dismissed.isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
        ) : dismissed.data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t('accounting:alerts.no_ignored', { defaultValue: 'Nothing ignored' })}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {dismissed.data.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{row.check_key}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.subject_id.slice(0, 8)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(row.dismissed_at)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => undismiss.mutate(row.id)}
                >
                  {t('accounting:alerts.unignore', { defaultValue: 'Un-ignore' })}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
