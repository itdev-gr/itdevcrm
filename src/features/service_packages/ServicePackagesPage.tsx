import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
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
      <td colSpan={7} className="bg-muted/30 p-0">
        <div className="px-8 py-3">
          <div className="mb-2 flex items-center justify-between">
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
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-3">{t('service_packages.fields.code')}</th>
                  <th className="py-1 pr-3">{t('service_packages.fields.name')}</th>
                  <th className="py-1 pr-3">€ {t('service_packages.fields.price')}</th>
                  <th className="py-1 pr-3">{t('service_packages.fields.sort_order')}</th>
                  <th className="py-1 pr-3">{t('service_packages.fields.is_active')}</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => (
                  <tr key={sub.id} className="border-b">
                    <td className="py-1 pr-3 font-mono">{sub.code}</td>
                    <td className="py-1 pr-3">
                      {(sub.display_names as { en?: string; el?: string })[lang]}
                    </td>
                    <td className="py-1 pr-3">€{Number(sub.price ?? 0).toFixed(0)}</td>
                    <td className="py-1 pr-3">{sub.sort_order}</td>
                    <td className="py-1 pr-3">
                      <input
                        type="checkbox"
                        checked={sub.is_active}
                        onChange={(e) =>
                          toggleSubActive.mutate({ id: sub.id, is_active: e.target.checked })
                        }
                        className="h-3.5 w-3.5"
                      />
                    </td>
                    <td className="py-1 space-x-1">
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => {
                          setEditingSub(sub);
                          setSubDialogOpen(true);
                        }}
                      >
                        {t('service_packages.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => archiveSub.mutate({ id: sub.id, archived: true })}
                      >
                        {t('service_packages.archive')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      <tr className={`border-b ${p.archived ? 'opacity-50' : ''}`}>
        <td className="py-2 pr-2 w-6">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-transform"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </td>
        <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
        <td className="py-2 pr-4">
          {(p.display_names as { en?: string; el?: string })[lang]}
        </td>
        <td className="py-2 pr-4 max-w-[200px]">
          {description && (
            <span
              className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
              title={description}
            >
              {description}
            </span>
          )}
        </td>
        <td className="py-2 pr-4">€{Number(p.default_one_time_amount ?? 0).toFixed(0)}</td>
        <td className="py-2 pr-4">€{Number(p.default_monthly_amount ?? 0).toFixed(0)}</td>
        <td className="py-2 pr-4">{p.sort_order}</td>
        <td className="py-2 pr-4">
          <input
            type="checkbox"
            checked={p.is_active}
            onChange={(e) => toggleActive(p.id, e.target.checked)}
            className="h-4 w-4"
          />
        </td>
        <td className="py-2 space-x-2">
          <Button size="sm" variant="link" onClick={() => onEdit(p)}>
            {t('service_packages.edit')}
          </Button>
          <Button size="sm" variant="link" onClick={() => onArchive(p)}>
            {p.archived ? t('service_packages.restore') : t('service_packages.archive')}
          </Button>
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

  if (isLoading) return <div className="p-8">…</div>;

  const grouped = new Map<string, ServicePackageRow[]>();
  for (const p of packages) {
    const list = grouped.get(p.service_type) ?? [];
    list.push(p);
    grouped.set(p.service_type, list);
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('service_packages.title')}</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('service_packages.show_archived')}
          </label>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('service_packages.add')}
          </Button>
        </div>
      </div>

      {[...grouped.entries()].map(([serviceType, rows]) => (
        <section key={serviceType} className="space-y-2">
          <h2 className="text-lg font-semibold">{serviceType}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 w-6"></th>
                <th className="py-2 pr-4">{t('service_packages.fields.code')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.name')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.description')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_one_time')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_monthly')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.sort_order')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.is_active')}</th>
                <th className="py-2"></th>
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
        </section>
      ))}

      <ServicePackageDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
