import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Reuse, don't rewrite: this already parses .xlsx/.csv via SheetJS and
// already understands the Greek column headers (mapHeader) — writing a
// second parser here is explicitly out of scope.
import { parseLeadFile, type ImportedLeadRow } from '@/features/leads/leadImport';
import { chunkRows } from '../batching';
import {
  useCreateAudience,
  useAddAudienceMembers,
  type AudienceMemberRow,
  type ConsentBasis,
} from '../hooks/useAudiences';
import { useAttachAudience } from '../hooks/useCampaignMutations';

const CONSENT_OPTIONS: ConsentBasis[] = ['existing_customer', 'inquiry', 'public_b2b', 'purchased', 'other'];
// A giant single jsonb payload to audience_add_members would fail on a
// multi-thousand-row spreadsheet — batching also lets the dialog show
// progress instead of one long silent wait.
const BATCH_SIZE = 500;
const PREVIEW_ROWS = 10;

type ParsedFile = { fileName: string; rows: ImportedLeadRow[]; skipped: number; dropped: number };
type ImportReport = { added: number; invalid: number; duplicate: number };

type Props = {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportAudienceDialog({ campaignId, open, onOpenChange }: Props) {
  const { t } = useTranslation('email_marketing');
  const fileRef = useRef<HTMLInputElement>(null);
  const createAudience = useCreateAudience();
  const addMembers = useAddAudienceMembers();
  const attachAudience = useAttachAudience();

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [audienceName, setAudienceName] = useState('');
  const [consentBasis, setConsentBasis] = useState<ConsentBasis | ''>('');
  const [sourceNote, setSourceNote] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  function reset() {
    setParsed(null);
    setAudienceName('');
    setConsentBasis('');
    setSourceNote('');
    setParseError(null);
    setImportError(null);
    setImporting(false);
    setProgress(null);
    setReport(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setReport(null);
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const res = await parseLeadFile(file);
      if (res.rows.length === 0) {
        setParseError(t('builder.audience.import.parse_empty'));
        setParsed(null);
        return;
      }
      setParsed({ fileName: file.name, rows: res.rows, skipped: res.skipped, dropped: res.dropped });
      setAudienceName((prev) => prev || file.name.replace(/\.[^./\\]+$/, ''));
    } catch {
      setParseError(t('builder.audience.import.parse_error'));
      setParsed(null);
    }
  }

  function toMemberRow(row: ImportedLeadRow, index: number): AudienceMemberRow {
    return {
      email: row.email ?? '',
      name: row.full_name,
      company: row.company,
      extra: row.source_data,
      row: index + 1,
    };
  }

  async function doImport() {
    if (!parsed || !consentBasis || !audienceName.trim() || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const created = await createAudience.mutateAsync({
        name: audienceName.trim(),
        consentBasis,
        kind: 'import',
        sourceFile: parsed.fileName,
        sourceNote: sourceNote.trim() || null,
      });

      const batches = chunkRows(parsed.rows, BATCH_SIZE);
      // The report shown at the end is the TRUE server tally, summed across
      // batches — never the file's raw row count, which says nothing about
      // how many rows actually landed (invalid emails, duplicates, etc.).
      const totals: ImportReport = { added: 0, invalid: 0, duplicate: 0 };
      setProgress({ done: 0, total: batches.length });
      for (const [i, batch] of batches.entries()) {
        const result = await addMembers.mutateAsync({
          audienceId: created.audience_id,
          rows: batch.map(toMemberRow),
        });
        totals.added += result.added;
        totals.invalid += result.invalid;
        totals.duplicate += result.duplicate;
        setProgress({ done: i + 1, total: batches.length });
      }

      await attachAudience.mutateAsync({ campaignId, audienceId: created.audience_id });

      setReport(totals);
      setParsed(null);
    } catch (err) {
      setImportError((err as Error).message || t('builder.audience.import.import_failed'));
    } finally {
      setImporting(false);
    }
  }

  const canImport = !!parsed && !!consentBasis && audienceName.trim().length > 0 && !importing;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('builder.audience.import.title')}</DialogTitle>
          <DialogDescription>{t('builder.audience.import.description')}</DialogDescription>
        </DialogHeader>

        {report ? (
          <p className="text-sm">
            {t('builder.audience.import.report', {
              added: report.added,
              invalid: report.invalid,
              duplicate: report.duplicate,
            })}
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => void onFile(e)}
                disabled={importing}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
              >
                {parsed ? t('builder.audience.import.change_file') : t('builder.audience.import.choose_file')}
              </Button>
              {parsed ? <span className="ml-2 text-sm text-muted-foreground">{parsed.fileName}</span> : null}
            </div>

            {parseError ? <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p> : null}

            {parsed ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('builder.audience.import.found', { count: parsed.rows.length })}
                  {parsed.skipped > 0 ? ` ${t('builder.audience.import.skipped', { count: parsed.skipped })}` : ''}
                  {parsed.dropped > 0 ? ` ${t('builder.audience.import.dropped', { count: parsed.dropped })}` : ''}
                </p>

                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('builder.audience.import.preview_title')}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5">{t('builder.audience.import.col_name')}</th>
                          <th className="px-2 py-1.5">{t('builder.audience.import.col_email')}</th>
                          <th className="px-2 py-1.5">{t('builder.audience.import.col_phone')}</th>
                          <th className="px-2 py-1.5">{t('builder.audience.import.col_company')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                          <tr key={i} className="border-t border-border/40">
                            <td className="px-2 py-1.5">{row.full_name ?? '—'}</td>
                            <td className="px-2 py-1.5">{row.email ?? '—'}</td>
                            <td className="px-2 py-1.5">{row.phone ?? '—'}</td>
                            <td className="px-2 py-1.5">{row.company ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ia-name" className="text-xs">
                      {t('builder.audience.import.name_label')}
                    </Label>
                    <Input
                      id="ia-name"
                      className="mt-1 h-8 text-xs"
                      value={audienceName}
                      onChange={(e) => setAudienceName(e.target.value)}
                      disabled={importing}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('builder.audience.import.consent_label')}</Label>
                    <Select
                      value={consentBasis}
                      onValueChange={(v) => setConsentBasis(v as ConsentBasis)}
                      disabled={importing}
                    >
                      <SelectTrigger
                        className="mt-1 h-8 w-full text-xs"
                        aria-label={t('builder.audience.import.consent_label')}
                      >
                        <SelectValue placeholder={t('builder.audience.import.consent_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {CONSENT_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t(`builder.audience.consent_basis_options.${c}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ia-note" className="text-xs">
                      {t('builder.audience.import.note_label')}
                    </Label>
                    <Input
                      id="ia-note"
                      className="mt-1 h-8 text-xs"
                      value={sourceNote}
                      onChange={(e) => setSourceNote(e.target.value)}
                      disabled={importing}
                      placeholder={t('builder.audience.import.note_placeholder')}
                    />
                  </div>
                </div>

                {importing && progress ? (
                  <p className="text-xs text-muted-foreground">
                    {t('builder.audience.import.progress', { done: progress.done, total: progress.total })}
                  </p>
                ) : null}
                {importError ? <p className="text-sm text-red-600 dark:text-red-400">{importError}</p> : null}
              </>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {report ? (
            <Button onClick={() => handleOpenChange(false)}>{t('builder.audience.import.close')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={importing}>
                {t('builder.audience.import.cancel')}
              </Button>
              <Button onClick={() => void doImport()} disabled={!canImport}>
                {importing ? t('builder.audience.import.importing') : t('builder.audience.import.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
