import { useState } from 'react';
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
import { useServiceSubpackages } from '@/features/service_packages/hooks/useServiceSubpackages';

export type PlannedService = {
  service_type: 'web_seo' | 'local_seo' | 'web_dev' | 'social_media' | 'ai_seo' | 'hosting' | 'ads';
  billing_type: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  // Website (web_dev) only: the one-time total is collected in installments per
  // this schedule. billing_type stays 'one_time'; this drives the payment split.
  payment_terms?: 'full' | '50_50' | '50_25_25' | null;
  package_id?: string | null;
  one_time_amount?: number;
  monthly_amount?: number;
  setup_fee?: number;
  subpackage_codes?: string[];
};

const WEBDEV_TERMS = ['full', '50_50', '50_25_25'] as const;
/** Split a website total into its installment amounts for the chosen schedule. */
export function paymentTermSplit(total: number, term: string | null | undefined): number[] {
  if (term === 'full') return [total]; // fully paid — one installment
  if (term === '50_25_25') return [total * 0.5, total * 0.25, total * 0.25];
  return [total * 0.5, total * 0.5]; // 50_50 (default)
}

type Props = {
  value: PlannedService[];
  onChange: (next: PlannedService[]) => void;
  disabled?: boolean;
  headerLeft?: React.ReactNode;
};

const SERVICE_TYPES: PlannedService['service_type'][] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
  'ads',
];

function billingOptionsFor(
  serviceType: PlannedService['service_type'],
): PlannedService['billing_type'][] {
  // Hosting is sold yearly only — every other service supports monthly + one-time.
  if (serviceType === 'hosting') return ['recurring_yearly'];
  return ['recurring_monthly', 'one_time'];
}

function defaultBillingFor(
  serviceType: PlannedService['service_type'],
): PlannedService['billing_type'] {
  if (serviceType === 'hosting') return 'recurring_yearly';
  return 'recurring_monthly';
}
const NO_PACKAGE = '__none__';

function patchRow(row: PlannedService, patch: Partial<PlannedService>): PlannedService {
  return { ...row, ...patch } as PlannedService;
}

// ── Per-row sub-component so we can call useServiceSubpackages per row ──────

type RowProps = {
  row: PlannedService;
  idx: number;
  isDisabled: boolean;
  lang: 'en' | 'el';
  rowPackages: ReturnType<typeof useServicePackages>['data'] extends (infer T)[] | undefined
    ? T[]
    : never[];
  t: ReturnType<typeof useTranslation<'deals'>>['t'];
  updateRow: (idx: number, patch: Partial<PlannedService>) => void;
  removeRow: (idx: number) => void;
  pickPackage: (idx: number, packageId: string) => void;
  numericPatch: <K extends 'monthly_amount' | 'setup_fee' | 'one_time_amount'>(
    key: K,
    rawValue: string,
  ) => Partial<PlannedService>;
};

