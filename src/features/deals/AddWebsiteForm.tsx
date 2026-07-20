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
import { INDUSTRIES } from '@/lib/industries';
import { useAddWebsiteJob } from './hooks/useCustomJobMutations';

type Props = {
  dealId: string;
  onDone?: () => void;
};

/** Work-only extra website on a deal (web_dev job = a website). No billing here —
 *  accounting attaches payments later via the job's billing editor if needed. */
export function AddWebsiteForm({ dealId, onDone }: Props) {
  const { t, i18n } = useTranslation('deals');
  const add = useAddWebsiteJob(dealId);
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');

  const lang: 'en' | 'el' = i18n.language.startsWith('el') ? 'el' : 'en';
  const canSubmit = website.trim().length > 0 && !add.isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      await add.mutateAsync({ website: website.trim(), industry: industry || null });
      setWebsite('');
      setIndustry('');
      onDone?.();
    } catch (err) {
      const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted p-3 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-1">
        <Label htmlFor="aw-website" className="text-xs">
          {t('jobs_billing.website_form.website')}
        </Label>
        <Input
          id="aw-website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder={t('jobs_billing.website_form.website_placeholder')}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <Label id="aw-industry-label" className="text-xs">
          {t('jobs_billing.website_form.industry')}
        </Label>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger aria-labelledby="aw-industry-label">
            <SelectValue placeholder={t('jobs_billing.website_form.industry_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i.code} value={i.code}>
                {i.labels[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
          {add.isPending
            ? t('jobs_billing.website_form.submitting')
            : t('jobs_billing.website_form.submit')}
        </Button>
      </div>
    </div>
  );
}
