import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FilterBar, FilterSelect, PageHeader } from '@/components/layout/page-shell';
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
import { LEADS_TABLE_COLS, LEADS_TABLE_MIN_WIDTH } from './leadsTableLayout';
import { filterAndSortLeads, UNASSIGNED, type LeadSort, type LeadSortKey } from './leadsTableFilter';
import { leadsToCsv, leadCsvColumns } from './leadsCsv';
import type { Database } from '@/types/supabase';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

const ALL = '__all__';
const PAGE_SIZE = 50;

export function LeadsListPage() {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [includeConverted, setIncludeConverted] = useState(false);

  const { data: leads = [], isLoading, error } = useLeads({ includeConverted });
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
  const [confirmDistribute, setConfirmDistribute] = useState(false);

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

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [search, statusId, ownerId, sort, includeConverted]);

  function toggleSort(key: LeadSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function exportCsv() {
    const cols = leadCsvColumns({ t, ownerLabel, statusLabel });
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

  async function onConfirmDistribute() {
    try {
      const n = await distribute.mutateAsync();
      alert(t('distribute.done', { count: n }));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setConfirmDistribute(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">…</div>;
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
    <div className="space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('title')}>
        {isAdmin && (
          <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
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
            onClick={() => setConfirmDistribute(true)}
          >
            {t('distribute.button', { count: unassignedCount })}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-4" />
          {t('export_csv')}
        </Button>
      </PageHeader>

      <FilterBar>
        <Input
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-xs rounded-lg border-input/80 shadow-sm"
        />
        <FilterSelect value={statusId} onChange={(e) => setStatusId(e.target.value)}>
          <option value={ALL}>{t('table.status_all')}</option>
          {salesStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_names[lang] ?? s.code}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value={ALL}>{t('table.owner_all')}</option>
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.full_name || o.email}
            </option>
          ))}
        </FilterSelect>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            aria-label={t('filters.include_won')}
            checked={includeConverted}
            onChange={(e) => setIncludeConverted(e.target.checked)}
          />
          {t('filters.include_won')}
        </label>
        <span className="ml-auto text-sm text-muted-foreground">
          {rows.length} {t('title').toLowerCase()}
        </span>
      </FilterBar>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1a9696]/20 bg-[#1a9696]/5 p-3 text-sm">
          <span className="font-medium">{t('bulk.selected', { count: selected.size })}</span>
          <FilterSelect
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                void bulkApply({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value });
              e.currentTarget.value = '';
            }}
          >
            <option value="">{t('bulk.reassign')}</option>
            <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
            {owners.map((o) => (
              <option key={o.user_id} value={o.user_id}>
                {o.full_name || o.email}
              </option>
            ))}
          </FilterSelect>
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={requestBulkDelete}>
              <Trash2 className="size-4" />
              {t('delete.bulk')}
            </Button>
          )}
          <FilterSelect
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void bulkApply({ stage_id: e.target.value });
              e.currentTarget.value = '';
            }}
          >
            <option value="">{t('bulk.set_status')}</option>
            {salesStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_names[lang] ?? s.code}
              </option>
            ))}
          </FilterSelect>
          <Button variant="destructive" size="sm" onClick={() => void bulkApply({ archived: true })}>
            {t('bulk.archive')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
            {t('bulk.clear')}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="max-h-[calc(100vh-14rem)] overflow-auto">
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ minWidth: LEADS_TABLE_MIN_WIDTH }}
            >
              <colgroup>
                {LEADS_TABLE_COLS.map((w, i) => (
                  <col key={i} className={w} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left">
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="select all"
                      checked={selected.size > 0 && selected.size === rows.length}
                      onChange={(e) => selectAll(e.target.checked)}
                    />
                  </th>
                  {cols.map((c, i) => (
                    <th
                      key={c.key}
                      className={cn(
                        'cursor-pointer px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground',
                        i === 4 && 'border-l border-border/50',
                        i === 7 && 'border-l border-border/50',
                        i === 9 && 'border-l border-border/50',
                        (c.key === 'email' || c.key === 'website' || c.key === 'company_name') &&
                          'text-foreground/80',
                      )}
                      onClick={() => toggleSort(c.key)}
                    >
                      <span className="block truncate">{c.label}</span>
                      {sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
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
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ {t('pager.prev')}
          </Button>
          <span className="text-muted-foreground">
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
        onOpenChange={(o) => {
          if (!o) setConfirmIds(null);
        }}
        title={t('delete.title')}
        description={confirmIds ? t('delete.confirm', { count: confirmIds.length }) : ''}
        confirmLabel={t('delete.button')}
        onConfirm={onConfirmDelete}
        pending={del.isPending}
      />

      <ConfirmDialog
        open={confirmDistribute}
        onOpenChange={(o) => {
          if (!o) setConfirmDistribute(false);
        }}
        title={t('distribute.confirm_title')}
        description={t('distribute.confirm_body', { count: unassignedCount })}
        confirmLabel={t('distribute.confirm_cta')}
        onConfirm={onConfirmDistribute}
        pending={distribute.isPending}
      />
    </div>
  );
}
