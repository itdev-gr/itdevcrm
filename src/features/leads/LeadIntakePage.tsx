import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLeadIntake, type LeadIntakeRow, type LeadIntakeMatch } from './hooks/useLeadIntake';
import { useReleaseLeadIntake } from './hooks/useReleaseLeadIntake';
import { useDiscardLeadIntake } from './hooks/useDiscardLeadIntake';
import { useMergeLeadIntake } from './hooks/useMergeLeadIntake';
import { useAutoMerge } from './hooks/useAutoMerge';
import { useBulkMergePreview } from './hooks/useBulkMergePreview';
import { useBulkMergeIntake } from './hooks/useBulkMergeIntake';
import { useBulkReleasePreview } from './hooks/useBulkReleasePreview';
import { useBulkReleaseIntake } from './hooks/useBulkReleaseIntake';
import { leadMatchesOf, coldLeadMatchesOf } from './intakeMatches';
import { useDeadEndLeads } from './hooks/useDeadEndLeads';
import { useColdLeads } from './hooks/useColdLeads';
import { useReengageLeadIntake } from './hooks/useReengageLeadIntake';
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
  const merge = useMergeLeadIntake();
  const autoMerge = useAutoMerge();
  const [pickFor, setPickFor] = useState<string | null>(null);
  const bulkPreview = useBulkMergePreview();
  const bulkMerge = useBulkMergeIntake();
  const bulkReleasePreview = useBulkReleasePreview();
  const bulkRelease = useBulkReleaseIntake();
  const mergeableCount = bulkPreview.data?.mergeable ?? 0;
  const deadCount = bulkPreview.data?.dead_end ?? 0;
  const releasableCount = bulkReleasePreview.data?.releasable ?? 0;
  async function onBulkMerge() {
    if (mergeableCount === 0) return;
    if (!window.confirm(t('leads:intake.bulk_confirm', { count: mergeableCount, dead: deadCount }))) return;
    // The backlog can be large; the server processes a bounded batch per call (8s
    // statement timeout). Loop until nothing mergeable remains.
    let merged = 0;
    let dropped = 0;
    try {
      for (let i = 0; i < 200; i += 1) {
        const res = await bulkMerge.mutateAsync(undefined);
        merged += res.merged;
        dropped += res.dropped;
        if (res.remaining <= 0) break;
      }
      window.alert(t('leads:intake.bulk_done', { merged, dropped }));
    } catch (e) {
      window.alert((e as Error).message);
    }
  }
  async function onBulkRelease() {
    if (releasableCount === 0) return;
    if (!window.confirm(t('leads:intake.bulk_release_confirm', { count: releasableCount }))) return;
    let released = 0;
    try {
      for (let i = 0; i < 200; i += 1) {
        const res = await bulkRelease.mutateAsync(undefined);
        released += res.released;
        if (res.remaining <= 0) break;
      }
      window.alert(t('leads:intake.bulk_release_done', { released }));
    } catch (e) {
      window.alert((e as Error).message);
    }
  }
  const rows = data ?? [];
  const deadEndSet = useDeadEndLeads(
    rows.flatMap((r) =>
      leadMatchesOf((r.matches as unknown as LeadIntakeMatch[]) ?? []).map((m) => m.record_id),
    ),
  );
  const reengage = useReengageLeadIntake();
  const [reengageFor, setReengageFor] = useState<string | null>(null);
  const coldSet = useColdLeads(
    rows.flatMap((r) =>
      leadMatchesOf((r.matches as unknown as LeadIntakeMatch[]) ?? []).map((m) => m.record_id),
    ),
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('leads:intake.title')}</h1>
          <p className="text-sm opacity-70">{t('leads:intake.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={releasableCount === 0 || bulkRelease.isPending || bulkReleasePreview.isLoading}
            onClick={onBulkRelease}
          >
            {t('leads:intake.bulk_release', { count: releasableCount })}
          </button>
          <button
            type="button"
            className="rounded bg-sky-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={mergeableCount === 0 || bulkMerge.isPending || bulkPreview.isLoading}
            onClick={onBulkMerge}
          >
            {t('leads:intake.bulk_merge', { count: mergeableCount })}
          </button>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm opacity-90">
            <input
              type="checkbox"
              checked={autoMerge.autoEnabled}
              disabled={autoMerge.isLoading || autoMerge.setEnabled.isPending}
              onChange={(e) => autoMerge.setEnabled.mutate(e.target.checked)}
            />
            {t('leads:intake.auto_merge_label')}
          </label>
        </div>
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
            const leadMatches = leadMatchesOf(matches);
            const canMerge = leadMatches.length > 0;
            const coldMatches = r.source === 'meta' ? coldLeadMatchesOf(matches, coldSet) : [];
            function mergeInto(targetLeadId: string): boolean {
              if (deadEndSet.has(targetLeadId) && !window.confirm(t('leads:intake.merge_dead_end_confirm'))) {
                return false;
              }
              merge.mutate({ id: r.id, targetLeadId });
              return true;
            }
            function onMerge() {
              const only = leadMatches[0];
              if (leadMatches.length === 1 && only) {
                mergeInto(only.record_id);
              } else {
                setPickFor(r.id);
              }
            }
            function reengageInto(targetLeadId: string, name: string) {
              if (!window.confirm(t('leads:intake.reengage_confirm', { name }))) return;
              reengage.mutate({ id: r.id, targetLeadId });
            }
            function onRelease() {
              // Meta re-submission matching a cold lead → re-engage that lead
              // (move to Unique Lead + append) instead of creating a duplicate.
              if (coldMatches.length === 1 && coldMatches[0]) {
                reengageInto(coldMatches[0].record_id, coldMatches[0].display_name);
                return;
              }
              if (coldMatches.length > 1) {
                setReengageFor(r.id);
                return;
              }
              if (matches.length > 0) {
                if (!window.confirm(t('leads:intake.release_confirm_dup', { count: matches.length }))) return;
                release.mutate({ id: r.id, force: true });
              } else {
                release.mutate({ id: r.id, force: false });
              }
            }
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
                      className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={!canMerge || merge.isPending}
                      title={canMerge ? undefined : t('leads:intake.merge_disabled')}
                      onClick={onMerge}
                    >
                      {t('leads:intake.merge')}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={release.isPending}
                      onClick={onRelease}
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
                {pickFor === r.id && leadMatches.length > 1 ? (
                  <div className="mt-2 rounded border border-sky-300 bg-sky-50 p-2 text-sm dark:border-sky-900/50 dark:bg-sky-900/20">
                    <div className="mb-1 font-medium">{t('leads:intake.merge_pick')}</div>
                    <div className="flex flex-wrap gap-2">
                      {leadMatches.map((m) => {
                        const isDead = deadEndSet.has(m.record_id);
                        return (
                          <button
                            key={m.record_id}
                            type="button"
                            className={
                              'rounded border bg-card px-2 py-1 text-xs ' +
                              (isDead ? 'border-amber-400 text-amber-700 dark:text-amber-300' : '')
                            }
                            onClick={() => {
                              if (mergeInto(m.record_id)) setPickFor(null);
                            }}
                          >
                            {m.display_name}
                            {m.context ? ` (${m.context})` : ''}
                            {isDead ? ` ⚠ ${t('leads:intake.merge_dead_end_tag')}` : ''}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs underline"
                        onClick={() => setPickFor(null)}
                      >
                        {t('leads:intake.merge_cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {reengageFor === r.id && coldMatches.length > 1 ? (
                  <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
                    <div className="mb-1 font-medium">{t('leads:intake.reengage_pick')}</div>
                    <div className="flex flex-wrap gap-2">
                      {coldMatches.map((m) => (
                        <button
                          key={m.record_id}
                          type="button"
                          className="rounded border bg-card px-2 py-1 text-xs"
                          onClick={() => {
                            reengageInto(m.record_id, m.display_name);
                            setReengageFor(null);
                          }}
                        >
                          {m.display_name}
                          {m.context ? ` (${m.context})` : ''}
                        </button>
                      ))}
                      <button type="button" className="rounded px-2 py-1 text-xs underline" onClick={() => setReengageFor(null)}>
                        {t('leads:intake.merge_cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
