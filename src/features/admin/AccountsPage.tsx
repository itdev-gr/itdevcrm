import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  FilterBar,
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTheadClass,
  settingsThClass,
  settingsTrClass,
  settingsTdClass,
} from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { AccountDialog } from './AccountDialog';
import {
  useCompanyAccounts,
  useCompanyAccountPassword,
  useDeleteCompanyAccount,
  type CompanyAccountRow,
} from './hooks/useCompanyAccounts';

function matches(row: CompanyAccountRow, term: string): boolean {
  if (!term) return true;
  const haystack = [row.title, row.email, row.notes].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function AccountsPage() {
  const { t } = useTranslation('admin');
  const { data: rows = [], isLoading, error } = useCompanyAccounts();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyAccountRow | null>(null);

  // Revealed plaintext lives ONLY here, per row, for as long as the page is
  // open — nothing is cached by react-query and nothing is persisted.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const reveal = useCompanyAccountPassword();

  const del = useDeleteCompanyAccount();
  const [removeTarget, setRemoveTarget] = useState<CompanyAccountRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const visible = useMemo(() => rows.filter((r) => matches(r, search.trim())), [rows, search]);

  /** Fetches the plaintext once and keeps it for this row; returns it so the
   *  copy button can chain off the same call. */
  async function fetchPassword(row: CompanyAccountRow): Promise<string | null> {
    if (revealed[row.id] !== undefined) return revealed[row.id];
    setRowError(null);
    try {
      const pw = await reveal.mutateAsync(row.id);
      if (pw === null) return null;
      setRevealed((prev) => ({ ...prev, [row.id]: pw }));
      return pw;
    } catch {
      setRowError(t('accounts.errors.reveal_failed'));
      return null;
    }
  }

  async function toggleReveal(row: CompanyAccountRow) {
    if (revealed[row.id] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }
    await fetchPassword(row);
  }

  async function copyPassword(row: CompanyAccountRow) {
    const pw = await fetchPassword(row);
    if (pw === null) return;
    try {
      await navigator.clipboard.writeText(pw);
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1500);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission) — the
      // password is revealed on screen either way, so this is not an error
      // worth interrupting the admin for.
      setRevealed((prev) => ({ ...prev, [row.id]: pw }));
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoveError(null);
    try {
      await del.mutateAsync(removeTarget.id);
      setRemoveTarget(null);
    } catch {
      setRemoveError(t('accounts.delete.failed'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('accounts.title')} description={t('accounts.description')}>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t('accounts.add')}
          </Button>
        </PageHeader>
      </SettingsCard>

      <FilterBar className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('accounts.search_placeholder')}
            placeholder={t('accounts.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground sm:ml-auto">
          {t('accounts.count', { count: visible.length })}
        </span>
      </FilterBar>

      {rowError ? <p className="text-sm text-red-600 dark:text-red-400">{rowError}</p> : null}
      {removeError ? <p className="text-sm text-red-600 dark:text-red-400">{removeError}</p> : null}

      <SettingsTableShell>
        <table className="w-full text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={settingsThClass}>{t('accounts.columns.title')}</th>
              <th className={settingsThClass}>{t('accounts.columns.email')}</th>
              <th className={settingsThClass}>{t('accounts.columns.password')}</th>
              <th className={settingsThClass}>{t('accounts.columns.notes')}</th>
              <th className={settingsThClass} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={5}>
                  {t('accounts.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')} colSpan={5}>
                  {error.message}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={5}>
                  {rows.length === 0 ? t('accounts.empty') : t('accounts.no_matches')}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'font-medium')}>{row.title}</td>
                  <td className={settingsTdClass}>{row.email || '—'}</td>
                  <td className={settingsTdClass}>
                    {row.has_password ? (
                      <div className="flex items-center gap-1.5">
                        <span className={cn('font-mono text-xs', revealed[row.id] === undefined && 'tracking-widest')}>
                          {revealed[row.id] ?? '••••••••'}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          aria-label={
                            revealed[row.id] === undefined
                              ? t('accounts.reveal', { title: row.title })
                              : t('accounts.hide', { title: row.title })
                          }
                          title={revealed[row.id] === undefined ? t('accounts.reveal_short') : t('accounts.hide_short')}
                          onClick={() => void toggleReveal(row)}
                        >
                          {revealed[row.id] === undefined ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          aria-label={t('accounts.copy', { title: row.title })}
                          title={copiedId === row.id ? t('accounts.copied') : t('accounts.copy_short')}
                          onClick={() => void copyPassword(row)}
                        >
                          <Copy className={cn('size-3.5', copiedId === row.id && 'text-emerald-600')} />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(settingsTdClass, 'max-w-xs whitespace-pre-wrap text-muted-foreground')}>
                    {row.notes || '—'}
                  </td>
                  <td className={cn(settingsTdClass, 'text-right')}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('accounts.edit', { title: row.title })}
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('accounts.delete.button', { title: row.title })}
                        onClick={() => {
                          setRemoveError(null);
                          setRemoveTarget(row);
                        }}
                      >
                        <Trash2 className="size-3.5 text-red-600 dark:text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SettingsTableShell>

      <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(next) => {
          // Same as SuppressionsPage: a failure message is NOT cleared here, so
          // it survives the dialog closing instead of vanishing in the same
          // state update that would have shown it.
          if (!next) setRemoveTarget(null);
        }}
        title={t('accounts.delete.confirm_title', { title: removeTarget?.title ?? '' })}
        description={removeError ?? t('accounts.delete.confirm_text')}
        confirmLabel={t('accounts.delete.confirm_cta')}
        pending={del.isPending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
