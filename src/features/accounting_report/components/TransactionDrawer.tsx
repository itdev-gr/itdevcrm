import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type { LedgerRow } from '../hooks/useLedger';

export type TransactionDrawerProps = {
  open: boolean;
  title: string;
  rows: LedgerRow[];
  onClose: () => void;
  onSelectExpense?: (id: string) => void;
};

const STATUS_STYLES = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
} as const;

function sum(rows: LedgerRow[], field: 'amount_net' | 'vat_amount' | 'amount_gross') {
  return rows.reduce((total, row) => total + row[field], 0);
}

export function TransactionDrawer({
  open,
  title,
  rows,
  onClose,
  onSelectExpense,
}: TransactionDrawerProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';

  const totals = useMemo(
    () => ({
      net: sum(rows, 'amount_net'),
      vat: sum(rows, 'vat_amount'),
      gross: sum(rows, 'amount_gross'),
    }),
    [rows],
  );

  const isIncome = rows[0]?.direction === 'in';

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="shrink-0 border-b border-border/60 bg-card/95 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('transaction_drawer.count', { count: rows.length })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t('transaction_drawer.close')}
            >
              <X className="size-4" />
            </Button>
          </div>

          {rows.length > 0 ? (
            <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 bg-muted/20">
              {(['net', 'vat', 'gross'] as const).map((key) => (
                <div key={key} className="px-5 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`transaction_drawer.${key}`)}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 text-base font-semibold tabular-nums',
                      key === 'gross' && isIncome && 'text-emerald-700 dark:text-emerald-400',
                      key === 'gross' && !isIncome && 'text-red-700 dark:text-red-400',
                    )}
                  >
                    €{totals[key].toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t('transaction_drawer.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {rows.map((row) => {
                const clickable = row.source_table === 'expenses' && !!onSelectExpense;
                return (
                  <li key={`${row.source_table}-${row.source_id}`}>
                    <article
                      className={cn(
                        'px-5 py-4 transition-colors',
                        clickable && 'cursor-pointer hover:bg-muted/35',
                      )}
                      onClick={() => {
                        if (clickable) onSelectExpense!(row.source_id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-snug text-foreground">
                            {row.counterparty ?? '—'}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <time
                              dateTime={row.event_date}
                              className="whitespace-nowrap text-xs text-muted-foreground"
                            >
                              {formatDate(row.event_date, lang)}
                            </time>
                            <span className="inline-flex rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {t(`expense_form.${row.billing_type}`)}
                            </span>
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                                STATUS_STYLES[row.status],
                              )}
                            >
                              {t(`status.${row.status}`)}
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p
                            className={cn(
                              'text-base font-semibold tabular-nums',
                              isIncome
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400',
                            )}
                          >
                            €{row.amount_gross.toFixed(2)}
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {t('transaction_drawer.net')} €{row.amount_net.toFixed(2)} ·{' '}
                            {t('transaction_drawer.vat')} €{row.vat_amount.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
