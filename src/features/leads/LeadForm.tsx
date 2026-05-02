import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServicesPlannedField, type PlannedService } from '@/features/deals/ServicesPlannedField';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';

export function LeadForm({ lead }: { lead: LeadRow }) {
  const { t } = useTranslation('leads');
  const update = useUpdateLead();
  const readOnly = !!lead.converted_at;

  const [fullName, setFullName] = useState(
    [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [website, setWebsite] = useState(lead.website ?? '');
  const [companyName, setCompanyName] = useState(lead.company_name ?? '');
  const [industry, setIndustry] = useState(lead.industry ?? '');
  const [country, setCountry] = useState(lead.country ?? '');
  const [address, setAddress] = useState(lead.address ?? '');
  const [vatNumber, setVatNumber] = useState(lead.vat_number ?? '');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [oneTime, setOneTime] = useState(String(lead.estimated_one_time_value ?? 0));
  const [monthly, setMonthly] = useState(String(lead.estimated_monthly_value ?? 0));
  const [services, setServices] = useState<PlannedService[]>(
    Array.isArray(lead.services_planned) ? (lead.services_planned as PlannedService[]) : [],
  );

  function toNum(v: string) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: lead.id,
        patch: {
          contact_first_name: fullName.trim() || null,
          contact_last_name: null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          company_name: companyName.trim() || null,
          industry: industry.trim() || null,
          country: country.trim() || null,
          address: address.trim() || null,
          vat_number: vatNumber.trim() || null,
          notes: notes.trim() || null,
          estimated_one_time_value: toNum(oneTime),
          estimated_monthly_value: toNum(monthly),
          services_planned: services as unknown as LeadRow['services_planned'],
        },
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="fn">{t('form.full_name')}</Label>
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">{t('form.email')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="phone">{t('form.phone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="ws">{t('form.website')}</Label>
            <Input
              id="ws"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="co">{t('form.company_name')}</Label>
            <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ind">{t('form.industry')}</Label>
            <Input id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cnt">{t('form.country')}</Label>
            <Input id="cnt" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="addr">{t('form.address')}</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="vat">{t('form.vat_number')}</Label>
            <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ot">{t('form.estimated_one_time_value')}</Label>
            <Input
              id="ot"
              inputMode="decimal"
              value={oneTime}
              onChange={(e) => setOneTime(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="mo">{t('form.estimated_monthly_value')}</Label>
            <Input
              id="mo"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>{t('form.services_planned')}</Label>
            <ServicesPlannedField value={services} onChange={setServices} disabled={readOnly} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="notes">{t('form.lead_info')}</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <Button type="submit" disabled={update.isPending}>
          {t('actions.save')}
        </Button>
      </fieldset>
    </form>
  );
}
