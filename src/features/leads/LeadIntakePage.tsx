import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLeadIntake, type LeadIntakeRow, type LeadIntakeMatch } from './hooks/useLeadIntake';
import { useReleaseLeadIntake } from './hooks/useReleaseLeadIntake';
import { useDiscardLeadIntake } from './hooks/useDiscardLeadIntake';
import { LeadImportControls } from './LeadImportControls';

function fullName(r: LeadIntakeRow): string {
  const n = `${r.contact_first_name ?? ''} ${r.contact_last_name ?? ''}`.trim();
  return n || r.company_name || r.email || r.phone || '—';
}

function MatchBadge({ m, t }: { m: LeadIntakeMatch; t: (k: string) => string }) {
  const verb =
    m.matched_field === 'email' ? t('leads:intake.match_email') : t('leads:intake.match_phone');
  const kind =
    m.match_type === 'lead'
      ? t('leads:intake.match_lead')
      : m.match_type === 'deal_client'
        ? t('leads:intake.match_deal_client')
        : t('leads:intake.match_queued');
  const to =
    m.match_type === 'lead'
      ? `/leads/${m.record_id}`
      : m.match_type === 'deal_client'
        ? `/clients/${m.record_id}`
        : `/sales/lead-intake`;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      {m.matched_field === 'email' ? '📧' : '📞'} {verb} {kind}{' '}
      <Link to={to} className="font-medium underline">
        {m.display_name}
      </Link>
      {m.context ? <span className="opacity-70">({m.context})</span> : null}
    </span>
  );
}

export function LeadIntakePage() {
  const { t } = useTranslation();
  const { data, isLoading } = useLeadIntake();
  const release = useReleaseLeadIntake();
  const discard = useDiscardLeadIntake();
  const rows = data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">{t('leads:intake.title')}</h1>
        <p className="text-sm opacity-70">{t('leads:intake.subtitle')}</p>
      </div>

      <LeadImportControls />

      {isLoading ? (
        <p className="text-sm opacity-70">…</p>
      ) : rows.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
          {t('leads:intake.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const matches = (r.matches as unknown as LeadIntakeMatch[]) ?? [];
            return (
              <li key={r.id} className="rounded border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium">{fullName(r)}</div>
                    <div className="text-sm opacity-80">{r.email}</div>
                    <div className="text-sm opacity-80">{r.phone}</div>
                    {r.title ? <div className="text-xs opacity-60">{r.title}</div> : null}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {matches.length === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          ✓ {t('leads:intake.clean')}
                        </span>
                      ) : (
                        matches.map((m, i) => (
                          <MatchBadge key={`${m.record_id}-${i}`} m={m} t={t} />
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={release.isPending}
                      onClick={() => release.mutate(r.id)}
                    >
                      {t('leads:intake.release')}
                    </button>
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      disabled={discard.isPending}
                      onClick={() => {
                        if (window.confirm(t('leads:intake.confirm_discard'))) discard.mutate(r.id);
                      }}
                    >
                      {t('leads:intake.discard')}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
