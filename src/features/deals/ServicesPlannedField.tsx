import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useServicePackages } from '@/features/service_packages/hooks/useServicePackages';

export type PlannedService = {
  service_type: 'web_seo' | 'local_seo' | 'web_dev' | 'social_media' | 'ai_seo' | 'hosting';
  billing_type: 'one_time' | 'recurring_monthly';
  package_id?: string | null;
  one_time_amount?: number;
  monthly_amount?: number;
  setup_fee?: number;
};

type Props = {
  value: PlannedService[];
  onChange: (next: PlannedService[]) => void;
  disabled?: boolean;
};

const SERVICE_TYPES: PlannedService['service_type'][] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
];
const BILLING_TYPES: PlannedService['billing_type'][] = ['recurring_monthly', 'one_time'];
const NO_PACKAGE = '__none__';

function patchRow(row: PlannedService, patch: Partial<PlannedService>): PlannedService {
  return { ...row, ...patch } as PlannedService;
}

export function ServicesPlannedField({ value, onChange, disabled }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isDisabled = !!disabled;
  const { data: packages = [] } = useServicePackages();

  function addRow() {
    onChange([...value, { service_type: 'web_seo', billing_type: 'recurring_monthly' }]);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<PlannedService>) {
    onChange(value.map((row, i) => (i === idx ? patchRow(row, patch) : row)));
  }

  function pickPackage(idx: number, packageId: string) {
    if (packageId === NO_PACKAGE) {
      updateRow(idx, { package_id: null });
      return;
    }
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) {
      updateRow(idx, { package_id: null });
      return;
    }
    updateRow(idx, {
      package_id: pkg.id,
      one_time_amount: Number(pkg.default_one_time_amount ?? 0),
      monthly_amount: Number(pkg.default_monthly_amount ?? 0),
      setup_fee: Number(pkg.setup_fee ?? 0),
    });
  }

  function numericPatch<K extends 'monthly_amount' | 'setup_fee' | 'one_time_amount'>(
    key: K,
    rawValue: string,
  ): Partial<PlannedService> {
    if (rawValue === '') {
      const p = { [key]: undefined } as Record<K, undefined>;
      return p as Partial<PlannedService>;
    }
    return { [key]: Number(rawValue) } as Partial<PlannedService>;
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t('services.title')}</Label>
        {!isDisabled && (
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            {t('services.add')}
          </Button>
        )}
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('services.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {value.map((row, idx) => {
            const rowPackages = packages.filter((p) => p.service_type === row.service_type);
            const hasPackages = rowPackages.length > 0;
            return (
              <li key={idx} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-3">
                  <Label className="text-xs">
                    {t('services.types.web_seo', { defaultValue: 'Service' })}
                  </Label>
                  <Select
                    value={row.service_type}
                    disabled={isDisabled}
                    onValueChange={(v) =>
                      updateRow(idx, {
                        service_type: v as PlannedService['service_type'],
                        package_id: null,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`services.types.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">{t('services.package')}</Label>
                  <Select
                    value={row.package_id ?? NO_PACKAGE}
                    disabled={isDisabled || !hasPackages}
                    onValueChange={(v) => pickPackage(idx, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={hasPackages ? t('services.pick_package') : '—'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PACKAGE}>{t('services.no_package')}</SelectItem>
                      {rowPackages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {(p.display_names as { en?: string; el?: string })[lang] ?? p.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">
                    {t('services.billing.recurring_monthly', { defaultValue: 'Billing' })}
                  </Label>
                  <Select
                    value={row.billing_type}
                    disabled={isDisabled}
                    onValueChange={(v) =>
                      updateRow(idx, { billing_type: v as PlannedService['billing_type'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_TYPES.map((b) => (
                        <SelectItem key={b} value={b}>
                          {t(`services.billing.${b}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {row.billing_type === 'recurring_monthly' ? (
                  <>
                    <div className="col-span-1">
                      <Label className="text-xs">{t('services.monthly_amount')}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={isDisabled}
                        value={row.monthly_amount ?? ''}
                        onChange={(e) =>
                          updateRow(idx, numericPatch('monthly_amount', e.target.value))
                        }
                      />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-xs">{t('services.setup_fee')}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={isDisabled}
                        value={row.setup_fee ?? ''}
                        onChange={(e) => updateRow(idx, numericPatch('setup_fee', e.target.value))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <Label className="text-xs">{t('services.one_time_amount')}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={isDisabled}
                      value={row.one_time_amount ?? ''}
                      onChange={(e) =>
                        updateRow(idx, numericPatch('one_time_amount', e.target.value))
                      }
                    />
                  </div>
                )}
                <div className="col-span-1 flex justify-end">
                  {!isDisabled && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => removeRow(idx)}
                    >
                      ×
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
