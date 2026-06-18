import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Package, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  FilterBar,
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { useServicePackages, type ServicePackageRow } from './hooks/useServicePackages';
import { useArchiveServicePackage } from './hooks/useArchiveServicePackage';
import { useToggleServicePackageActive } from './hooks/useToggleActive';
import { useServiceSubpackages } from './hooks/useServiceSubpackages';
import { useArchiveSubpackage } from './hooks/useArchiveSubpackage';
import { useToggleSubpackageActive } from './hooks/useToggleActive';
import { ServicePackageDialog } from './ServicePackageDialog';
import { SubpackageDialog } from './SubpackageDialog';
import type { ServiceSubpackageRow } from './hooks/useServiceSubpackages';

// ── Sub-products nested section ─────────────────────────────────────────────
// Note: Archived sub-packages are filtered out at query time and do not appear in the UI.
// To restore an archived sub-package, use the database directly or add a toggle in a future enhancement.

type SubRowsProps = {
  parentId: string;
};

function SubpackageRows({ parentId }: SubRowsProps) {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: subs = [], isLoading } = useServiceSubpackages(parentId);
  const archiveSub = useArchiveSubpackage(parentId);
  const toggleSubActive = useToggleSubpackageActive(parentId);
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<ServiceSubpackageRow | null>(null);

  return (
    <tr>
      <td colSpan={9} className="bg-muted/20 p-0">
        <div className="border-t border-border/40 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('service_packages.subpackages.title')}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingSub(null);
                setSubDialogOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              {t('service_packages.subpackages.add')}
            </Button>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">…</p>
          ) : subs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('service_packages.subpackages.empty')}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
              <table className="w-full border-collapse text-xs">
                <thead className={settingsTheadClass}>
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('service_packages.fields.code')}</th>
                    <th className="px-3 py-2 font-medium">{t('service_packages.fields.name')}</th>
                    <th className="px-3 py-2 font-medium">€ {t('service_packages.fields.price')}</th>
                    <th className="px-3 py-2 font-medium">{t('service_packages.fields.sort_order')}</th>
                    <th className="px-3 py-2 font-medium">{t('service_packages.fields.is_active')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((sub) => (
                    <tr key={sub.id} className={settingsTrClass}>
                      <td className="px-3 py-2 font-mono">{sub.code}</td>
                      <td className="px-3 py-2">
                        {(sub.display_names as { en?: string; el?: string })[lang]}
                      </td>
                      <td className="px-3 py-2 tabular-nums">€{Number(sub.price ?? 0).toFixed(0)}</td>
                      <td className="px-3 py-2 tabular-nums">{sub.sort_order}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={sub.is_active}
                          onChange={(e) =>
                            toggleSubActive.mutate({ id: sub.id, is_active: e.target.checked })
                          }
                          className="size-3.5 rounded border-input accent-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSub(sub);
                              setSubDialogOpen(true);
                            }}
                          >
                            {t('service_packages.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => archiveSub.mutate({ id: sub.id, archived: true })}
                          >
                            {t('service_packages.archive')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <SubpackageDialog
          open={subDialogOpen}
          onOpenChange={setSubDialogOpen}
          parentId={parentId}
          initial={editingSub}
        />
      </td>
    </tr>
  );
}

// ── Main package row ─────────────────────────────────────────────────────────

type PackageRowProps = {
  p: ServicePackageRow;
  lang: 'en' | 'el';
  onEdit: (p: ServicePackageRow) => void;
  onArchive: (p: ServicePackageRow) => void;
  toggleActive: (id: string, is_active: boolean) => void;
};

function PackageRow({ p, lang, onEdit, onArchive, toggleActive }: PackageRowProps) {
  const { t } = useTranslation('admin');
  const [expanded, setExpanded] = useState(false);

  const description = p.description ?? '';

  return (
    <>
      <tr className={`${settingsTrClass} ${p.archived ? 'opacity-50' : ''}`}>
        <td className={`${settingsTdClass} w-10`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </td>
        <td className={`${settingsTdClass} font-mono text-xs`}>{p.code}</td>
        <td className={settingsTdClass}>
          {(p.display_names as { en?: string; el?: string })[lang]}
        </td>
        <td className={`${settingsTdClass} max-w-[200px]`}>
          {description && (
            <span
              className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
              title={description}
            >
              {description}
            </span>
          )}
        </td>
        <td className={`${settingsTdClass} tabular-nums`}>€{Number(p.default_one_time_amount ?? 0).toFixed(0)}</td>
        <td className={`${settingsTdClass} tabular-nums`}>€{Number(p.default_monthly_amount ?? 0).toFixed(0)}</td>
        <td className={`${settingsTdClass} tabular-nums`}>{p.sort_order}</td>
        <td className={settingsTdClass}>
          <input
            type="checkbox"
            checked={p.is_active}
            onChange={(e) => toggleActive(p.id, e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
        </td>
        <td className={settingsTdClass}>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => onEdit(p)}>
              {t('service_packages.edit')}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onArchive(p)}>
              {p.archived ? t('service_packages.restore') : t('service_packages.archive')}
            </Button>
          </div>
        </td>
      </tr>
      {expanded && <SubpackageRows parentId={p.id} />}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ServicePackagesPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<ServicePackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const { data: packages = [], isLoading } = useServicePackages({ includeArchived });
  const archive = useArchiveServicePackage();
  const toggleActive = useToggleServicePackageActive();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  const grouped = new Map<string, ServicePackageRow[]>();
  for (const p of packages) {
    const list = grouped.get(p.service_type) ?? [];
    list.push(p);
    grouped.set(p.service_type, list);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('service_packages.title')}>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t('service_packages.add')}
        </Button>
      </PageHeader>

      <FilterBar>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="size-3.5 rounded border-input accent-primary"
          />
          <span className="text-muted-foreground">{t('service_packages.show_archived')}</span>
        </label>
      </FilterBar>

      {[...grouped.entries()].map(([serviceType, rows]) => (
        <SettingsCard key={serviceType} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <Package className="size-4 text-primary dark:text-[#7ad4d4]" />
            <h2 className="text-sm font-semibold">{serviceType}</h2>
          </div>
          <SettingsTableShell className="rounded-none border-0 shadow-none">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead className={settingsTheadClass}>
                <tr>
                  <th className={`${settingsThClass} w-10`}></th>
                  <th className={settingsThClass}>{t('service_packages.fields.code')}</th>
                  <th className={settingsThClass}>{t('service_packages.fields.name')}</th>
                  <th className={settingsThClass}>{t('service_packages.fields.description')}</th>
                  <th className={settingsThClass}>€ {t('service_packages.fields.default_one_time')}</th>
                  <th className={settingsThClass}>€ {t('service_packages.fields.default_monthly')}</th>
                  <th className={settingsThClass}>{t('service_packages.fields.sort_order')}</th>
                  <th className={settingsThClass}>{t('service_packages.fields.is_active')}</th>
                  <th className={settingsThClass}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PackageRow
                    key={p.id}
                    p={p}
                    lang={lang}
                    onEdit={(row) => {
                      setEditing(row);
                      setOpen(true);
                    }}
                    onArchive={(row) => archive.mutate({ id: row.id, archived: !row.archived })}
                    toggleActive={(id, is_active) => toggleActive.mutate({ id, is_active })}
                  />
                ))}
              </tbody>
            </table>
          </SettingsTableShell>
        </SettingsCard>
      ))}

      <ServicePackageDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
