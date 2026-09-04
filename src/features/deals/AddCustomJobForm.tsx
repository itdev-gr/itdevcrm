import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCreateCustomJob } from './hooks/useCustomJobMutations';
import { useOfferCatalog } from '@/features/offers/hooks/useOfferCatalog';
import { splitInstallments, type InstallmentPlan } from './installmentSplit';
import { CustomScheduleEditor } from './CustomScheduleEditor';
import { validateCustomSchedule, type ScheduleRow } from './customSchedule';
import { formatEur } from '@/lib/countries';
import type { BillingType, JobDepartment } from '@/lib/rpc';

const PLANS: InstallmentPlan[] = ['none', '50_50', '50_25_25', 'custom'];

const DEPARTMENTS: JobDepartment[] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
  'ads',
  'maintenance',
  'franchise',
  'domains',
];

const CADENCES: BillingType[] = ['one_time', 'recurring_monthly', 'recurring_yearly'];

const BILLING_ONLY = '__billing_only__';

type Props = {
  dealId: string;
  defaultVatRate?: number;
  onDone?: () => void;
};

export function AddCustomJobForm({ dealId, defaultVatRate = 24, onDone }: Props) {
  const { t, i18n } = useTranslation('deals');
  const create = useCreateCustomJob(dealId);
  // Which KIND of ads, straight from the service catalogue — add a package in
  // /admin and it shows up here, no deploy. Until 2026-09-04 the kind lived
  // only in the free-text title, which is why the data holds 'google ads',
  // 'GOOGLE ADS', 'gbp google ads' and six jobs saying just 'Ads'.
  const { data: catalog = [] } = useOfferCatalog();
  const adsPackages = catalog.filter((p) => p.service_type === 'ads');

  const [title, setTitle] = useState('');
  const [adsPackageId, setAdsPackageId] = useState('');
  const [department, setDepartment] = useState<JobDepartment | typeof BILLING_ONLY>('web_dev');
  const [priceNet, setPriceNet] = useState('');
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [cadence, setCadence] = useState<BillingType>('one_time');
  const [plan, setPlan] = useState<InstallmentPlan>('none');
  const [description, setDescription] = useState('');
  const [setupFee, setSetupFee] = useState('');
  const [schedule, setSchedule] = useState<ScheduleRow[]>([{ amount_net: 0, due_date: null }]);
  const [dupConfirm, setDupConfirm] = useState(false);

  // Hosting and domains are billed yearly only; franchise is billed one-time only.
  const cadences: BillingType[] =
    department === 'hosting' || department === 'domains'
      ? ['recurring_yearly']
      : department === 'franchise'
        ? ['one_time']
        : CADENCES;

  // Installment plans apply only to one-time Web Dev and Franchise jobs.
  const planEligible = (department === 'web_dev' || department === 'franchise') && cadence === 'one_time';
  const effectivePlan: InstallmentPlan = planEligible ? plan : 'none';

  const canSubmit = title.trim().length > 0 && priceNet.trim().length > 0;

  async function doCreate(force: boolean) {
    const billingOnly = department === BILLING_ONLY;
    const isCustom = effectivePlan === 'custom';
    if (isCustom) {
      const err = validateCustomSchedule(schedule, Number(priceNet || 0));
      if (err) { alert(t(`jobs_billing.billing_errors.${err}`, { defaultValue: err })); return; }
    }
    await create.mutateAsync({
      title: title.trim(),
      description: description.trim() || null,
      department: billingOnly ? 'web_dev' : department,
      billingType: cadence,
      amountNet: Number(priceNet),
      vatRate: Number(vatRate || 0),
      setupFee: setupFee ? Number(setupFee) : 0,
      billingOnly,
      installmentPlan: effectivePlan,
      installmentSchedule: isCustom ? schedule : null,
      force,
    });
  }

  async function submit() {
    if (!canSubmit) return;
    try {
      await doCreate(false);
      resetForm();
      onDone?.();
    } catch (err) {
      const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      if (code === 'web_dev_job_exists') { setDupConfirm(true); return; }
      alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
    }
  }

  function resetForm() {
    setTitle(''); setAdsPackageId(''); setPriceNet(''); setVatRate(String(defaultVatRate));
    setCadence('one_time'); setPlan('none'); setDescription(''); setSetupFee('');
    setSchedule([{ amount_net: 0, due_date: null }]);
  }

  function onAdsTypeChange(packageId: string) {
    setAdsPackageId(packageId);
    const pkg = adsPackages.find((p) => p.id === packageId);
    if (!pkg) return;
    setTitle(pkg.display_names[i18n.language.startsWith('el') ? 'el' : 'en'] ?? pkg.code);
    // Suggest the catalogue price for the cadence in play. Ads carry only
    // monthly prices today, so a one-time ads job would otherwise have its
    // typed amount wiped by a 0 — leave the field alone in that case.
    const suggested =
      cadence === 'one_time' ? pkg.default_one_time_amount : pkg.default_monthly_amount;
    if (suggested > 0) setPriceNet(String(suggested));
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted p-3 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-1">
        <Label htmlFor="cj-title" className="text-xs">
          {t('jobs_billing.form.title')}
        </Label>
        <Input
          id="cj-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('jobs_billing.form.title_placeholder')}
          className="mt-1 h-8 text-xs"
        />
      </div>
      {department === 'ads' && (
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs">{t('jobs_billing.form.ads_type')}</Label>
          <Select value={adsPackageId} onValueChange={onAdsTypeChange}>
            <SelectTrigger
              className="mt-1 h-8 w-full text-xs"
              aria-label={t('jobs_billing.form.ads_type')}
            >
              <SelectValue placeholder={t('jobs_billing.form.ads_type_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {adsPackages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_names[i18n.language.startsWith('el') ? 'el' : 'en'] ?? p.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="col-span-2 sm:col-span-3">
        <Label htmlFor="cj-notes" className="text-xs">
          {t('jobs_billing.form.notes_label')}
        </Label>
        <Textarea
          id="cj-notes"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('jobs_billing.form.notes_placeholder')}
          className="mt-1 text-xs"
        />
      </div>
      <div>
        <Label className="text-xs">{t('jobs_billing.form.department')}</Label>
        <Select
          value={department}
          onValueChange={(v) => {
            const dep = v as JobDepartment | typeof BILLING_ONLY;
            setDepartment(dep);
            if (dep === 'hosting' || dep === 'domains') setCadence('recurring_yearly');
            if (dep === 'franchise') setCadence('one_time');
          }}
        >
          <SelectTrigger className="mt-1 h-8 w-full text-xs" aria-label={t('jobs_billing.form.department')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>
                {t(`services.types.${d}`)}
              </SelectItem>
            ))}
            <SelectItem value={BILLING_ONLY}>
              {t('jobs_billing.department_billing_only')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{t('jobs_billing.form.cadence')}</Label>
        <Select
          value={cadence}
          onValueChange={(v) => setCadence(v as BillingType)}
          disabled={department === 'hosting' || department === 'domains'}
        >
          <SelectTrigger className="mt-1 h-8 w-full text-xs" aria-label={t('jobs_billing.form.cadence')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cadences.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`jobs_billing.cadence_options.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {planEligible && (
        <div>
          <Label className="text-xs">{t('jobs_billing.form.plan')}</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as InstallmentPlan)}>
            <SelectTrigger className="mt-1 h-8 w-full text-xs" aria-label={t('jobs_billing.form.plan')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`jobs_billing.plan_options.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {effectivePlan !== 'none' && effectivePlan !== 'custom' && priceNet.trim() !== '' && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('jobs_billing.plan_preview', {
                parts: splitInstallments(Number(priceNet || 0), effectivePlan)
                  .map((n) => formatEur(n))
                  .join(' + '),
              })}
            </p>
          )}
        </div>
      )}
      {planEligible && effectivePlan === 'custom' && (
        <CustomScheduleEditor rows={schedule} onChange={setSchedule} total={Number(priceNet || 0)} />
      )}
      <div>
        <Label htmlFor="cj-price" className="text-xs">
          {t('jobs_billing.form.price_net')}
        </Label>
        <Input
          id="cj-price"
          type="number"
          step="0.01"
          min="0"
          value={priceNet}
          onChange={(e) => setPriceNet(e.target.value)}
          className="mt-1 h-8 text-xs"
        />
      </div>
      <div>
        <Label htmlFor="cj-vat" className="text-xs">
          {t('jobs_billing.form.vat_rate')}
        </Label>
        <Input
          id="cj-vat"
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={vatRate}
          onChange={(e) => setVatRate(e.target.value)}
          className="mt-1 h-8 text-xs"
        />
      </div>
      <div>
        <Label htmlFor="cj-setup" className="text-xs">
          {t('jobs_billing.form.setup_fee')}
        </Label>
        <Input
          id="cj-setup"
          type="number"
          step="0.01"
          min="0"
          value={setupFee}
          onChange={(e) => setSetupFee(e.target.value)}
          className="mt-1 h-8 text-xs"
        />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <Button type="button" size="sm" onClick={submit} disabled={!canSubmit || create.isPending}>
          {create.isPending ? t('jobs_billing.form.submitting') : t('jobs_billing.form.submit')}
        </Button>
      </div>
      <ConfirmDialog
        open={dupConfirm}
        onOpenChange={setDupConfirm}
        title={t('jobs_billing.dup_confirm.title')}
        description={t('jobs_billing.dup_confirm.body')}
        confirmLabel={t('jobs_billing.dup_confirm.confirm')}
        onConfirm={async () => {
          try { await doCreate(true); resetForm(); setDupConfirm(false); onDone?.(); }
          catch (err) {
            const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
            alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
          }
        }}
      />
    </div>
  );
}
