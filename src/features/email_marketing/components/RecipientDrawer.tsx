import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import {
  useCampaignRecipients,
  fetchAllCampaignRecipients,
  CAMPAIGN_RECIPIENTS_PAGE_SIZE,
  type CampaignRecipientRow,
  type CampaignRecipientStatus,
} from '../hooks/useCampaigns';

export type RecipientDrawerProps = {
  open: boolean;
  campaignId: string;
  campaignName: string;
  onClose: () => void;
};

type FilterValue = CampaignRecipientStatus | 'all';

const STATUS_FILTERS: FilterValue[] = ['all', 'pending', 'sending', 'sent', 'failed', 'suppressed'];

const RECIPIENT_STATUS_STYLES: Record<CampaignRecipientStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  sending: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  suppressed: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
};

// Same column set / escaping idiom as accounting_report's exportCSV.ts
// (ledgerRowsToCSV/downloadCSV) — kept local rather than shared since this is
// a different row shape and the two features stay independent.
const CSV_COLUMNS = [
  'email_lower',
  'display_name',
  'company',
  'status',
  'suppression_reason',
  'error',
  'queued_at',
  'sent_at',
  'delivered_at',
  'bounced_at',
  'complained_at',
  'unsubscribed_at',
] as const;

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function recipientRowsToCSV(rows: CampaignRecipientRow[]): string {
  const head = CSV_COLUMNS.join(',');
  const body = rows
    .map((r) => CSV_COLUMNS.map((c) => escapeCSV((r as unknown as Record<string, unknown>)[c])).join(','))
    .join('\n');
  return `${head}\n${body}\n`;
}

export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Recipient list drawer for one campaign — modeled on
 *  accounting_report/components/TransactionDrawer.tsx for the look (a
 *  right-hand slide-over) and the CSV export idiom (exportCSV.ts), filterable
 *  by `email_campaign_recipients.status` via Task 1's `useCampaignRecipients`. */
export function RecipientDrawer({ open, campaignId, campaignName, onClose }: RecipientDrawerProps) {
  const { t } = useTranslation('email_marketing');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [page, setPage] = useState(0);
  const { data, isLoading } = useCampaignRecipients(campaignId, filter === 'all' ? undefined : filter, page);
  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const from = count === 0 ? 0 : page * CAMPAIGN_RECIPIENTS_PAGE_SIZE + 1;
  const to = Math.min(count, page * CAMPAIGN_RECIPIENTS_PAGE_SIZE + rows.length);
  const hasNext = to < count;
  const hasPrev = page > 0;

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset the filter/page each time the drawer is (re)opened, so a stale
  // "failed"-only view (or a page 6 the owner scrolled to last time) from a
  // previous session doesn't quietly persist.
  useEffect(() => {
    if (open) {
      setFilter('all');
      setPage(0);
    }
  }, [open]);

  // A new status filter invalidates whatever page we were on.
  useEffect(() => {
    setPage(0);
  }, [filter]);

  if (!open) return null;

  // Fix-pass, Critical-1: the CSV export is the record of exactly who was
  // mailed, so it must never silently contain fewer rows than the drawer's
  // own total — draining every page here, NOT exporting `rows` (the one
  // page currently on screen). A multi-thousand-row drain takes real time,
  // so this shows progress rather than leaving the button looking frozen.
  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportProgress({ done: 0, total: count });
    try {
      const all = await fetchAllCampaignRecipients(campaignId, filter === 'all' ? undefined : filter, (done, total) =>
        setExportProgress({ done, total }),
      );
      downloadCSV(`campaign-${campaignId}-recipients-${filter}.csv`, recipientRowsToCSV(all));
    } catch {
      setExportError(t('detail.recipients.export_failed'));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('detail.recipients.drawer_title')}
      >
        <div className="shrink-0 border-b border-border/60 bg-card/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold tracking-tight">
                {t('detail.recipients.drawer_title')}
              </h3>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{campaignName}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={count === 0 || exporting}
              >
                <Download className="mr-1.5 size-3.5" />
                {exporting && exportProgress
                  ? t('detail.recipients.exporting', { done: exportProgress.done, total: exportProgress.total })
                  : t('detail.recipients.export_csv')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label={t('detail.recipients.close')}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <SegmentedControl
              value={filter}
              onChange={(v) => setFilter(v as FilterValue)}
              options={STATUS_FILTERS.map((f) => ({ value: f, label: t(`detail.recipients.status_filter.${f}`) }))}
            />
          </div>
          {exportError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{exportError}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">{t('detail.recipients.count', { count })}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t('detail.recipients.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t('detail.recipients.empty')}</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {rows.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium leading-snug text-foreground">
                        {row.display_name || row.email_lower}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{row.email_lower}</p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        RECIPIENT_STATUS_STYLES[row.status],
                      )}
                    >
                      {t(`detail.recipients.status_filter.${row.status}`)}
                    </span>
                  </div>
                  {row.status === 'failed' && row.error ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{row.error}</p>
                  ) : null}
                  {row.status === 'suppressed' && row.suppression_reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('detail.recipients.suppressed_because', {
                        reason: t(`builder.review.suppression.reasons.${row.suppression_reason}`, {
                          defaultValue: row.suppression_reason,
                        }),
                      })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border/60 bg-card/95 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {count === 0
                ? t('detail.recipients.pagination.empty')
                : t('detail.recipients.pagination.range', { from, to, count })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t('detail.recipients.pagination.prev')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                {t('detail.recipients.pagination.next')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
