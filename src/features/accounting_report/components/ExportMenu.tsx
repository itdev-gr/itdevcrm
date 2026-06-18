import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LedgerRow } from '../hooks/useLedger';
import type { PLSummary } from '../hooks/usePLSummary';
import { downloadCSV, ledgerRowsToCSV } from '../utils/exportCSV';
import { downloadPDF } from '../utils/exportPDF';

export type ExportMenuProps = {
  rangeLabel: string;
  from: string;
  to: string;
  summary: PLSummary;
  incomeRows: LedgerRow[];
  expenseRows: LedgerRow[];
};

export function ExportMenu({ rangeLabel, from, to, summary, incomeRows, expenseRows }: ExportMenuProps) {
  const { t } = useTranslation('accounting_report');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  function csv() {
    const all = [...incomeRows, ...expenseRows];
    downloadCSV(`accounting-${from}-to-${to}.csv`, ledgerRowsToCSV(all));
    setOpen(false);
  }
  function pdf() {
    downloadPDF(`accounting-${from}-to-${to}.pdf`, { rangeLabel, summary, incomeRows, expenseRows });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative inline-block">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Download className="size-3.5" />
        {t('export.menu')}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
            onClick={csv}
          >
            {t('export.csv')}
          </button>
          <button
            type="button"
            className="block w-full border-t border-border/60 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
            onClick={pdf}
          >
            {t('export.pdf')}
          </button>
        </div>
      )}
    </div>
  );
}
