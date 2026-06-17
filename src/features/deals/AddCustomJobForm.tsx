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
import { useCreateCustomJob } from './hooks/useCustomJobMutations';
import type { BillingType, JobDepartment } from '@/lib/rpc';

const DEPARTMENTS: JobDepartment[] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
  'ads',
];

const CADENCES: BillingType[] = ['one_time', 'recurring_monthly', 'recurring_yearly'];

const BILLING_ONLY = '__billing_only__';

type Props = {
  dealId: string;
  defaultVatRate?: number;
  onDone?: () => void;
};

export function AddCustomJobForm({ dealId, defaultVatRate = 24, onDone }: Props) {
  const { t } = useTranslation('deals');
  const create = useCreateCustomJob(dealId);

  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<JobDepartment | typeof BILLING_ONLY>('web_dev');
  const [priceNet, setPriceNet] = useState('');
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [cadence, setCadence] = useState<BillingType>('one_time');
  const [description, setDescription] = useState('');
  const [setupFee, setSetupFee] = useState('');

  const canSubmit = title.trim().length > 0 && priceNet.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
    const billingOnly = department === BILLING_ONLY;
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        department: billingOnly ? 'web_dev' : department,
        billingType: cadence,
        amountNet: Number(priceNet),
        vatRate: Number(vatRate || 0),
        setupFee: setupFee ? Number(setupFee) : 0,
        billingOnly,
      });
      setTitle('');
      setPriceNet('');
      setVatRate(String(defaultVatRate));
      setCadence('one_time');
      setDescription('');
      setSetupFee('');
      onDone?.();
    } catch (err) {
      const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
      alert(errors.join('\n'));
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-slate-50 p-3 sm:grid-cols-3">
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
      <div>
        <Label className="text-xs">{t('jobs_billing.form.department')}</Label>
        <Select
          value={department}
          onValueChange={(v) => setDepartment(v as JobDepartment | typeof BILLING_ONLY)}
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
        <Select value={cadence} onValueChange={(v) => setCadence(v as BillingType)}>
          <SelectTrigger className="mt-1 h-8 w-full text-xs" aria-label={t('jobs_billing.form.cadence')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENCES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`jobs_billing.cadence_options.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
        <Label htmlFor="cj-desc" className="text-xs">
          {t('jobs_billing.form.description')}
        </Label>
        <Input
          id="cj-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 h-8 text-xs"
        />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <Button type="button" size="sm" onClick={submit} disabled={!canSubmit || create.isPending}>
          {create.isPending ? t('jobs_billing.form.submitting') : t('jobs_billing.form.submit')}
        </Button>
      </div>
    </div>
  );
}