function ServiceRowEditor({
  row,
  idx,
  isDisabled,
  lang,
  rowPackages,
  t,
  updateRow,
  removeRow,
  pickPackage,
  numericPatch,
}: RowProps) {
  const { data: subpackages = [] } = useServiceSubpackages(row.package_id ?? '');

  const hasPackages = rowPackages.length > 0;
  const selectedExtras = (row.subpackage_codes ?? []).length;
  const [extrasOpen, setExtrasOpen] = useState(false);

  return (
    <li className="space-y-1">
      <div className="grid grid-cols-12 items-end gap-1">
        <div className="col-span-2">
          <Label className="whitespace-nowrap text-xs">{t('services.service_type')}</Label>
          <Select
            value={row.service_type}
            disabled={isDisabled}
            onValueChange={(v) => {
              const next = v as PlannedService['service_type'];
              if (next === 'web_dev') {
                // Website is billed one-time, collected in installments (50/50 default).
                updateRow(idx, {
                  service_type: next,
                  billing_type: 'one_time',
                  payment_terms: '50_50',
                  package_id: null,
                  subpackage_codes: [],
                });
                return;
              }
              const options = billingOptionsFor(next);
              const billing = options.includes(row.billing_type)
                ? row.billing_type
                : defaultBillingFor(next);
              updateRow(idx, {
                service_type: next,
                billing_type: billing,
                payment_terms: null,
                package_id: null,
                subpackage_codes: [],
              });
            }}
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
          <Label className="whitespace-nowrap text-xs">{t('services.package')}</Label>
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
          <Label className="whitespace-nowrap text-xs">{t('services.billing_type')}</Label>
          {row.service_type === 'web_dev' ? (
            <Select
              value={row.payment_terms ?? '50_50'}
              disabled={isDisabled}
              onValueChange={(v) =>
                updateRow(idx, {
                  payment_terms: v as 'full' | '50_50' | '50_25_25',
                  billing_type: 'one_time',
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBDEV_TERMS.map((term) => (
                  <SelectItem key={term} value={term}>
                    {t(`services.payment_terms.${term}`, {
                      defaultValue:
                        term === 'full' ? 'Fully paid' : term === '50_25_25' ? '50/25/25' : '50/50',
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={row.billing_type}
              disabled={isDisabled || row.service_type === 'hosting'}
              onValueChange={(v) =>
                updateRow(idx, { billing_type: v as PlannedService['billing_type'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {billingOptionsFor(row.service_type).map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`services.billing.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {row.service_type === 'web_dev' ? (
          <div className="col-span-4">
            <Label className="whitespace-nowrap text-xs">
              {t('services.total_amount', { defaultValue: 'Total amount' })}
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              disabled={isDisabled}
              value={row.one_time_amount ?? ''}
              onChange={(e) => updateRow(idx, numericPatch('one_time_amount', e.target.value))}
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {paymentTermSplit(Number(row.one_time_amount) || 0, row.payment_terms)
                .map((p) => `€${p.toFixed(0)}`)
                .join(' + ')}
            </p>
          </div>
        ) : row.billing_type !== 'one_time' ? (
          <>
            <div className="col-span-2">
              <Label className="whitespace-nowrap text-xs">
                {row.billing_type === 'recurring_yearly'
                  ? t('services.yearly_amount')
                  : t('services.monthly_amount')}
              </Label>
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
            <div className="col-span-2">
              <Label className="whitespace-nowrap text-xs">{t('services.setup_fee')}</Label>
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
          <div className="col-span-4">
            <Label className="whitespace-nowrap text-xs">
              {t('services.one_time_amount')}
            </Label>
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
      </div>

      {/* Extras / sub-products — collapsible */}
      {row.package_id && subpackages.length > 0 && (
        <div className="col-span-12">
          <button
            type="button"
            onClick={() => setExtrasOpen((v) => !v)}
            aria-expanded={extrasOpen}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="inline-block w-3 text-center text-muted-foreground">
              {extrasOpen ? '▾' : '▸'}
            </span>
            {t('services.extras', { defaultValue: 'Extras' })}
            {selectedExtras > 0 && <span className="text-muted-foreground">({selectedExtras})</span>}
          </button>
          {extrasOpen && (
          <div className="mt-1 space-y-1 rounded-md border bg-muted p-2">
            {subpackages.map((sp) => {
              const checked = (row.subpackage_codes ?? []).includes(sp.code);
              return (
                <label key={sp.code} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isDisabled}
                    onChange={(e) => {
                      const next = new Set(row.subpackage_codes ?? []);
                      if (e.target.checked) next.add(sp.code);
                      else next.delete(sp.code);
                      // The extra's price must reach the amounts that drive
                      // pricing summaries and payment seeding — apply it to
                      // the bucket matching the row's billing cadence.
                      const delta = (e.target.checked ? 1 : -1) * (Number(sp.price) || 0);
                      const amountPatch: Partial<PlannedService> =
                        row.billing_type === 'one_time'
                          ? {
                              one_time_amount: Math.max(
                                0,
                                (Number(row.one_time_amount) || 0) + delta,
                              ),
                            }
                          : {
                              monthly_amount: Math.max(
                                0,
                                (Number(row.monthly_amount) || 0) + delta,
                              ),
                            };
                      updateRow(idx, { subpackage_codes: [...next], ...amountPatch });
                    }}
                  />
                  <div className="flex-1">
                    <div className="font-medium">
                      {(sp.display_names as { en?: string; el?: string })[lang] ?? sp.code}
                      <span className="ml-2 text-muted-foreground">+€{Number(sp.price).toFixed(0)}</span>
                    </div>
                    {sp.description && (
                      <div className="text-[10px] text-muted-foreground">{sp.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ServicesPlannedField({ value, onChange, disabled, headerLeft }: Props) {
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
      updateRow(idx, { package_id: null, subpackage_codes: [] });
      return;
    }
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) {
      updateRow(idx, { package_id: null, subpackage_codes: [] });
      return;
    }
    updateRow(idx, {
      package_id: pkg.id,
      one_time_amount: Number(pkg.default_one_time_amount ?? 0),
      monthly_amount: Number(pkg.default_monthly_amount ?? 0),
      setup_fee: Number(pkg.setup_fee ?? 0),
      subpackage_codes: [],
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
        <div className="flex items-center gap-2">
          {headerLeft}
          {!isDisabled && (
            <Button type="button" size="sm" variant="outline" onClick={addRow}>
              {t('services.add')}
            </Button>
          )}
        </div>
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('services.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {value.map((row, idx) => {
            const rowPackages = packages.filter((p) => p.service_type === row.service_type);
            return (
              <ServiceRowEditor
                key={idx}
                row={row}
                idx={idx}
                isDisabled={isDisabled}
                lang={lang}
                rowPackages={rowPackages}
                t={t}
                updateRow={updateRow}
                removeRow={removeRow}
                pickPackage={pickPackage}
                numericPatch={numericPatch}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
