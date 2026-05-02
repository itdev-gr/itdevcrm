import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useServicePackages, type ServicePackageRow } from './hooks/useServicePackages';
import { useArchiveServicePackage } from './hooks/useArchiveServicePackage';
import { ServicePackageDialog } from './ServicePackageDialog';

export function ServicePackagesPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<ServicePackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const { data: packages = [], isLoading } = useServicePackages({ includeArchived });
  const archive = useArchiveServicePackage();

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
                <th className="py-2 pr-4">{t('service_packages.fields.code')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.name')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_one_time')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_monthly')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.sort_order')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`border-b ${p.archived ? 'opacity-50' : ''}`}>
                  <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
                  <td className="py-2 pr-4">
                    {(p.display_names as { en?: string; el?: string })[lang]}
                  </td>
                  <td className="py-2 pr-4">
                    €{Number(p.default_one_time_amount ?? 0).toFixed(0)}
                  </td>
                  <td className="py-2 pr-4">€{Number(p.default_monthly_amount ?? 0).toFixed(0)}</td>
                  <td className="py-2 pr-4">{p.sort_order}</td>
                  <td className="py-2 space-x-2">
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => {
                        setEditing(p);
                        setOpen(true);
                      }}
                    >
                      {t('service_packages.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => archive.mutate({ id: p.id, archived: !p.archived })}
                    >
                      {p.archived ? t('service_packages.restore') : t('service_packages.archive')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <ServicePackageDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
