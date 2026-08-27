import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import type { LedgerRow } from '../hooks/useLedger';
import type { PLSummary } from '../hooks/usePLSummary';
import { downloadCSV, ledgerRowsToCSV } from '../utils/exportCSV';

export type ExportMenuProps = {
  rangeLabel: string;
  from: string;
  to: string;
  summary: PLSummary;
  incomeRows: LedgerRow[];
  expenseRows: LedgerRow[];
  includePendingExpenses?: boolean;
};

export function ExportMenu({
  from,
  to,
  incomeRows,
  expenseRows,
  includePendingExpenses = false,
}: ExportMenuProps) {
  const { t } = useTranslation('accounting_report');
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
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
  // Server-side PDF (api/report-pdf): complete paged data, Greek-capable
  // rendering, admin-gated — replaces the old client-side jsPDF export that
  // garbled Greek and capped at 40 rows per side (audit E28/E29).
  async function pdf() {
    setGenerating(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('no session');
      const params = new URLSearchParams({
        from,
        to,
        includePending: String(includePendingExpenses),
      });
      const resp = await fetch(`/api/report-pdf?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounting-report-${from}-to-${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      alert(t('export.pdf_failed', { message: (e as Error).message }));
    } finally {
      setGenerating(false);
    }
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
            disabled={generating}
            className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
            onClick={() => void pdf()}
          >
            {generating && <Loader2 className="size-3.5 animate-spin" />}
            {t('export.pdf')}
          </button>
        </div>
      )}
    </div>
  );
}
