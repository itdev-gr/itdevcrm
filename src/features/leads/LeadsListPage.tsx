import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { useLeads } from './hooks/useLeads';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useBulkUpdateLeads } from './hooks/useBulkUpdateLeads';
import { useDeleteLeads } from './hooks/useDeleteLeads';
import { useLeadDistribution } from './hooks/useLeadDistribution';
import { useDistributeUnassigned } from './hooks/useDistributeUnassigned';
import { isLeadDeletable } from './leadDeletable';
import { LeadRowEditor } from './LeadRowEditor';
import { filterAndSortLeads, UNASSIGNED, type LeadSort, type LeadSortKey } from './leadsTableFilter';
import { leadsToCsv, type CsvColumn } from './leadsCsv';
import type { LeadRow } from './hooks/useLeads';
import type { Database } from '@/types/supabase';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

const ALL = '__all__';
const PAGE_SIZE = 50;

export function LeadsListPage() {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { data: leads = [], isLoading, error } = useLeads({});
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const bulk = useBulkUpdateLeads();
  const del = useDeleteLeads();
  const distribution = useLeadDistribution();
  const distribute = useDistributeUnassigned();

  const salesStages = useMemo(
    () => stages.filter((s) => s.board === 'sales' && !s.archived).sort((a, b) => a.position - b.position),
    [stages],
  );
  const ownerLabel = useMemo(() => {
    const m = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
    return (id: string | null) => (id ? (m.get(id) ?? '') : '');
  }, [owners]);
  const statusLabel = useMemo(() => {
    const m = new Map(salesStages.map((s) => [s.id, s.display_names[lang] ?? s.code]));
    return (id: string | null) => (id ? (m.get(id) ?? '') : '');
  }, [salesStages, lang]);

  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusId, setStatusId] = useState<string>(params.get('stage') || ALL);
  const [ownerId, setOwnerId] = useState<string>(params.get('owner') || ALL);
  const [sort, setSort] = useState<LeadSort>({ key: 'code', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const rows = useMemo(
    () =>
      filterAndSortLeads(leads, {
        search,
        statusId: statusId === ALL ? null : statusId,
        ownerId: ownerId === ALL ? null : ownerId,
        sort,
        ownerLabel,
        statusLabel,
      }),
    [leads, search, statusId, ownerId, sort, ownerLabel, statusLabel],
  );

  const unassignedCount = useMemo(() => leads.filter((l) => !l.owner_user_id).length, [leads]);

  // Render one page at a time (the full filtered set still drives CSV export +
  // select-all + counts). Rendering thousands of editable rows was the crash.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [search, statusId, ownerId, sort]);

  function toggleSort(key: LeadSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function exportCsv() {
    const cols: CsvColumn<LeadRow>[] = [
      { header: t('table.code'), value: (l) => l.code ?? '' },
      { header: t('table.source'), value: (l) => l.source ?? '' },
      { header: t('table.title'), value: (l) => l.title ?? '' },
      { header: t('table.full_name'), value: (l) => [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ') },
      { header: t('table.email'), value: (l) => l.email ?? '' },
      { header: t('table.phone'), value: (l) => l.phone ?? '' },
      { header: t('table.website'), value: (l) => l.website ?? '' },
      { header: t('table.category'), value: (l) => l.industry ?? '' },
      { header: t('table.company'), value: (l) => l.company_name ?? '' },
      { header: t('table.assign'), value: (l) => ownerLabel(l.owner_user_id) },
      { header: t('table.status'), value: (l) => statusLabel(l.stage_id) },
    ];
    const csv = leadsToCsv(rows, cols);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bulkApply(patch: LeadUpdate) {
    await bulk.mutateAsync({ ids: [...selected], patch });
    setSelected(new Set());
  }

  function requestBulkDelete() {
    const ids = rows.filter((l) => selected.has(l.id) && isLeadDeletable(l)).map((l) => l.id);
    if (ids.length === 0) {
      alert(t('delete.none'));
      return;
    }
    setConfirmIds(ids);
  }

  async function onConfirmDelete() {
    if (!confirmIds) return;
    try {
      const r = await del.mutateAsync(confirmIds);
      if (r.skipped.length > 0) alert(t('delete.skipped', { count: r.skipped.length }));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setConfirmIds(null);
      setSelected(new Set());
    }
  }

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  const cols: { key: LeadSortKey; label: string }[] = [
    { key: 'code', label: t('table.code') },
    { key: 'source', label: t('table.source') },
    { key: 'title', label: t('table.title') },
    { key: 'full_name', label: t('table.full_name') },
    { key: 'email', label: t('table.email') },
    { key: 'phone', label: t('table.phone') },
    { key: 'website', label: t('table.website') },
    { key: 'industry', label: t('table.category') },
    { key: 'company_name', label: t('table.company') },
    { key: 'owner', label: t('table.assign') },
    { key: 'status', label: t('table.status') },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={distribution.autoEnabled}
                disabled={distribution.isLoading || distribution.setEnabled.isPending}
                onChange={(e) => distribution.setEnabled.mutate(e.target.checked)}
              />
              {t('distribute.auto_label')}
            </label>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={unassignedCount === 0 || distribute.isPending}
              onClick={async () => {
                const n = await distribute.mutateAsync();
                alert(t('distribute.done', { count: n }));
              }}
            >
              {t('distribute.button', { count: unassignedCount })}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv}>{t('export_csv')}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-sm">
          <option value={ALL}>{t('table.status_all')}</option>
          {salesStages.map((s) => (
            <option key={s.id} value={s.id}>{s.display_names[lang] ?? s.code}</option>
          ))}
        </select>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-sm">
          <option value={ALL}>{t('table.owner_all')}</option>
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted p-2 text-sm">
          <span>{t('bulk.selected', { count: selected.size })}</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) void bulkApply({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value }); e.currentTarget.value = ''; }}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="">{t('bulk.reassign')}</option>
            <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
            {owners.map((o) => (<option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>))}
          </select>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) void bulkApply({ stage_id: e.target.value }); e.currentTarget.value = ''; }}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="">{t('bulk.set_status')}</option>
            {salesStages.map((s) => (<option key={s.id} value={s.id}>{s.display_names[lang] ?? s.code}</option>))}
          </select>
          <Button variant="destructive" size="sm" onClick={() => void bulkApply({ archived: true })}>{t('bulk.archive')}</Button>
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={requestBulkDelete}>{t('delete.bulk')}</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>{t('bulk.clear')}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-1 py-2">
                  <input
                    type="checkbox"
                    aria-label="select all"
                    checked={selected.size > 0 && selected.size === rows.length}
                    onChange={(e) => selectAll(e.target.checked)}
                  />
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="cursor-pointer px-1 py-2 hover:underline"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((lead) => (
                <LeadRowEditor
                  key={lead.id}
                  lead={lead}
                  owners={owners}
                  stages={salesStages}
                  currentUserId={userId}
                  lang={lang}
                  selected={selected.has(lead.id)}
                  onToggleSelect={toggleSelect}
                  isAdmin={isAdmin}
                  onDelete={(l) => setConfirmIds([l.id])}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹ {t('pager.prev')}
          </Button>
          <span>
            {t('pager.status', { page: safePage + 1, total: pageCount, count: rows.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('pager.next')} ›
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmIds !== null}
        onOpenChange={(o) => { if (!o) setConfirmIds(null); }}
        title={t('delete.title')}
        description={confirmIds ? t('delete.confirm', { count: confirmIds.length }) : ''}
        confirmLabel={t('delete.button')}
        onConfirm={onConfirmDelete}
        pending={del.isPending}
      />
    </div>
  );
}
