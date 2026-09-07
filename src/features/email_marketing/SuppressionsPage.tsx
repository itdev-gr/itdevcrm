import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  SUPPRESSIONS_PAGE_SIZE,
  type SuppressionReason,
  type SuppressionRow,
} from './hooks/useSuppressions';

const SEARCH_DEBOUNCE_MS = 300;

const REASONS: SuppressionReason[] = ['hard_bounce', 'soft_bounce', 'complaint', 'manual', 'invalid', 'unsubscribed'];

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
  const [page, setPage] = useState(0);

  // Server-side search, debounced — never filters a fully-loaded array (the
  // list is ~450 rows today and growing).
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // A new search term or reason filter invalidates whatever page we were on.
  useEffect(() => {
    setPage(0);
  }, [search, reason]);

  const { data, isLoading, error } = useSuppressions({
    search,
    reason: reason || undefined,
    page,
  });
  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const from = count === 0 ? 0 : page * SUPPRESSIONS_PAGE_SIZE + 1;
  const to = Math.min(count, page * SUPPRESSIONS_PAGE_SIZE + rows.length);
  const hasNext = to < count;
  const hasPrev = page > 0;

  const unsuppress = useUnsuppressEmail();
  const [removeTarget, setRemoveTarget] = useState<SuppressionRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoveError(null);
    try {
      await unsuppress.mutateAsync(removeTarget.email_lower);
      setRemoveTarget(null);
    } catch {
      setRemoveError(t('suppressions.remove.failed'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('suppressions.title')} description={t('suppressions.description')} />
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
              <th className={settingsThClass}>{t('suppressions.columns.bounce_count')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.first_seen')}</th>
              <th className={settingsThClass}>{t('suppressions.columns.last_seen')}</th>
              <th className={settingsThClass} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={6}>
                  {t('suppressions.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')} colSpan={6}>
                  {error.message}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={6}>
                  {t('suppressions.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.email_lower} className={settingsTrClass}>
                  <td className={settingsTdClass}>{row.email_lower}</td>
                  <td className={settingsTdClass}>{reasonLabel(row.reason, t)}</td>
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

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(next) => {
          if (!next) {
            setRemoveTarget(null);
            setRemoveError(null);
          }
        }}
        title={t('suppressions.remove.confirm_title', { email: removeTarget?.email_lower ?? '' })}
        description={
          removeTarget?.reason === 'unsubscribed'
            ? t('suppressions.remove.confirm_text_unsubscribed')
            : t('suppressions.remove.confirm_text')
        }
        confirmLabel={t('suppressions.remove.button')}
        pending={unsuppress.isPending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
