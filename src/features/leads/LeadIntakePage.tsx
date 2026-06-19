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

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** One labelled field, rendered only when it has a value. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <span className="opacity-60">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

/** The existing lead/customer/queued row that this incoming lead duplicates. */
function DuplicateCard({ m, t }: { m: LeadIntakeMatch; t: (k: string) => string }) {
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
    <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
      <div>
        {m.matched_field === 'email' ? '📧' : '📞'}{' '}
        <Link to={to} className="font-medium underline">
          {m.display_name}
        </Link>{' '}
        <span className="opacity-70">
          · {kind}
          {m.context ? ` (${m.context})` : ''}
        </span>
      </div>
      <div className="opacity-90">
        {m.matched_email ? (
          <span className={m.matched_field === 'email' ? 'font-semibold' : ''}>
            ✉ {m.matched_email}
          </span>
        ) : null}
        {m.matched_email && m.matched_phone ? '  ·  ' : ''}
        {m.matched_phone ? (
          <span className={m.matched_field === 'phone' ? 'font-semibold' : ''}>
            ☎ {m.matched_phone}
          </span>
        ) : null}
      </div>
      <div className="opacity-70">
        {m.matched_field === 'email'
          ? t('leads:intake.matched_by_email')
          : t('leads:intake.matched_by_phone')}
      </div>
    </div>
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
                  <div className="min-w-[16rem] flex-1 space-y-1">
                    <div className="text-base font-medium">{fullName(r)}</div>
                    <Field label={t('leads:intake.f_email')} value={r.email} />
                    <Field label={t('leads:intake.f_phone')} value={r.phone} />
                    <Field label={t('leads:intake.f_company')} value={r.company_name} />
                    {r.website ? (
                      <div className="text-sm">
                        <span className="opacity-60">{t('leads:intake.f_website')}: </span>
                        <a
                          href={/^https?:\/\//.test(r.website) ? r.website : `https://${r.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {r.website}
                        </a>
                      </div>
                    ) : null}
                    <Field label={t('leads:intake.f_notes')} value={r.contact_info} />
                    {r.title && r.title !== r.company_name ? (
                      <Field label={t('leads:intake.f_form')} value={r.title} />
                    ) : null}
                    <div className="pt-0.5 text-xs opacity-60">
                      {t(`leads:intake.src_${r.source ?? 'meta'}`)} · {t('leads:intake.received')}:{' '}
                      {formatDate(r.created_at)}
                    </div>

                    <div className="space-y-1 pt-1">
                      {matches.length === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          ✓ {t('leads:intake.clean')}
                        </span>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            {t('leads:intake.dup_header')}
                          </div>
                          {matches.map((m, i) => (
                            <DuplicateCard key={`${m.record_id}-${i}`} m={m} t={t} />
                          ))}
                        </>
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
