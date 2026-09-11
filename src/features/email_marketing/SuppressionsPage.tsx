import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FilterBar,
  FilterSelect,
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTheadClass,
  settingsThClass,
  settingsTrClass,
  settingsTdClass,
} from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import {
  useSuppressions,
  useUnsuppressEmail,
  useAdminSuppressEmail,
  SUPPRESSIONS_PAGE_SIZE,
  type SuppressionReason,
  type SuppressionRow,
  type SuppressionStream,
} from './hooks/useSuppressions';
import { useAuthStore } from '@/lib/stores/authStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const SEARCH_DEBOUNCE_MS = 300;

const REASONS: SuppressionReason[] = ['hard_bounce', 'soft_bounce', 'complaint', 'manual', 'invalid', 'unsubscribed'];
const STREAMS: SuppressionStream[] = ['marketing', 'sales', 'manual'];

function reasonLabel(reason: string, t: TFunction<'email_marketing'>): string {
  // Every known reason has a translation; anything else (a value this UI
  // doesn't yet know about) still renders — as the raw code inside an
  // explicit "unknown reason" sentence, never a blank cell.
  return t(`suppressions.reasons.${reason}`, {
    defaultValue: t('suppressions.reason_unknown', { reason }),
  });
}

export function SuppressionsPage() {
  const { t, i18n } = useTranslation('email_marketing');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<SuppressionReason | ''>('');
  const [stream, setStream] = useState<SuppressionStream | ''>('');
  const [page, setPage] = useState(0);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  // Server-side search, debounced — never filters a fully-loaded array (the
  // list is ~450 rows today and growing).
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // A new search term or reason filter invalidates whatever page we were on.
  useEffect(() => {
    setPage(0);
  }, [search, reason, stream]);

  const { data, isLoading, error } = useSuppressions({
    search,
    reason: reason || undefined,
    stream: stream || undefined,
    page,
  });
  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const from = count === 0 ? 0 : page * SUPPRESSIONS_PAGE_SIZE + 1;
  const to = Math.min(count, page * SUPPRESSIONS_PAGE_SIZE + rows.length);
  const hasNext = to < count;
  const hasPrev = page > 0;

  const unsuppress = useUnsuppressEmail();
  const addManual = useAdminSuppressEmail();
  const [removeTarget, setRemoveTarget] = useState<SuppressionRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeNote, setRemoveNote] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addNote, setAddNote] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoveError(null);
    try {
      await unsuppress.mutateAsync({ email: removeTarget.email_lower, note: removeNote.trim() });
      setRemoveTarget(null);
      setRemoveNote('');
    } catch {
      setRemoveError(t('suppressions.remove.failed'));
    }
  }

  async function confirmAdd() {
    setAddError(null);
    try {
      await addManual.mutateAsync({ email: addEmail.trim(), note: addNote.trim() });
      setAddOpen(false);
      setAddEmail('');
      setAddNote('');
    } catch {
      setAddError(t('suppressions.add.failed'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('suppressions.title')} description={t('suppressions.description')}>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              {t('suppressions.add.button')}
            </Button>
          )}
        </PageHeader>
      </SettingsCard>

      <FilterBar className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('suppressions.search_placeholder')}
            placeholder={t('suppressions.search_placeholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <FilterSelect
          aria-label={t('suppressions.reason_all')}
          value={reason}
          onChange={(e) => setReason(e.target.value as SuppressionReason | '')}
          className="min-w-[200px]"
        >
          <option value="">{t('suppressions.reason_all')}</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {reasonLabel(r, t)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label={t('suppressions.stream_all')}
          value={stream}
          onChange={(e) => setStream(e.target.value as SuppressionStream | '')}
          className="min-w-[170px]"
        >
          <option value="">{t('suppressions.stream_all')}</option>
          {STREAMS.map((sv) => (
            <option key={sv} value={sv}>
              {t(`suppressions.streams.${sv}`)}
            </option>
          ))}
        </FilterSelect>
        <span className="text-xs tabular-nums text-muted-foreground sm:ml-auto">
          {t('suppressions.count', { count })}
        </span>
      </FilterBar>

      {removeError ? <p className="text-sm text-red-600 dark:text-red-400">{removeError}</p> : null}

      <SettingsTableShell>
        <table className="w-full text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={settingsThClass}>{t('suppressions.columns.email')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.reason')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.stream')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.bounce_count')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.first_seen')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.last_seen')}</th>
              <th className={settingsThClass} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('suppressions.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')} colSpan={7}>
                  {error.message}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('suppressions.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.email_lower} className={settingsTrClass}>
                  <td className={settingsTdClass}>{row.email_lower}</td>
                  <td className={settingsTdClass}>{reasonLabel(row.reason, t)}</td>
                  <td className={cn(settingsTdClass, 'whitespace-nowrap')}>
                    {t(`suppressions.streams.${row.stream}`, { defaultValue: row.stream })}
                    {row.note ? (
                      <span className="ml-1 text-xs text-muted-foreground" title={row.note}>
                        ⓘ
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(settingsTdClass, 'tabular-nums')}>{row.bounce_count}</td>
                  <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                    {formatDate(row.first_seen_at, i18n.language)}
                  </td>
                  <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                    {formatDate(row.last_seen_at, i18n.language)}
                  </td>
                  <td className={cn(settingsTdClass, 'text-right')}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRemoveError(null);
                        setRemoveTarget(row);
                      }}
                    >
                      {t('suppressions.remove.button')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SettingsTableShell>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {count === 0
            ? t('suppressions.pagination.empty')
            : t('suppressions.pagination.range', { from, to, count })}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            {t('suppressions.pagination.prev')}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            {t('suppressions.pagination.next')}
          </Button>
        </div>
      </div>

      {/* Removal takes a mandatory reason: taking an address off the list means
          we start emailing that person again, so the why is recorded (with who
          did it) in email_suppression_audit. That is why this is a Dialog with
          an input and no longer a bare ConfirmDialog. */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(next) => {
          // Deliberately does NOT clear `removeError` — a failure message must
          // survive the dialog closing instead of being wiped in the same
          // state update that would have revealed it.
          if (!next) {
            setRemoveTarget(null);
            setRemoveNote('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('suppressions.remove.confirm_title', { email: removeTarget?.email_lower ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {removeError ??
                (removeTarget?.reason === 'unsubscribed'
                  ? t('suppressions.remove.confirm_text_unsubscribed')
                  : t('suppressions.remove.confirm_text'))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="unsuppress-note">{t('suppressions.remove.note_label')}</Label>
            <Input
              id="unsuppress-note"
              value={removeNote}
              onChange={(e) => setRemoveNote(e.target.value)}
              placeholder={t('suppressions.remove.note_placeholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              {t('suppressions.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!removeNote.trim() || unsuppress.isPending}
              onClick={confirmRemove}
            >
              {t('suppressions.remove.button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual add: the phone-call case — «μη μου ξαναστείλετε». */}
      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next) setAddOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('suppressions.add.title')}</DialogTitle>
            <DialogDescription>{addError ?? t('suppressions.add.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="suppress-email">{t('suppressions.columns.email')}</Label>
              <Input
                id="suppress-email"
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="suppress-note">{t('suppressions.add.note_label')}</Label>
              <Input
                id="suppress-note"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder={t('suppressions.add.note_placeholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('suppressions.cancel')}
            </Button>
            <Button
              disabled={!addEmail.trim() || !addNote.trim() || addManual.isPending}
              onClick={confirmAdd}
            >
              {t('suppressions.add.button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
