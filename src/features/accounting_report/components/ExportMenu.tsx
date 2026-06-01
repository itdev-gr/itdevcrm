import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
      <button
        type="button"
        className="rounded border px-3 py-1.5 text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        {t('export.menu')}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded border bg-white shadow">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100"
            onClick={csv}
          >
            {t('export.csv')}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100"
            onClick={pdf}
          >
            {t('export.pdf')}
          </button>
        </div>
      )}
    </div>
  );
}
