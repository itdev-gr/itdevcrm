import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLeadFile, IMPORT_TEMPLATE_HEADERS, type ImportedLeadRow } from './leadImport';
import { useImportLeads } from './hooks/useImportLeads';

type Parsed = { rows: ImportedLeadRow[]; skipped: number; dropped: number; name: string };

export function LeadImportControls() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const importMut = useImportLeads();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStatus(null);
    setParsed(null);
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const res = await parseLeadFile(file);
      if (res.rows.length === 0) {
        setError(t('leads:intake.import_empty'));
        return;
      }
      setParsed({ ...res, name: file.name });
    } catch {
      setError(t('leads:intake.import_parse_error'));
    }
  }

  function downloadTemplate() {
    const csv = IMPORT_TEMPLATE_HEADERS.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lead-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function doImport() {
    if (!parsed) return;
    importMut.mutate(parsed.rows, {
      onSuccess: (r) => {
        setStatus(t('leads:intake.import_done', { imported: r.imported, flagged: r.flagged }));
        setParsed(null);
      },
      onError: () => setError(t('leads:intake.import_failed')),
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={onFile}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border px-3 py-1.5 text-sm font-medium"
        >
          {t('leads:intake.import_button')}
        </button>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-sm underline opacity-80"
        >
          {t('leads:intake.import_template')}
        </button>
      </div>

      {parsed && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
          <span>
            {t('leads:intake.import_found', { count: parsed.rows.length })}
            {parsed.skipped > 0 ? ` ${t('leads:intake.import_skipped', { count: parsed.skipped })}` : ''}
            {parsed.dropped > 0 ? ` ${t('leads:intake.import_dropped', { count: parsed.dropped })}` : ''}
          </span>
          <button
            type="button"
            onClick={doImport}
            disabled={importMut.isPending}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('leads:intake.import_confirm')}
          </button>
          <button
            type="button"
            onClick={() => setParsed(null)}
            className="rounded border px-3 py-1 text-xs font-medium"
          >
            {t('leads:intake.import_cancel')}
          </button>
        </div>
      )}

      {status && <p className="text-sm text-emerald-700 dark:text-emerald-300">{status}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
